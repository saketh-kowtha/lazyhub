import { describe, expect, it } from 'vitest'
import { LABELS, REVIEW_MARKER, buildCommand, isDue, isoWeek, labelledByMaintainer, planTick, reviewRounds, taskLine } from './lib.mjs'

const label = (...names) => names.map(name => ({ name }))
const config = {
  maxJobsPerTick: 5,
  maxReviewRounds: 3,
  dailyCap: { builder: 2, reviewer: 2, ops: 1 },
  scheduled: [{ name: 'digest', role: 'ops', prompt: 'digest.md', every: 'week', weekday: 1 }],
}
const board = (over = {}) => ({ issues: [], prs: [], rounds: {}, trusted: new Set(), ...over })
const monday = new Date('2026-11-02T09:00:00')

describe('labelledByMaintainer', () => {
  const ev = (login, name = LABELS.ready) => ({ event: 'labeled', label: { name }, actor: { login } })

  it('trusts the label only when the latest application was by a maintainer', () => {
    expect(labelledByMaintainer([ev('owner')], LABELS.ready, ['owner'])).toBe(true)
    expect(labelledByMaintainer([ev('owner'), ev('stranger')], LABELS.ready, ['owner'])).toBe(false)
    expect(labelledByMaintainer([ev('owner', 'bug')], LABELS.ready, ['owner'])).toBe(false)
    expect(labelledByMaintainer([], LABELS.ready, ['owner'])).toBe(false)
  })
})

describe('planTick', () => {
  it('reviews before fixing before building, and builds only maintainer-labelled issues', () => {
    const jobs = planTick(board({
      issues: [{ number: 1, labels: label(LABELS.ready) }, { number: 2, labels: label(LABELS.ready) }],
      prs: [
        { number: 10, headRefName: 'agent/5-x', labels: label(LABELS.changesNeeded) },
        { number: 11, headRefName: 'agent/6-y', labels: label(LABELS.inReview) },
        { number: 12, headRefName: 'feature/z', labels: label(LABELS.inReview) },
      ],
      trusted: new Set([2]),
    }), config, {}, new Date('2026-11-03T09:00:00'))
    expect(jobs.map(j => `${j.kind}:${j.number}`)).toEqual(['review:11', 'fix:10', 'build:2'])
  })

  it('skips issues already in progress or blocked', () => {
    const jobs = planTick(board({
      issues: [{ number: 1, labels: label(LABELS.ready, LABELS.inProgress) }, { number: 2, labels: label(LABELS.ready, LABELS.blocked) }],
      trusted: new Set([1, 2]),
    }), config, {}, new Date('2026-11-03T09:00:00'))
    expect(jobs).toEqual([])
  })

  it('enforces daily caps using counts already spent today', () => {
    const issues = [3, 4, 5].map(number => ({ number, labels: label(LABELS.ready) }))
    const state = { counts: { date: '2026-11-03', builder: 1 } }
    const jobs = planTick(board({ issues, trusted: new Set([3, 4, 5]) }), config, state, new Date('2026-11-03T09:00:00'))
    expect(jobs.map(j => j.number)).toEqual([3])
  })

  it('escalates a PR to a human after the maximum review rounds instead of reviewing again', () => {
    const prs = [{ number: 20, headRefName: 'agent/7-z', labels: label(LABELS.inReview) }]
    const jobs = planTick(board({ prs, rounds: { 20: 3 } }), config, {}, new Date('2026-11-03T09:00:00'))
    expect(jobs).toEqual([{ kind: 'escalate', number: 20, role: 'none' }])
  })

  it('runs a weekly job on its weekday once per ISO week', () => {
    expect(planTick(board(), config, {}, monday).map(j => j.name)).toEqual(['digest'])
    expect(planTick(board(), config, { lastRun: { digest: isoWeek(monday) } }, monday)).toEqual([])
  })
})

describe('isDue', () => {
  it('runs a daily job once per date', () => {
    const job = { name: 'docs-sync', every: 'day' }
    expect(isDue(job, {}, monday)).toBe(true)
    expect(isDue(job, { lastRun: { 'docs-sync': '2026-11-02' } }, monday)).toBe(false)
  })
})

describe('reviewRounds', () => {
  it('counts only marked reviewer comments', () => {
    expect(reviewRounds([{ body: `${REVIEW_MARKER}\nok` }, { body: 'thanks' }, { body: REVIEW_MARKER }])).toBe(2)
  })
})

describe('buildCommand', () => {
  const tool = { cmd: ['codex', 'exec', '-C', '{cwd}', '-m', '{model}', '{prompt}'] }

  it('substitutes variables and keeps the prompt a single argv entry', () => {
    expect(buildCommand(tool, { prompt: 'do it; rm -rf /', cwd: '/w', model: 'm1' }))
      .toEqual(['codex', 'exec', '-C', '/w', '-m', 'm1', 'do it; rm -rf /'])
  })

  it('drops the model flag when no model is configured', () => {
    expect(buildCommand(tool, { prompt: 'p', cwd: '/w' })).toEqual(['codex', 'exec', '-C', '/w', 'p'])
  })
})

describe('taskLine', () => {
  it('names only the item number, never its text', () => {
    expect(taskLine({ kind: 'build', number: 9 }, 'o/r')).toBe('Task: implement issue #9 in o/r.')
  })
})
