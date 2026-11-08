// @ts-nocheck
/**
 * src/features/prs/story/classify.js -- path and extension heuristics for the review story (#362).
 *
 * Pure and deterministic: a changed file is put in one bucket from its path, extension and change
 * type alone, with a human-readable reason. The noise bucket is deliberately narrow: only files a
 * reviewer can skip without reading a semantic change (lockfiles, generated output, snapshots,
 * binary assets, pure renames). When in doubt a file is NOT noise.
 */

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'cargo.lock', 'go.sum', 'gemfile.lock', 'poetry.lock', 'pipfile.lock', 'composer.lock', 'podfile.lock',
  'flake.lock', 'packages.lock.json', 'mix.lock', 'pubspec.lock', 'uv.lock',
])
const GENERATED_DIR = /(^|\/)(dist|build|out|vendor|node_modules|__generated__|generated|\.next|coverage)\//i
const GENERATED_FILE = /(\.min\.(js|css)|\.map|\.pb\.go|_pb2(_grpc)?\.py|\.pb\.(js|ts)|\.generated\.[a-z]+|\.g\.dart|\.designer\.cs)$/i
const SNAPSHOT = /(^|\/)__snapshots__\/|\.snap$/i
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|bmp|pdf|woff2?|ttf|otf|eot|zip|gz|tgz|jar|mp[34]|mov|wasm)$/i

const TEST_DIR = /(^|\/)(tests?|__tests__|specs?|e2e|cypress|__mocks__|fixtures?|testdata|test-utils)\//i
const TEST_FILE = /(\.(test|spec)\.[a-z0-9]+$)|(_test\.(go|py|rb|rs|exs?)$)|((^|\/)test_[^/]+\.py$)|(Tests?\.(java|kt|cs|swift)$)|(_spec\.rb$)/i

const DOC_EXT = /\.(md|mdx|rst|txt|adoc)$/i
const CONFIG_EXT = /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|env|properties|gradle|tf|tfvars|xml|plist)$/i
const CONFIG_NAME = /(^|\/)(dockerfile|makefile|justfile|procfile|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.editorconfig|\.dockerignore|codeowners|\.env[^/]*)$/i
const CONFIG_DIR = /(^|\/)(\.github|\.circleci|\.gitlab|\.husky|\.vscode|config|configs|docs?|deploy|infra|helm|k8s|\.claude)\//i
const CONFIG_STEM = /(^|\/)(tsconfig[^/]*|vite\.config|vitest\.config|webpack\.config|rollup\.config|babel\.config|jest\.config|eslint\.config|prettier\.config|\.eslintrc[^/]*|\.prettierrc[^/]*|tailwind\.config|next\.config|package)\.[a-z]+$/i

const SOURCE_EXT = /\.(jsx?|mjs|cjs|tsx?|py|rb|go|rs|java|kt|kts|swift|cs|cpp|cc|c|h|hpp|php|scala|sh|bash|zsh|lua|ex|exs|dart|vue|svelte|sql|css|scss|html)$/i

/**
 * Lower-case last path segment.
 * @param path
 */
const baseName = (path) => path.slice(path.lastIndexOf('/') + 1).toLowerCase()

/**
 * Put one changed file in a bucket.
 * @param {{path: string, additions?: number, deletions?: number, changeType?: string}} file
 * @returns {{kind: 'source'|'config'|'test'|'noise', reason: string}} `source` is split into core/usage by the builder
 */
export function classifyFile(file) {
  const path = String(file.path || '')
  const name = baseName(path)
  const churn = (file.additions || 0) + (file.deletions || 0)

  if (LOCKFILES.has(name)) return { kind: 'noise', reason: 'lockfile' }
  if (SNAPSHOT.test(path)) return { kind: 'noise', reason: 'test snapshot' }
  if (GENERATED_DIR.test(path) || GENERATED_FILE.test(path)) return { kind: 'noise', reason: 'generated or vendored output' }
  if (BINARY_EXT.test(path)) return { kind: 'noise', reason: 'binary asset' }
  // A rename with no content change carries no semantic change. Anything with edits stays reviewable.
  if (file.changeType === 'RENAMED' && churn === 0) return { kind: 'noise', reason: 'pure rename (no content change)' }

  if (TEST_DIR.test(path) || TEST_FILE.test(path)) return { kind: 'test', reason: 'test code or test data' }
  if (CONFIG_STEM.test(path) || CONFIG_NAME.test(path)) return { kind: 'config', reason: 'build, tooling or repo configuration' }
  if (DOC_EXT.test(path)) return { kind: 'config', reason: 'documentation' }
  if (CONFIG_DIR.test(path) && !SOURCE_EXT.test(path)) return { kind: 'config', reason: 'configuration or docs directory' }
  if (CONFIG_EXT.test(path)) return { kind: 'config', reason: 'configuration data' }
  if (SOURCE_EXT.test(path)) return { kind: 'source', reason: 'source code' }
  // Unknown extension: treat as source so it is read, never skipped.
  return { kind: 'source', reason: 'unrecognised file type (kept for review)' }
}

/**
 * Module specifiers imported by ADDED lines of a patch. Used only when a file's patch is at hand.
 * A bare specifier (a package) is returned too; the resolver ignores what matches no changed file.
 * @param {string} patchText unified-diff patch of one file
 * @returns {string[]}
 */
export function extractImports(patchText) {
  const out = new Set()
  if (!patchText) return []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/,
    /\bimport\s+['"]([^'"]+)['"]/,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/,
    /^\+\s*import\s+([\w.]+)/,
    /^\+\s*(?:use|using)\s+([\w:.]+)/,
    /^\+\s*#include\s+["<]([^">]+)[">]/,
  ]
  for (const line of patchText.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const re of patterns) {
      const m = line.match(re)
      if (m) { out.add(m[1]); break }
    }
  }
  return [...out]
}

/**
 * Path stem used to match an import specifier to a changed file ("src/foo/bar.js" -> "src/foo/bar").
 * @param path
 */
export function moduleStem(path) {
  return String(path).replace(/\.[a-z0-9]+$/i, '').replace(/\/(index|mod|__init__)$/i, '')
}
