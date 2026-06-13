import { describe, expect, it, afterEach } from 'vitest'
import {
  getGhHealthSnapshot,
  recordGhFailure,
  recordGhSuccess,
  resetGhHealthForTest,
} from './useGhHealth.js'

afterEach(() => resetGhHealthForTest())

describe('useGhHealth state machine', () => {
  it('enters degraded state on failures and clears only after all call sites recover', () => {
    recordGhFailure('listPRs:a', new Error('gh list failed'))
    expect(getGhHealthSnapshot()).toMatchObject({ degraded: true, failingCount: 1 })
    expect(getGhHealthSnapshot().error.message).toBe('gh list failed')

    recordGhFailure('listIssues:b', new Error('gh issue failed'))
    expect(getGhHealthSnapshot()).toMatchObject({ degraded: true, failingCount: 2 })

    recordGhSuccess('listPRs:a')
    expect(getGhHealthSnapshot()).toMatchObject({ degraded: true, failingCount: 1 })

    recordGhSuccess('listIssues:b')
    expect(getGhHealthSnapshot()).toEqual({ degraded: false, failingCount: 0, error: null })
  })
})
