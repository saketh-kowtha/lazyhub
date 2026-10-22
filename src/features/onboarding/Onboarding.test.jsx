/**
 * Onboarding.test.jsx — zero-configuration watch-only first run (#70).
 *
 * Drives the real <Onboarding> + flow + doctor/watch-only code over a stubbed
 * read-only gh (execa is mocked beneath the real runGh() chokepoint) and asserts
 * the safety acceptance criteria: every recorded gh call classifies as a read,
 * nothing is written to disk, and quitting leaves nothing behind.
 */

import React from 'react'
import { mkdtempSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))

import { execa } from 'execa'
import { classifyGh } from '../../daemon/protocol.js'
import { renderWithProviders, flush, cleanup, waitForExpectation, waitForInputReady } from '../../test/test-helpers.jsx'
import { Onboarding } from './Onboarding.jsx'
import { classifyFailure, isOwnerName, listWindowSize, shouldOnboard, windowStart } from './flow.js'

const fixture = () => JSON.parse(readFileSync(new URL('../../watch-only/fixtures/pr-activity.json', import.meta.url), 'utf8'))
const ok = body => ({ exitCode: 0, stdout: JSON.stringify(body), stderr: '' })
const fail = stderr => ({ exitCode: 1, stdout: '', stderr })

let calls
let home
let originalHome

/** Stub gh. `mode` overrides individual endpoints with a failure. */
function stubGh(mode = {}) {
  execa.mockImplementation(async (bin, args) => {
    calls.push({ bin, args })
    if (mode.user) return mode.user
    if (args[0] === 'api' && args[1] === 'user') return ok({ login: 'octocat' })
    if (args[0] === 'repo' && args[1] === 'view' && args[2] !== '--json' && mode.lookup) return mode.lookup(args)
    if (args[0] === 'repo' && args[1] === 'view') {
      return args.includes('nameWithOwner') ? ok({ nameWithOwner: 'octocat/hello' })
        : ok({ id: 'R_1', nameWithOwner: args[2], url: `https://github.com/${args[2]}` })
    }
    if (args[0] === 'api' && args[1].startsWith('user/repos') && mode.list) return mode.list
    if (args[0] === 'api' && args[1].startsWith('user/repos')) return ok([{ full_name: 'octocat/hello' }, { full_name: 'acme/platform' }])
    if (args[0] === 'api' && args[1].includes('/rulesets')) return mode.rulesets || ok([])
    if (args[0] === 'api' && args[1] === 'graphql') return mode.graphql || ok(mode.activity || fixture())
    return fail('unexpected stub call')
  })
}

function start(props = {}) {
  const onDone = vi.fn()
  const view = renderWithProviders(<Onboarding onDone={onDone} {...props} />)
  return { onDone, ...view }
}

const frame = view => view.lastFrame() || ''

async function pick(view) {
  await waitForExpectation(() => expect(frame(view)).toContain('Pick a repository to observe'))
  await waitForInputReady(view)
  view.stdin.write('\r')
}

function expectOnlyReads() {
  expect(calls.length).toBeGreaterThan(0)
  for (const { bin, args } of calls) {
    expect(bin).toBe('gh')
    expect(classifyGh(args)).toBe('read')
  }
}

beforeEach(() => {
  calls = []
  originalHome = process.env.HOME
  home = mkdtempSync(join(tmpdir(), 'lazyhub-onboard-'))
  process.env.HOME = home
})

afterEach(() => {
  cleanup()
  process.env.HOME = originalHome
  vi.restoreAllMocks()
  execa.mockReset()
})

