// Prints the toolchain and dependency-graph identity of the current checkout so
// CI, release and promote logs can be compared line by line. Run after
// `npm ci`. With --verify-clean it exits non-zero if package.json or the
// lockfile differ from the committed copy.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// CRLF is normalized so a Windows checkout (core.autocrlf) hashes like Linux.
const sha256 = (file) =>
  createHash('sha256')
    .update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
const npmVersion = execFileSync('npm', ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
}).trim();

const lines = [
  `node ${process.version}`,
  `npm ${npmVersion}`,
  `platform ${process.platform}-${process.arch}`,
  `package-lock.json sha256 ${sha256('package-lock.json')}`,
  `package.json sha256 ${sha256('package.json')}`,
];
for (const line of lines) console.log(line);

if (process.env.GITHUB_STEP_SUMMARY) {
  const job = process.env.GITHUB_JOB ?? 'job';
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Toolchain (${job})\n\n${lines.map((l) => `- \`${l}\``).join('\n')}\n`,
  );
}

// `npm ci` never rewrites the lockfile; a diff means something regenerated it
// and the tested/built graph is not the committed one.
if (process.argv.includes('--verify-clean')) {
  try {
    execFileSync('git', ['diff', '--exit-code', '--', 'package.json', 'package-lock.json'], {
      stdio: 'inherit',
    });
  } catch {
    console.error('::error::package.json or package-lock.json differ from the committed copy');
    process.exit(1);
  }
}
