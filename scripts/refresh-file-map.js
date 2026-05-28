#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { rename } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const renameAsync = promisify(rename);
const scriptPath = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(scriptPath), '..');
const srcDir = join(rootDir, 'src');
const docsDir = join(rootDir, 'docs');
const outputPath = join(docsDir, 'FILE_MAP.md');

// Categorize file paths
function getCategory(filePath) {
  const rel = relative(srcDir, filePath);

  if (rel === 'app.jsx' || rel === 'bootstrap.js') {
    return 'Top-level entry points';
  }
  if (rel === 'executor.js') {
    return 'GitHub interface (the gh chokepoint)';
  }
  if (rel === 'ai-assistant.js' || rel === 'ai.js' || rel.startsWith('ai/')) {
    return 'AI provider abstraction';
  }
  if (rel === 'theme.js' || rel.startsWith('theme/') || rel.startsWith('themes/')) {
    return 'Theme system';
  }
  if (rel.startsWith('features/prs/')) {
    return 'Features — Pull Requests';
  }
  if (rel.startsWith('features/issues/')) {
    return 'Features — Issues';
  }
  if (/^features\/(actions|branches|logs|notifications|settings)\//.test(rel)) {
    return 'Features — other';
  }
  if (rel.startsWith('ui/')) {
    return 'UI primitives';
  }
  if (rel.startsWith('components/')) {
    return 'Components (shared)';
  }
  if (rel.startsWith('hooks/')) {
    return 'Hooks';
  }
  if (rel === 'config.js' || rel === 'context.js') {
    return 'Configuration & Context';
  }
  if (['editor.js', 'ipc.js', 'keyscope.js', 'mcp.js', 'utils.js'].includes(basename(filePath))) {
    return 'Utilities & Infrastructure';
  }

  return null; // Uncategorized
}

// Extract JSDoc header from first 100 lines
async function extractDescription(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').slice(0, 100);
    const joined = lines.join('\n');

    // Match JSDoc pattern: /** ... */
    const match = joined.match(/\/\*\*\s*([\s\S]*?)\*\//);
    if (!match) {
      return `(no header — inferred: ${basename(filePath, extname(filePath))})`;
    }

    let text = match[1].trim();
    // Remove leading * from each line and collapse whitespace
    text = text.split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => line.length > 0)
      .join(' ')
      .trim();

    // Remove filename prefix (everything before em-dash). Only em-dash, NOT
    // hyphen — filenames like bg-detect.js or catppuccin-latte.js contain
    // hyphens, so stripping on hyphen would chop the filename itself.
    text = text.replace(/^[^—]*—\s*/, '').trim();

    return text || `(no header — inferred: ${basename(filePath, extname(filePath))})`;
  } catch {
    return `(no header — inferred: ${basename(filePath, extname(filePath))})`;
  }
}

// Walk src tree and collect files
async function walkSource() {
  const files = [];
  const testFiles = new Map();

  async function walk(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (/\.(js|jsx)$/.test(entry.name)) {
          const rel = relative(srcDir, fullPath);
          if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.jsx')) {
            const testDir = relative(srcDir, dirname(fullPath));
            testFiles.set(testDir, (testFiles.get(testDir) || 0) + 1);
          } else {
            files.push({ path: fullPath, rel });
          }
        }
      }
    } catch (err) {
      console.error(`Error walking ${dir}:`, err.message);
    }
  }

  await walk(srcDir);
  return { files, testFiles };
}

async function main() {
  const { files, testFiles } = await walkSource();

  // Group by category
  const sections = {};
  const uncategorized = [];

  for (const { path: filePath, rel } of files) {
    const cat = getCategory(filePath);
    if (!cat) {
      uncategorized.push({ filePath, rel });
    } else {
      if (!sections[cat]) sections[cat] = [];
      sections[cat].push({ filePath, rel });
    }
  }

  if (uncategorized.length > 0) {
    console.error(`Warning: ${uncategorized.length} files uncategorized:`);
    uncategorized.forEach(({ rel }) => console.error(`  ${rel}`));
    sections['Uncategorized'] = uncategorized;
  }

  // Build output
  let output = `# File Map — concept → owning files

> Generated crosswalk so a fresh Claude session knows where things live.
> When in doubt, this doc points you at the right file; then read that file's JSDoc header for full context.
> Regenerate after any major refactor (add/remove/rename file) with \`npm run docs:refresh\`.

`;

  const categoryOrder = [
    'Top-level entry points',
    'GitHub interface (the gh chokepoint)',
    'AI provider abstraction',
    'Theme system',
    'Features — Pull Requests',
    'Features — Issues',
    'Features — other',
    'UI primitives',
    'Components (shared)',
    'Hooks',
    'Configuration & Context',
    'Utilities & Infrastructure',
    'Uncategorized',
  ];

  for (const cat of categoryOrder) {
    if (!sections[cat] || sections[cat].length === 0) continue;

    output += `## ${cat}\n\n| File | Purpose |\n|---|---|\n`;

    // Sort alphabetically by relative path
    sections[cat].sort((a, b) => a.rel.localeCompare(b.rel));

    for (const { filePath, rel } of sections[cat]) {
      const desc = await extractDescription(filePath);
      output += `| \`src/${rel}\` | ${desc} |\n`;
    }
    output += '\n';
  }

  // Tests section
  output += `## Tests\n\nTest file counts by directory:\n\n| Directory | Test files |\n|---|---|\n`;
  const testDirs = Array.from(testFiles.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dir, count] of testDirs) {
    const displayDir = dir === '' ? 'src/' : `src/${dir}/`;
    output += `| \`${displayDir}\` | ${count} |\n`;
  }

  const totalSourceFiles = files.length;
  const totalTestFiles = Array.from(testFiles.values()).reduce((a, b) => a + b, 0);
  output += `\n**Total non-test source files:** ${totalSourceFiles}\n**Total test files:** ${totalTestFiles}\n`;

  // Atomic write via temp file
  const tempPath = join(tmpdir(), `FILE_MAP.${Date.now()}.md`);
  await writeFile(tempPath, output, 'utf8');
  await renameAsync(tempPath, outputPath);

  console.log(`Updated docs/FILE_MAP.md (${totalSourceFiles} source, ${totalTestFiles} test files)`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