describe('first-run onboarding', () => {
  it('happy path: existing gh login -> pick repo -> watch-only report with doctor coverage language, no writes', async () => {
    stubGh()
    const view = start()
    await waitForExpectation(() => expect(frame(view)).toContain('octocat/hello'))
    expect(frame(view)).toContain('watch-only · read-only')
    expect(frame(view)).toContain('writes nothing to GitHub')
    await pick(view)

    await waitForExpectation(() => expect(frame(view)).toContain('Coverage (github_enforced | managed_gateway | advisory | ungoverned)'))
    const out = frame(view)
    expect(out).toMatch(/pr_merge\s+advisory/)
    expect(out).toContain('local_agent_approval')
    expect(out).toContain('(coming, not available yet; #245)')
    expect(out).toContain('solo/pilot limits')
    expect(out).not.toMatch(/https?:\/\//)

    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(view.onDone).toHaveBeenCalledWith({ status: 'completed', repo: 'octocat/hello' }))
    expectOnlyReads()
    expect(readdirSync(home)).toEqual([])
  })

  it('missing auth: explains gh auth login, never logs in, quits cleanly', async () => {
    stubGh({ user: fail('To get started with GitHub CLI, please run:  gh auth login') })
    const view = start()
    await waitForExpectation(() => expect(frame(view)).toContain('Not signed in to GitHub through gh.'))
    expect(frame(view)).toContain('gh auth login')
    expect(calls.map(c => c.args.join(' '))).toEqual(['api user'])
    await waitForInputReady(view)
    view.stdin.write('q')
    await waitForExpectation(() => expect(view.onDone).toHaveBeenCalledWith({ status: 'cancelled' }))
    expectOnlyReads()
    expect(readdirSync(home)).toEqual([])
  })

  it('insufficient permissions: report downgrades to ungoverned and says why', async () => {
    stubGh({
      graphql: fail('gh: Resource not accessible by personal access token (HTTP 403)'),
      rulesets: fail('gh: Resource not accessible by personal access token (HTTP 403)'),
    })
    const view = start()
    await pick(view)
    await waitForExpectation(() => expect(frame(view)).toContain('Coverage ('))
    const out = frame(view)
    expect(out).toContain('rulesets: permission_missing')
    expect(out).toContain('Gaps: permission_missing')
    expect(out).toContain('cannot read this repository')
    expect(out).not.toMatch(/pr_merge\s+advisory/)
    expectOnlyReads()
  })

  it('rate limit: shows the observation gap instead of claiming coverage', async () => {
    stubGh({ graphql: fail('gh: API rate limit exceeded for user') })
    const view = start()
    await pick(view)
    await waitForExpectation(() => expect(frame(view)).toContain('Gaps: rate_limited'))
    expect(frame(view)).toContain('rate limit reached')
    expect(frame(view)).not.toMatch(/pr_merge\s+advisory/)
    expectOnlyReads()
  })

  it('rate limit while checking login: error panel with retry, which re-reads', async () => {
    stubGh({ user: fail('gh: API rate limit exceeded for user') })
    const view = start()
    await waitForExpectation(() => expect(frame(view)).toContain('GitHub API rate limit reached.'))
    stubGh()
    await waitForInputReady(view)
    view.stdin.write('r')
    await waitForExpectation(() => expect(frame(view)).toContain('Pick a repository to observe'))
    expectOnlyReads()
  })

  it('unattributed activity is shown as attribution, separate from coverage', async () => {
    const activity = fixture()
    const review = activity.data.repository.pullRequests.nodes[0].reviews.nodes[0]
    review.author = { login: 'mystery-helper', __typename: 'Bot' }
    stubGh({ activity })
    const view = start()
    await pick(view)
    await waitForExpectation(() => expect(frame(view)).toContain('Attribution (who GitHub says acted)'))
    expect(frame(view)).toMatch(/unattributed [1-9]/)
    expect(frame(view)).not.toContain('counts as ungoverned')
    expect(frame(view)).toMatch(/pr_merge\s+advisory/) // unattributed activity does not change coverage
    expectOnlyReads()
  })

  it('Esc/b returns from the report to the repository list without completing', async () => {
    stubGh()
    const view = start()
    await pick(view)
    await waitForExpectation(() => expect(frame(view)).toContain('Coverage ('))
    await waitForInputReady(view)
    view.stdin.write('b')
    await waitForExpectation(() => expect(frame(view)).toContain('Pick a repository to observe'))
    expect(view.onDone).not.toHaveBeenCalled()
  })
})

const manyRepos = n => ok(Array.from({ length: n }, (_, i) => ({ full_name: `acme/repo-${String(i).padStart(2, '0')}` })))
const selectedLine = view => frame(view).split('\n').find(l => l.includes('▶')) || ''
const listReady = view => waitForExpectation(() => expect(frame(view)).toContain('Pick a repository to observe'))
const type = async (view, text) => { view.stdin.write(text); await flush(40) }

