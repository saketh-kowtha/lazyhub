/**
 * Dialog chrome (#468): every dialog opened from a list pane or a detail view shows the
 * [DIALOG] badge and the dialog hints in the footer, with one box style and a title.
 * Renders the real App against canned `gh` output (same boundary as the screen matrix).
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useInput: (await import('./test/input-bus.js')).mockUseInput(React) }
})
vi.mock('execa', async () => ({ execa: vi.fn((await import('./test/gh-fixtures.js')).routeExeca) }))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))

import { App } from './app.jsx'
import { sendInput } from './test/input-bus.js'
import { cleanup, renderWithProviders, waitForExpectation } from './test/test-helpers.jsx'

const ENTER = { input: '', key: { return: true } }
const press = async (...keys) => {
  for (const k of keys) {
    await (typeof k === 'string' ? sendInput(k) : sendInput(k.input, k.key))
  }
}
const plain = view => (view.lastFrame() ?? '').replace(/\x1b\[[0-9;:]*m/g, '') // eslint-disable-line no-control-regex
const footerOf = frame => frame.trimEnd().split('\n').at(-1)

// Resolve once the frame has stopped changing (render + effects + mocked gh settled).
async function settle(view) {
  let prev = null
  await waitForExpectation(() => {
    const cur = view.lastFrame()
    const stable = cur === prev
    prev = cur
    if (!stable) throw new Error('frame still changing')
  }, { timeout: 3000, interval: 10 })
}

/** Mount the App, then run [keys, expected-text] steps, waiting for each step's text. */
async function open(steps) {
  const view = renderWithProviders(<App repo="owner/repo" />)
  await settle(view)
  for (const [keys, marker] of steps) {
    await press(...keys)
    await waitForExpectation(() => expect(plain(view)).toMatch(marker), { timeout: 3000 })
  }
  return view
}

afterEach(cleanup)

describe('list-view confirms carry the dialog chrome (#468)', () => {
  it('PR merge confirm shows [DIALOG] and the confirm hints, not the list hints', async () => {
    const view = await open([[['2'], /\d+ items/], [['m'], /Merge PR #101/], [[ENTER], /Commit message/], [[ENTER], /Merge PR #101 via/]])
    const frame = plain(view)
    expect(frame).toContain('[DIALOG]')
    expect(footerOf(frame)).toMatch(/confirm/)
    expect(footerOf(frame)).not.toMatch(/filter|new PR|refresh/)
  })

  it('issue close confirm shows [DIALOG] and the confirm hints, not the list hints', async () => {
    const view = await open([[['3'], /\d+ items/], [['X'], /Close issue #201/]])
    const frame = plain(view)
    expect(frame).toContain('[DIALOG]')
    expect(footerOf(frame)).toMatch(/confirm/)
    expect(footerOf(frame)).not.toMatch(/\bnew\b|filter|refresh/)
  })

  it('the issue label and assignee pickers have a title', async () => {
    const labels = await open([[['3'], /\d+ items/], [['l'], /Labels: issue #201/]])
    expect(plain(labels)).toContain('[DIALOG]')
    cleanup()
    const assignees = await open([[['3'], /\d+ items/], [['A'], /Assignees: issue #201/]])
    expect(plain(assignees)).toContain('[DIALOG]')
  })

  it('the PR label and assignee pickers have a title', async () => {
    const labels = await open([[['2'], /\d+ items/], [['l'], /Labels: PR #101/]])
    expect(plain(labels)).toContain('[DIALOG]')
    cleanup()
    const assignees = await open([[['2'], /\d+ items/], [['A'], /Assignees: PR #101/]])
    expect(plain(assignees)).toContain('[DIALOG]')
  })
})

describe('one hint bar in detail views (#468)', () => {
  const hintWords = /\[(?:j\/k|c|l|A|\/|\?|q \/ Esc|Esc)\] (?:scroll|reply|labels|assignees|search|help|back)/

  it('issue detail leaves key hints to the footer', async () => {
    const view = await open([[['3'], /\d+ items/], [[ENTER], /\[VIEW\]/]])
    const frame = plain(view)
    expect(frame).not.toMatch(hintWords)
    expect(footerOf(frame)).toMatch(/reply/)
  })

  it('PR detail leaves key hints to the footer', async () => {
    const view = await open([[['2'], /\d+ items/], [[ENTER], /\[VIEW\]/]])
    const frame = plain(view)
    expect(frame).not.toMatch(hintWords)
    expect(footerOf(frame)).toMatch(/merge/)
  })
})

describe('one box style (#468)', () => {
  it('the command palette uses the round border, not double', async () => {
    const view = await open([[[':'], /COMMAND/]])
    expect(plain(view)).not.toMatch(/[╔╗╚╝]/)
  })
})
