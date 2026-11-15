import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { sendInput } from '../../test/input-bus.js'
import { ReviewQueue, resetQueueSelection } from './view.jsx'
import { resetQueueMemory } from './useReviewQueue.js'
import { buildScopes, resetQueueScope } from './scope.js'
import { saveState } from '../../config.js'
import { evidence, FETCHED_AT, queueResult } from './queue.fixtures.js'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../test/input-bus.js')).mockUseInput(await import('react')),
}))

const frame = v => v.lastFrame() ?? ''
const NOW = Date.parse(FETCHED_AT) + 10_000
const review = { membership: ['review_requested'] }

// What GitHub would return per scope: the fetcher is handed the scope filter and answers for it.
const PLATFORM = evidence({ number: 412, title: 'Retry in webhook sender', repository: { nameWithOwner: 'acme/platform' } }, review)
const LEDGER = evidence({ number: 88, title: 'Fix invoice rounding', repository: { nameWithOwner: 'acme/ledger' } }, review)
const HELLO = evidence({ number: 9, title: 'Bump dependencies', repository: { nameWithOwner: 'octocat/hello' } }, review)
const ALL = [PLATFORM, LEDGER, HELLO]

function answer({ scope } = {}) {
  const repos = scope?.repos
  const org = scope?.org
  const rows = ALL.filter(i => (!repos || repos.includes(i.identity.repo)) && (!org || i.identity.repo.startsWith(`${org}/`)))
  return Promise.resolve(queueResult(rows))
}

const CWD = { repo: 'acme/platform', source: 'cwd' }

function mount({ scopes, width = 80, fetcher = vi.fn(answer) } = {}) {
  const view = renderWithProviders(
    <ReviewQueue scopes={scopes} onOpen={vi.fn()} innerWidth={width} listHeight={24} queueOptions={{ fetcher, now: () => NOW }} />,
  )
  return { view, fetcher }
}
async function press(input, key = {}) { sendInput(input, key); await flush(25) }

beforeEach(() => { vi.clearAllMocks(); resetQueueMemory(); resetQueueSelection(); saveState({ queueScope: '' }) })
afterEach(cleanup)

describe('queue scope: launched in a repo', () => {
  const scopes = () => buildScopes({ launch: CWD, sets: { work: ['acme/ledger', 'octocat/hello'] } })

  it('starts on the repo, asks GitHub for that repo only and says so', async () => {
    const { view, fetcher } = mount({ scopes: scopes() })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0].scope).toEqual({ repos: ['acme/platform'] })
    expect(frame(view)).toContain('scope: repo acme/platform (from this directory)')
    expect(frame(view)).toContain('s: account')
    expect(frame(view)).not.toContain('Fix invoice rounding')
  })

  it('s widens to the account, one key away, and shows every repo', async () => {
    const { view, fetcher } = mount({ scopes: scopes() })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press('s')
    await waitForExpectation(() => expect(frame(view)).toContain('scope: account'))
    await waitForExpectation(() => expect(frame(view)).toContain('Bump dependencies'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0].scope).toBeUndefined()
    expect(frame(view)).toContain('Review queue  account @octocat')
  })

  it('cycling back to a fresh scope reuses its rows: no extra gh call', async () => {
    const { view, fetcher } = mount({ scopes: scopes() })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press('s') // account
    await waitForExpectation(() => expect(frame(view)).toContain('Bump dependencies'))
    await flush(20)
    for (let i = 0; i < 3; i += 1) await press('s') // org acme, set work, repo again
    await waitForExpectation(() => expect(frame(view)).toContain('scope: repo acme/platform'))
    await flush(20)
    expect(frame(view)).toContain('Retry in webhook sender')
    // repo, account, org, set: one call each; the return to the repo made none
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('org scope filters by org, set scope by the configured repos', async () => {
    const { view, fetcher } = mount({ scopes: scopes() })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await press('s'); await press('s') // account, org acme (the owner of the launch repo)
    await waitForExpectation(() => expect(frame(view)).toContain('scope: org acme'))
    await waitForExpectation(() => expect(frame(view)).toContain('Fix invoice rounding'))
    expect(fetcher.mock.calls[2][0].scope).toEqual({ org: 'acme' })
    expect(frame(view)).not.toContain('Bump dependencies')
    await press('s') // set work
    await waitForExpectation(() => expect(frame(view)).toContain('scope: set work (2 repos)'))
    await waitForExpectation(() => expect(frame(view)).toContain('Fix invoice rounding'))
    expect(fetcher.mock.calls[3][0].scope).toEqual({ repos: ['acme/ledger', 'octocat/hello'] })
    expect(frame(view)).toContain('Bump dependencies')
    expect(frame(view)).not.toContain('Retry in webhook sender')
  })

  it('an empty repo scope names the scope and points at s', async () => {
    const fetcher = vi.fn(() => Promise.resolve(queueResult([])))
    const { view } = mount({ scopes: scopes(), fetcher })
    await waitForExpectation(() => expect(frame(view)).toContain('Nothing needs your attention here'))
    expect(frame(view)).toContain('in repo acme/platform')
    expect(frame(view)).toContain('s changes the scope (next: account)')
  })

  it('an empty account scope keeps the account wording', async () => {
    const fetcher = vi.fn(() => Promise.resolve(queueResult([])))
    const { view } = mount({ scopes: buildScopes({ orgs: ['octocat'] }), fetcher })
    await waitForExpectation(() => expect(frame(view)).toContain('Nothing needs your attention here'))
    expect(frame(view)).toContain('opened by you on github.com')
    expect(frame(view)).toContain('s changes the scope (next: org octocat)')
  })
})

describe('queue scope: outside a repo', () => {
  it('starts account-wide with no scope filter', async () => {
    const { view, fetcher } = mount({ scopes: buildScopes({ orgs: ['acme'] }) })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    expect(fetcher.mock.calls[0][0].scope).toBeUndefined()
    expect(frame(view)).toContain('scope: account')
    expect(frame(view)).toContain('Bump dependencies')
  })

  it('with nothing to cycle to, s is harmless and the line points at the config', async () => {
    const { view, fetcher } = mount({ scopes: buildScopes() })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    expect(frame(view)).toContain('no org or set in [queue] config')
    await press('s')
    expect(frame(view)).toContain('Retry in webhook sender')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('remembers the chosen org for the next mount of the screen', async () => {
    const scopes = buildScopes({ orgs: ['acme'] })
    const first = mount({ scopes })
    await waitForExpectation(() => expect(frame(first.view)).toContain('Retry in webhook sender'))
    await press('s')
    await waitForExpectation(() => expect(frame(first.view)).toContain('scope: org acme'))
    cleanup()
    // a new process: the session choice is gone, the saved one remains
    resetQueueScope()
    const second = mount({ scopes })
    await waitForExpectation(() => expect(frame(second.view)).toContain('scope: org acme'))
  })
})
