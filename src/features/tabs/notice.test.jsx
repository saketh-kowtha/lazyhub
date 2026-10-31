/**
 * #469: the Focus pane shows ONE error notice that fits the width, and never
 * claims a cached read when nothing is cached.
 */
import React from 'react'
import { Box } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GhError } from '../../executor/gh-error.js'
import { GH_STDERR } from '../../executor/gh-stderr-fixtures.js'
import { cleanup, flush, renderWithProviders } from '../../test/test-helpers.jsx'

const loader = vi.hoisted(() => ({ fn: null }))

vi.mock('../../executor.js', async () => {
  const actual = await vi.importActual('../../executor.js')
  return { ...actual, listPRs: (...a) => loader.fn(...a), listIssues: (...a) => loader.fn(...a) }
})
vi.mock('../../cache.js', async () => {
  const actual = await vi.importActual('../../cache.js')
  return { ...actual, readCache: () => null, writeCache: () => {} }
})

const { TabView } = await import('./view.jsx')
const { resetGhMemoryCache } = await import('../../hooks/useGh.js')
const { classifyGhFailure } = await import('../../executor.js')

const offline = () => {
  const f = GH_STDERR.offline
  return new GhError({ message: f.stderr.split('\n')[0], stderr: f.stderr, exitCode: f.exitCode, args: f.args })
}
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // eslint-disable-line no-control-regex
const tab = { id: 'focus', label: 'Focus', panes: [{ kind: 'prs', title: 'Needs review', filter: {} }, { kind: 'issues', title: 'Assigned', filter: {} }] }

async function mountAt(columns, rows) {
  const view = renderWithProviders(<Box width={columns}><TabView tab={tab} repo="o/r" onOpenItem={() => {}} /></Box>)
  Object.defineProperty(view.stdout, 'columns', { value: columns, configurable: true })
  Object.defineProperty(view.stdout, 'rows', { value: rows, configurable: true })
  view.stdout.emit('resize')
  await flush(80)
  return stripAnsi(view.lastFrame())
}

describe('Focus error notices (#469)', () => {
  beforeEach(() => { resetGhMemoryCache(); loader.fn = async () => { throw offline() } })
  afterEach(cleanup)

  for (const [cols, rows] of [[80, 24], [120, 40]]) {
    it(`at ${cols}x${rows}: complete sentences, nothing wider than the screen, no cache claim`, async () => {
      const frame = await mountAt(cols, rows)
      expect(Math.max(...frame.split('\n').map(l => [...l].length)), frame).toBeLessThanOrEqual(cols)
      expect(frame).toContain('Cannot reach api.github.com')
      expect(frame).toContain('githubstatus.com')
      expect(frame).not.toMatch(/Reading works from the cache/)
      expect(frame.match(/Nothing is cached yet/g), frame).toHaveLength(1)
      expect(frame.match(/Cannot reach api\.github\.com/g)).toHaveLength(2) // full notice + compact repeat
      expect(frame).not.toContain('Check your network or githubstatus.com.\n') // no 2nd full notice
      expect(frame.split('\n').length).toBeLessThanOrEqual(rows)
    })
  }

  it('claims the cache only when something is cached', () => {
    expect(classifyGhFailure(offline(), { cached: true }).notes.join(' ')).toContain('last loaded')
    expect(classifyGhFailure(offline(), { cached: false }).notes.join(' ')).toContain('Nothing is cached yet')
    expect(classifyGhFailure(offline()).notes.join(' ')).not.toMatch(/cache/i)
  })
})
