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
    expect(toLogLines('ok\tpkg\t0.3s')).toEqual(['ok\tpkg\t0.3s'])
  })
  it('titles the run without empty parts', () => {
    expect(logTitle({ workflowName: 'CI', headBranch: '', conclusion: 'success' })).toBe('CI · success')
    expect(logTitle({ workflowName: 'CI', headBranch: 'main', status: 'in_progress' })).toBe('CI · main · in_progress')
  })
  it('strips ANSI and trailing CR, and tolerates non-string input', () => {
    expect(toLogLines('\x1b[31mred\x1b[0m\r')).toEqual(['red'])
    expect(toLogLines(null)).toEqual([])
  })
})
