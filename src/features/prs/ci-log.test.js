import { describe, it, expect } from 'vitest'
import { extractExcerpt, extractLocations, loadFailureExcerpt, redactLine, MAX_EXCERPT_LINES, MAX_LINE_CHARS } from './ci-log.js'
import {
  ghLog, VITEST_LOG, NODE_ASSERT_LOG, TSC_LOG, ESLINT_LOG, STACK_TRACE_LOG, UNPARSED_LOG, ANNOTATION_ONLY_LOG, SECRET_LOG,
} from './ci-log.fixtures.js'

describe('extractExcerpt: one fixture per failure family', () => {
  it('vitest/jest: starts at the FAIL header, keeps the frame, stops before the summary', () => {
    const x = extractExcerpt(VITEST_LOG)
    expect(x.kind).toBe('vitest-jest')
    expect(x.job).toBe('test (20)')
    expect(x.step).toBe('Run npm test')
    expect(x.lines[0]).toMatch(/^\s*\u00d7\s+parses the title|FAIL/)
    expect(x.lines.join('\n')).toContain('Expected: "b"')
    expect(x.lines.join('\n')).not.toContain('Test Files')
    expect(x.locations).toContainEqual({ path: 'src/utils.test.js', line: 12, col: 20 })
  })

  it('node assert: includes the AssertionError and its frame, drops node internals', () => {
    const x = extractExcerpt(NODE_ASSERT_LOG)
    expect(x.kind).toBe('node-assert')
    expect(x.lines.join('\n')).toContain('1 !== 2')
    expect(x.lines.join('\n')).not.toContain('Node.js v20')
    expect(x.locations.map(l => l.path)).toEqual(['/home/runner/work/lazyhub/lazyhub/src/math.js'])
  })

  it('tsc: lists consecutive errors with their continuation lines and path(line,col) refs', () => {
    const x = extractExcerpt(TSC_LOG)
    expect(x.kind).toBe('tsc')
    expect(x.lines).toHaveLength(3)
    expect(x.lines[1]).toContain('The expected type')
    expect(x.locations).toEqual([
      { path: 'src/features/prs/list.jsx', line: 42, col: 7 },
      { path: 'src/app.jsx', line: 9, col: 1 },
    ])
  })

  it('eslint: keeps the file header and its error rows', () => {
    const x = extractExcerpt(ESLINT_LOG)
    expect(x.kind).toBe('eslint')
    expect(x.lines[0]).toContain('src/executor/core.js')
    expect(x.lines).toHaveLength(3)
    expect(x.lines.join('\n')).not.toContain('2 problems')
  })

  it('generic Error: stack trace, with posix, file:// and Windows paths; node_modules dropped', () => {
    const x = extractExcerpt(STACK_TRACE_LOG)
    expect(x.kind).toBe('stack-trace')
    expect(x.locations.map(l => l.path)).toEqual([
      '/home/runner/work/lazyhub/lazyhub/src/view.js',
      '/home/runner/work/lazyhub/lazyhub/src/main.js',
      'C:/a/lazyhub/lazyhub/src/win.js',
    ])
    expect(x.locations[0]).toMatchObject({ line: 30, col: 15 })
  })

  it('works on bare lines with no gh job/step/timestamp prefix', () => {
    const x = extractExcerpt('Error: boom\n    at f (src/a.js:1:2)\n')
    expect(x).toMatchObject({ kind: 'stack-trace', job: null, step: null })
    expect(x.locations).toEqual([{ path: 'src/a.js', line: 1, col: 2 }])
  })
})

describe('extractExcerpt: never guesses', () => {
  it('falls back to the ##[error] annotation, labelled as such', () => {
    const x = extractExcerpt(ANNOTATION_ONLY_LOG)
    expect(x.kind).toBe('step-error')
    expect(x.lines[0]).toContain('exit code 137')
    expect(x.locations).toEqual([])
  })

  it('an unrecognised failure is returned as the unparsed tail with no locations', () => {
    const x = extractExcerpt(UNPARSED_LOG)
    expect(x.kind).toBe('unparsed')
    expect(x.locations).toEqual([])
    expect(x.lines.at(-1)).toContain('the server said no')
  })

  it('empty or whitespace-only logs give null', () => {
    expect(extractExcerpt('')).toBeNull()
    expect(extractExcerpt('  \n\n')).toBeNull()
    expect(extractExcerpt(undefined)).toBeNull()
  })

  it('does not take a "Process completed with exit code" annotation for an Error: trace', () => {
    expect(extractExcerpt('##[error]Error: Process completed with exit code 1.').kind).toBe('step-error')
  })
})

