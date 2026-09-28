import { describe, expect, it } from 'vitest'
import { formatStatus, summarizeStatus } from './status.js'

const NOW = 1_700_000_000_000

describe('ambient status', () => {
  it('returns null when no relevant cache entries exist', () => {
    expect(summarizeStatus([], NOW)).toBeNull()
  })

  it('summarizes review requests, failing CI, notifications, and age', () => {
    const summary = summarizeStatus([
      {
        ts: NOW - 30_000,
        meta: { op: 'listPRs' },
        payload: [
          { reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [] },
          { reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'FAILURE' }] },
        ],
      },
      {
        ts: NOW - 20_000,
        meta: { op: 'listNotifications' },
        payload: [{ unread: true }, { unread: false }, { unread: true }],
      },
    ], NOW)

    expect(summary).toEqual({
      schema_version: 1,
      counts: {
        review_requested: 1,
        failing_ci: 1,
        unread_notifications: 2,
      },
      cache_age_seconds: 20,
    })
  })

  it('prints a cold-cache message without failing the status bar', () => {
    expect(formatStatus(null, 'tmux')).toBe('lazyhub: no data - open the app once')
  })

  it('prints stable JSON for machine consumers', () => {
    const summary = {
      schema_version: 1,
      counts: { review_requested: 1, failing_ci: 0, unread_notifications: 2 },
      cache_age_seconds: 5,
    }
    expect(JSON.parse(formatStatus(summary, 'json'))).toEqual(summary)
  })
})