describe('repository selection (#280)', () => {
  it('lists with explicit pagination through a typed read, and keeps the selected row visible at 24 rows', async () => {
    stubGh({ list: manyRepos(40) })
    const view = start()
    await listReady(view)
    await flush(50)
    const listCall = calls.find(c => c.args[1]?.startsWith('user/repos'))
    expect(listCall.args[1]).toContain('per_page=100')
    expect(classifyGh(listCall.args)).toBe('read')
    expect(frame(view).split('\n').length).toBeLessThanOrEqual(24)
    for (let n = 1; n <= 40; n += 1) {
      await type(view, 'j')
      expect(selectedLine(view)).toContain(`acme/repo-${String(n - 1).padStart(2, '0')}`) // row 0 is the current-directory repo
      expect(frame(view).split('\n').length).toBeLessThanOrEqual(24)
    }
    expect(frame(view)).toContain('of 41')
  })

  it('rapid navigation clamps at both ends and Enter observes the highlighted row', async () => {
    stubGh({ list: manyRepos(40) })
    const view = start()
    await listReady(view)
    await flush(50)
    view.stdin.write('j'.repeat(200))
    await waitForExpectation(() => expect(selectedLine(view)).toContain('acme/repo-39'))
    view.stdin.write('k'.repeat(200))
    await waitForExpectation(() => expect(selectedLine(view)).toContain('octocat/hello'))
    view.stdin.write('j'.repeat(13))
    await waitForExpectation(() => expect(selectedLine(view)).toContain('acme/repo-12'))
    await flush(50) // let Ink re-attach its input handler after the last render
    view.stdin.write('\r')
    await waitForExpectation(() => expect(frame(view)).toContain('acme/repo-12'))
    await waitForExpectation(() => expect(frame(view)).toContain('Coverage ('))
    view.stdin.write('\r')
    await waitForExpectation(() => expect(view.onDone).toHaveBeenCalledWith({ status: 'completed', repo: 'acme/repo-12' }))
    expectOnlyReads()
  })

  it('search filters loaded repos; the selection is bound to the repo, not the row index', async () => {
    stubGh({ list: manyRepos(40) })
    const view = start()
    await listReady(view)
    await flush(50)
    view.stdin.write('jjjjj')
    await waitForExpectation(() => expect(selectedLine(view)).toContain('acme/repo-04'))
    await type(view, '/')
    await type(view, 'repo-3')
    expect(frame(view)).toContain('matching (41 loaded)')
    expect(frame(view)).not.toContain('acme/repo-04')
    view.stdin.write('\x1b')
    await waitForExpectation(() => expect(selectedLine(view)).toContain('acme/repo-04'))
  })

  it('reaches a repository beyond the first page by validated owner/name lookup', async () => {
    stubGh({ list: manyRepos(40), lookup: () => ok({ nameWithOwner: 'Other-Org/Rarely-Used' }) })
    const view = start()
    await listReady(view)
    await flush(50)
    await type(view, '/')
    await type(view, 'other-org/rarely-used')
    expect(selectedLine(view)).toContain('look up other-org/rarely-used on GitHub (read-only)')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(frame(view)).toContain('Coverage ('))
    expect(frame(view)).toContain('Other-Org/Rarely-Used')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(view.onDone).toHaveBeenCalledWith({ status: 'completed', repo: 'Other-Org/Rarely-Used' }))
    expect(calls.some(c => c.args.join(' ') === 'repo view other-org/rarely-used --json nameWithOwner')).toBe(true)
    expectOnlyReads()
    expect(readdirSync(home)).toEqual([])
  })

  it('a lookup the login cannot read stays on the list with a message', async () => {
    stubGh({ lookup: () => fail('gh: Could not resolve to a Repository (HTTP 404)') })
    const view = start()
    await listReady(view)
    await flush(50)
    await type(view, '/')
    await type(view, 'secret/hidden')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(frame(view)).toContain('secret/hidden was not found, or your gh login cannot read it.'))
    expect(frame(view)).toContain('Pick a repository to observe')
    expect(view.onDone).not.toHaveBeenCalled()
  })

  it('Esc cancels an in-flight lookup so it cannot navigate afterwards', async () => {
    let release
    stubGh({ lookup: () => new Promise(resolve => { release = () => resolve(ok({ nameWithOwner: 'a/b' })) }) })
    const view = start()
    await listReady(view)
    await flush(50)
    await type(view, '/')
    await type(view, 'a/b')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(frame(view)).toContain('Checking a/b (read-only)'))
    await flush(50)
    view.stdin.write('\x1b')
    await waitForExpectation(() => expect(frame(view)).not.toContain('Checking a/b'))
    release()
    await flush(80)
    expect(frame(view)).toContain('Pick a repository to observe')
    expect(frame(view)).not.toContain('Coverage (')
  })

  it('rejects malformed owner/name before any gh call', async () => {
    expect(isOwnerName('acme/platform')).toBe(true)
    expect(isOwnerName('--web/x')).toBe(false)
    expect(isOwnerName('a/b c')).toBe(false)
    expect(isOwnerName('a/b/c')).toBe(false)
    expect(isOwnerName('-x/y')).toBe(false)
  })

  it('empty results: says so and Enter does nothing', async () => {
    const view = start({ loadSessionFn: async () => ({ login: 'octocat', repos: [], listError: null }) })
    await listReady(view)
    expect(frame(view)).toContain('No repositories found for this account.')
    await flush(50)
    view.stdin.write('\r')
    await flush(50)
    expect(view.onDone).not.toHaveBeenCalled()
    await type(view, '/')
    await type(view, 'zzz')
    expect(frame(view)).toContain('Try owner/name to look one up.')
  })

  it('list failure and permission error fall back to the current directory repository', async () => {
    for (const [stderr, why] of [['gh: HTTP 500 Server Error', 'error'], ['gh: Resource not accessible by personal access token (HTTP 403)', 'permission']]) {
      stubGh({ list: fail(stderr) })
      const view = start()
      await listReady(view)
      expect(frame(view)).toContain(`Repository list unavailable (${why})`)
      expect(frame(view)).toContain('octocat/hello')
      cleanup()
      calls = []
    }
  })

  it('cancelling mid-search leaves nothing on disk and only reads', async () => {
    stubGh({ list: manyRepos(40) })
    const view = start()
    await listReady(view)
    await flush(50)
    await type(view, 'jjj')
    view.stdin.write('q')
    await waitForExpectation(() => expect(view.onDone).toHaveBeenCalledWith({ status: 'cancelled' }))
    expectOnlyReads()
    expect(readdirSync(home)).toEqual([])
  })

  it('windowing keeps the selected index inside the visible slice', () => {
    expect(listWindowSize(24)).toBe(12)
    expect(listWindowSize(10)).toBe(3)
    for (const size of [3, 12]) {
      for (const total of [1, 5, 14, 31, 100]) {
        for (let sel = 0; sel < total; sel += 1) {
          const start = windowStart(total, sel, size)
          expect(sel).toBeGreaterThanOrEqual(start)
          expect(sel).toBeLessThan(start + Math.min(size, total))
          expect(start + Math.min(size, total)).toBeLessThanOrEqual(total)
        }
      }
    }
  })
})

