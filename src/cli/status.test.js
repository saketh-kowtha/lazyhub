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

  it('prints a JSON object with reason on a cold cache in json format', () => {
    const parsed = JSON.parse(formatStatus(null, 'json'))
    expect(parsed.reason).toBe('no_cache')
    expect(parsed.counts).toBeNull()
    expect(parsed.schema_version).toBe(1)
    expect(parsed.cache_age_seconds).toBeNull()
  })

  it('keeps the cold-cache text line for tmux and starship formats', () => {
    expect(formatStatus(null, 'tmux')).toBe('lazyhub: no data - open the app once')
    expect(formatStatus(null, 'starship')).toBe('lazyhub: no data - open the app once')
  })

  it('does not add a reason key to warm json output', () => {
    const summary = {
      schema_version: 1,
      counts: { review_requested: 0, failing_ci: 0, unread_notifications: 0 },
      cache_age_seconds: 1,
    }
    expect(JSON.parse(formatStatus(summary, 'json'))).not.toHaveProperty('reason')
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
