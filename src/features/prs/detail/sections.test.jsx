import React from 'react'
import { Box } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, cleanup } from '../../../test/test-helpers.jsx'
import { buildContentRows } from './content-rows.jsx'
import { sortChecks, CheckRow } from './Checks.jsx'
import { PRDetailHeader } from './Header.jsx'
import { AssigneesRow } from './Metadata.jsx'
import { ReviewerRow } from './Reviewers.jsx'
import { MergeStatusRow, RequiredChecksRow } from './MergeStatus.jsx'
import { PRComments } from '../comments.jsx'
import githubDark from '../../../themes/github-dark.js'

vi.mock('../../../hooks/useGh.js', () => ({
  useGh: () => ({
    data: { threads: { total: 1, hasNextPage: false }, conversationPage: { total: 1, hasNextPage: false }, conversation: [{ id: 'conv-1', kind: 'conversation', body: 'conv&amp;body', user: { login: 'conv&amp;user' }, createdAt: '2026-01-01T00:00:00Z' }], comments: [{
      id: 'comment-1', body: 'safe&amp;comment\nextra', path: 'safe&amp;path\nextra', line: 4,
      user: { login: 'safe&amp;name\nextra' }, createdAt: '2026-01-01T00:00:00Z',
    }] },
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))

const pr = {
  number: 42, title: 'Parser improvements', state: 'OPEN',
  author: { login: 'alice' }, updatedAt: '2026-01-01T00:00:00Z',
  baseRefName: 'main', headRefName: 'feature/parser',
  mergeStateStatus: 'CLEAN', body: 'First paragraph\nSecond paragraph',
}

afterEach(cleanup)

describe('PR detail section contracts', () => {
  it('retains scroll anchors, reviewer precedence and searchable body elements', () => {
    const rows = buildContentRows({
      ...pr,
      assignees: [{ login: 'alice' }], labels: [{ name: 'bug', color: 'ff0000' }],
      reviews: [
        { author: { login: 'bob' }, state: 'CHANGES_REQUESTED' },
        { author: { login: 'bob' }, state: 'APPROVED' },
      ],
      reviewRequests: [{ login: 'bob' }, { name: 'maintainers' }],
    }, [{ name: 'test', conclusion: 'SUCCESS' }], {
      requiredReviews: 2, requireCodeOwnerReviews: true,
      requireStatusChecks: true, requiredChecks: ['test'],
    }, 80, githubDark)

    expect(rows.map(row => row.id)).toEqual([
      'assignees', 'labels', 'sep-meta', 'rev-hdr', 'rev-bob', 'rev-maintainers', 'sep-rev',
      'checks-hdr', 'check-0', 'sep-checks', 'merge-hdr', 'prot-reviews', 'prot-checks',
      'sep-merge', 'body-hdr', 'body-md-0', 'body-md-1',
    ])
    const view = renderWithProviders(<Box flexDirection="column">{rows.map(row => row.el)}</Box>)
    expect(view.lastFrame()).toContain('bob approved')
    expect(view.lastFrame()).not.toContain('changes requested')
    expect(view.lastFrame()).toContain('maintainers')
    expect(view.lastFrame()).toContain('Requires 2 reviews + CODEOWNERS')
    expect(view.lastFrame()).toContain('First paragraph')
    expect(view.lastFrame()).toContain('Second paragraph')
  })

  it('omits empty sections without losing the merge row', () => {
    expect(buildContentRows({ state: 'OPEN' }, [], null, 80, githubDark).map(row => row.id))
      .toEqual(['merge-hdr', 'sep-merge'])
  })

  it('uses one non-mutating check order for rendering and keyboard navigation', () => {
    const checks = [
      { name: 'pass', conclusion: 'SUCCESS' },
      { name: 'skip', conclusion: 'SKIPPED' },
      { name: 'pending', status: 'IN_PROGRESS' },
      { name: 'fail', conclusion: 'FAILURE', appName: 'CI service' },
    ]
    const rollup = [{ context: 'fallback', state: 'ERROR' }]
    const ordered = sortChecks(checks, { statusCheckRollup: rollup })
    expect(ordered.map(check => check.name)).toEqual(['fail', 'pending', 'pass', 'skip'])
    expect(checks.map(check => check.name)).toEqual(['pass', 'skip', 'pending', 'fail'])
    expect(sortChecks([], { statusCheckRollup: rollup })).toEqual(rollup)
    expect(sortChecks(null, null)).toEqual([])
    const rows = buildContentRows(pr, checks, null, 80, githubDark, 0)
    const view = renderWithProviders(<Box flexDirection="column">{rows.map(row => row.el)}</Box>)
    const frame = view.lastFrame()
    expect(frame).toContain('fail  (CI service)')
    expect(frame.indexOf('fail')).toBeLessThan(frame.indexOf('pending'))
    expect(frame.indexOf('pending')).toBeLessThan(frame.indexOf('pass'))
  })
})

const hostile = 'safe&amp;name\nextra'
const safe = 'safe&name extra'

describe('PR detail untrusted display fields', () => {
  it.each([
    ['author', <PRDetailHeader pr={{ ...pr, author: { login: hostile } }} />],
    ['base branch', <PRDetailHeader pr={{ ...pr, baseRefName: hostile }} />],
    ['head branch', <PRDetailHeader pr={{ ...pr, headRefName: hostile }} />],
    ['assignee', <AssigneesRow assignees={[{ login: hostile }]} />],
    ['reviewer', <ReviewerRow reviewer={{ login: hostile, state: 'APPROVED' }} />],
    ['review state', <ReviewerRow reviewer={{ login: 'bob', state: hostile }} />],
    ['check name', <CheckRow check={{ name: hostile }} index={0} checkCursor={0} />],
    ['check app', <CheckRow check={{ name: 'test', appName: hostile }} index={0} checkCursor={0} />],
    ['required check', <RequiredChecksRow protection={{ requiredChecks: [hostile] }} />],
    ['merge method', <MergeStatusRow pr={{ ...pr, autoMergeRequest: { mergeMethod: hostile } }} />],
  ])('sanitizes the %s before rendering', (_name, element) => {
    const view = renderWithProviders(element)
    expect(view.lastFrame()).toContain(safe)
    expect(view.lastFrame()).not.toContain('&amp;')
  })

  it('sanitizes API-derived comment paths, authors and bodies', () => {
    const view = renderWithProviders(<PRComments prNumber={42} repo="owner/repo" onBack={() => {}} />)
    const frame = view.lastFrame()
    expect(frame).toContain('safe&path extra')
    expect(frame).toContain('@safe&name extra')
    expect(frame).toContain('safe&comment')
    expect(frame).toContain('conv&body')
    expect(frame).toContain('@conv&user')
    expect(frame).toContain('extra')
    expect(frame).not.toContain('&amp;')
  })
})