describe('first-run gating', () => {
  const base = { isTTY: true, env: {}, argv: ['node', 'lazyhub'], configExists: false }

  it('runs only for an interactive session with no config and no launcher-chosen repo', () => {
    expect(shouldOnboard(base)).toBe(true)
    expect(shouldOnboard({ ...base, isTTY: false })).toBe(false)
    expect(shouldOnboard({ ...base, configExists: true })).toBe(false)
    expect(shouldOnboard({ ...base, env: { GHUI_REPO: 'a/b' } })).toBe(false)
    expect(shouldOnboard({ ...base, env: { LAZYHUB_SKIP_ONBOARDING: '1' } })).toBe(false)
  })

  it('--onboarding re-runs it for existing users, but never without a TTY', () => {
    expect(shouldOnboard({ ...base, configExists: true, argv: ['node', 'lazyhub', '--onboarding'] })).toBe(true)
    expect(shouldOnboard({ ...base, isTTY: false, argv: ['node', 'lazyhub', '--onboarding'] })).toBe(false)
  })

  it('classifies gh failures for display', () => {
    expect(classifyFailure(new Error('spawn gh ENOENT'))).toBe('no_gh')
    expect(classifyFailure({ message: 'x', stderr: 'run: gh auth login' })).toBe('auth')
    expect(classifyFailure(new Error('GitHub API rate limit exceeded'))).toBe('rate_limit')
    expect(classifyFailure(new Error('Resource not found'))).toBe('permission')
    expect(classifyFailure(new Error('boom'))).toBe('error')
  })
})
