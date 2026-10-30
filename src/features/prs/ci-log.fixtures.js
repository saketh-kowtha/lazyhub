/**
 * ci-log.fixtures.js — recorded-shape `gh run view --log-failed` logs, one per
 * supported failure family (issue #359). Shared by ci-log.test.js and the PTY
 * gh stub. Text is representative of each tool's real output; secrets are fake.
 */

const TS = '2026-10-30T10:00:00.0000000Z'

/**
 * Format lines the way `gh run view --log-failed` prints them.
 *
 * @param {string} job
 * @param {string} step
 * @param {string[]} lines
 * @returns {string}
 */
export const ghLog = (job, step, lines) => lines.map(l => `${job}\t${step}\t${TS} ${l}`).join('\n')

export const VITEST_LOG = ghLog('test (20)', 'Run npm test', [
  '> lazyhub@1.0.0 test',
  '> vitest run',
  '',
  ' RUN  v3.2.4 /home/runner/work/lazyhub/lazyhub',
  '',
  ' ❯ src/utils.test.js (3 tests | 1 failed) 8ms',
  '   \u00d7 parses the title 2ms',
  '',
  ' FAIL  src/utils.test.js > parses the title',
  'AssertionError: expected "a" to be "b" // Object.is equality',
  '',
  '- Expected: "b"',
  '+ Received: "a"',
  '',
  ' ❯ src/utils.test.js:12:20',
  '     10|   it("parses the title", () => {',
  '     11|     const v = parse("a")',
  '     12|     expect(v).toBe("b")',
  '',
  ' Test Files  1 failed (1)',
  '      Tests  1 failed | 2 passed (3)',
  '##[error]Process completed with exit code 1.',
])

export const NODE_ASSERT_LOG = ghLog('test (20)', 'Run node --test', [
  'node:assert:124',
  '  throw new AssertionError(obj);',
  '  ^',
  '',
  'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '',
  '1 !== 2',
  '',
  '    at Object.<anonymous> (/home/runner/work/lazyhub/lazyhub/src/math.js:7:8)',
  '    at node:internal/modules/cjs/loader:1554:14',
  '  generatedMessage: true,',
  '  code: \'ERR_ASSERTION\'',
  '}',
  '',
  'Node.js v20.18.0',
])

export const TSC_LOG = ghLog('typecheck', 'Run npm run typecheck', [
  '> tsc --noEmit',
  '',
  'src/features/prs/list.jsx(42,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
  '  The expected type comes from property \'count\' declared here.',
  'src/app.jsx(9,1): error TS2307: Cannot find module \'./missing.js\'.',
  '##[error]Process completed with exit code 2.',
])

export const ESLINT_LOG = ghLog('lint', 'Run npm run lint', [
  '> eslint src',
  '',
  '/home/runner/work/lazyhub/lazyhub/src/executor/core.js',
  '  12:5   error  \'x\' is assigned a value but never used  no-unused-vars',
  '  40:1   error  Unexpected console statement             no-console',
  '',
  '\u2716 2 problems (2 errors, 0 warnings)',
  '##[error]Process completed with exit code 1.',
])

export const STACK_TRACE_LOG = ghLog('build', 'Run npm run build', [
  'Building…',
  'TypeError: Cannot read properties of undefined (reading \'map\')',
  '    at render (/home/runner/work/lazyhub/lazyhub/src/view.js:30:15)',
  '    at main (file:///home/runner/work/lazyhub/lazyhub/src/main.js:4:3)',
  '    at C:\\a\\lazyhub\\lazyhub\\src\\win.js:9:2',
  '    at node_modules/foo/index.js:1:1',
  '##[error]Process completed with exit code 1.',
])

/** A failing step that matches no known shape. */
export const UNPARSED_LOG = ghLog('deploy', 'Upload', [
  'uploading artifact 1/3',
  'uploading artifact 2/3',
  'the server said no',
])

/** Only the generic annotation line is present. */
export const ANNOTATION_ONLY_LOG = ghLog('deploy', 'Upload', [
  'starting',
  '##[error]Process completed with exit code 137.',
])

/** Secrets that must never reach the screen. */
export const SECRET_LOG = ghLog('test (20)', 'Run tests', [
  'request failed with Authorization: Bearer abcdefghijklmnop12345',
  '    at fetchIt (/work/src/api.js:3:9)',
  '    GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  '    AWS key AKIAABCDEFGHIJKLMNOP and npm_abcdefghijklmnopqrst',
  '    DB_PASSWORD=hunter2hunter2',
  '    url https://user:pw@example.com/path?sig=abc123',
  '    \u001b[31mred ansi\u001b[0m and a \u0007 bell',
])