describe('bounds', () => {
  it('caps excerpt lines and line width, and says it truncated', () => {
    const frames = Array.from({ length: 200 }, (_, i) => `    at f${i} (src/a.js:${i + 1}:1)`)
    const x = extractExcerpt(['Error: deep', ...frames, ...['x'.repeat(5)]].join('\n'))
    expect(x.lines.length).toBeLessThanOrEqual(MAX_EXCERPT_LINES)
    const long = extractExcerpt(`Error: ${'y '.repeat(500)}`)
    expect(long.lines[0].length).toBeLessThanOrEqual(MAX_LINE_CHARS)
  })

  it('bounds a huge log: only the head is parsed and the excerpt is flagged truncated', () => {
    const huge = `Error: first\n    at a (src/a.js:1:1)\n${'noise line\n'.repeat(600_000)}`
    const t0 = Date.now()
    const x = extractExcerpt(huge)
    expect(x.kind).toBe('stack-trace')
    expect(x.truncated).toBe(true)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('redaction and sanitising', () => {
  const excerpt = extractExcerpt(SECRET_LOG)
  const text = excerpt.lines.join('\n')
  it('the secret fixture is fully inside the excerpt (so the checks below are not vacuous)', () => {
    expect(excerpt.lines).toHaveLength(7)
    expect(text).toContain('DB_PASSWORD=[REDACTED]')
  })
  it.each([
    ['bearer token', 'abcdefghijklmnop12345'],
    ['GitHub PAT', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['AWS key', 'AKIAABCDEFGHIJKLMNOP'],
    ['npm token', 'npm_abcdefghijklmnopqrst'],
    ['password value', 'hunter2hunter2'],
    ['URL credentials and query', 'user:pw@'],
    ['URL query string', 'sig=abc123'],
  ])('redacts %s', (_n, secret) => {
    expect(text).not.toContain(secret)
  })

  it('strips ANSI and control characters', () => {
    expect(text).toContain('red ansi')
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/)
  })

  it('redactLine leaves ordinary text and paths alone', () => {
    expect(redactLine('    at f (src/features/prs/list.jsx:42:7)')).toBe('    at f (src/features/prs/list.jsx:42:7)')
  })

  it('redacts the job and step names too', () => {
    const x = extractExcerpt(ghLog('job ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'step', ['Error: x']))
    expect(x.job).not.toContain('ghp_')
  })
})

describe('extractLocations', () => {
  it('ignores node: internals, URLs, zero lines and duplicates', () => {
    const refs = extractLocations([
      'at x (node:internal/modules/cjs/loader:1554:14)',
      'at y (https://example.com/a.js:3:4)',
      'at z (src/a.js:0:1)',
      'at q (src/a.js:5:1)',
      'at q (src/a.js:5:1)',
    ])
    expect(refs).toEqual([{ path: 'src/a.js', line: 5, col: 1 }])
  })
})

describe('loadFailureExcerpt: every unknown is a state, never a guess', () => {
  const fetching = result => async () => result
  it('ok -> excerpt', async () => {
    const r = await loadFailureExcerpt('o/r', { jobId: 1 }, fetching({ state: 'ok', text: VITEST_LOG, detail: '' }))
    expect(r.state).toBe('ok')
    expect(r.excerpt.kind).toBe('vitest-jest')
  })
  it.each(['expired', 'rate_limit', 'pending', 'too_large', 'unavailable', 'empty'])('%s passes through with no excerpt', async state => {
    const r = await loadFailureExcerpt('o/r', { jobId: 1 }, fetching({ state, text: '', detail: 'why' }))
    expect(r).toEqual({ state, detail: 'why', excerpt: null })
  })
  it('an ok fetch whose text has no content is empty, not ok', async () => {
    const r = await loadFailureExcerpt('o/r', { jobId: 1 }, fetching({ state: 'ok', text: '\n', detail: '' }))
    expect(r.state).toBe('empty')
  })
})
