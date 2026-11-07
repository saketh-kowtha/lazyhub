import { describe, expect, it } from 'vitest'
import { toLogLines, logTitle } from './log-lines.js'

describe('toLogLines (#463)', () => {
  it('drops the job and step columns and trims the timestamp', () => {
    expect(toLogLines('build\tSet up job\t2026-01-01T00:00:03.0000000Z hello')).toEqual(['00:00:03 hello'])
  })
  it('turns group markers into headers (also behind a gh prefix) and drops endgroup', () => {
    const raw = 'build\tRun\t2026-01-01T00:00:00.1Z ##[group]Run npm test\nbuild\tRun\t2026-01-01T00:00:01.1Z ##[endgroup]\nplain line'
    expect(toLogLines(raw)).toEqual(['=== Run npm test ===', 'plain line'])
  })
  it('strips the gh prefix only when the third field is a timestamp', () => {
    expect(toLogLines('ok\tpkg\t0.3s')).toEqual(['ok  pkg 0.3s'])
  })
  it('titles the run without empty parts', () => {
    expect(logTitle({ workflowName: 'CI', headBranch: '', conclusion: 'success' })).toBe('CI · success')
    expect(logTitle({ workflowName: 'CI', headBranch: 'main', status: 'in_progress' })).toBe('CI · main · in_progress')
  })
  it('strips ANSI and trailing CR, and tolerates non-string input', () => {
    expect(toLogLines('\x1b[31mred\x1b[0m\r')).toEqual(['red'])
    expect(toLogLines(null)).toEqual([])
  })
  it('cleans escape strings, 8-bit introducers and progress lines', () => {
    const ESC = '\x1b'
    const raw = [
      `build\tRun\t2026-01-01T00:00:03.0000000Z a${ESC}]0;title\x07b`,
      'build\tRun\t2026-01-01T00:00:04.0000000Z c\x9b31md\x9d0;t\x9ce',
      'build\tRun\t2026-01-01T00:00:05.0000000Z progress 10%\r50%\r100%',
    ].join('\n')
    expect(JSON.stringify(toLogLines(raw))).toBe(JSON.stringify(['00:00:03 ab', '00:00:04 cde', '00:00:05 progress 10%', '50%', '100%']))
  })
  it('expands tabs after the gh prefix is removed', () => {
    expect(toLogLines('build\tRun\t2026-01-01T00:00:03.0000000Z a\tb')).toEqual(['00:00:03 a  b'])
  })
})
