/**
 * Palette write actions: confirmation is a property of the registry action and
 * is enforced for the palette path (ask first) and for any caller that skips
 * the question (run() fails closed).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from '../test/input-bus.js'
import { CommandPalette } from './CommandPalette.jsx'
import { buildActions } from '../ui/actions.js'
import * as executor from '../executor.js'
import { renderWithProviders, cleanup, waitForExpectation } from '../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useInput: (await import('../test/input-bus.js')).mockUseInput(React) }
})

vi.mock('../executor.js', () => ({
  mergePR: vi.fn(() => Promise.resolve()),
  reviewPR: vi.fn(() => Promise.resolve()),
  closePR: vi.fn(() => Promise.resolve()),
  checkoutBranch: vi.fn(() => Promise.resolve()),
}))

const context = { pane: 'prs', view: 'list', repo: 'o/r', selectedItem: { number: 7, title: 'Fix retry' } }

// label, executor fn, confirm message fragment
const WRITES = [
  ['Merge PR', 'mergePR', 'Merge PR #7'],
  ['Merge PR (squash)', 'mergePR', 'Squash-merge PR #7'],
  ['Merge PR (rebase)', 'mergePR', 'Rebase-merge PR #7'],
  ['Approve PR', 'reviewPR', 'Approve PR #7'],
  ['Request Changes on PR', 'reviewPR', 'Request changes on PR #7'],
  ['Checkout PR Branch', 'checkoutBranch', 'Check out the branch of PR #7'],
  ['Close PR', 'closePR', 'Close PR #7'],
]

async function type(text) { for (const ch of text) await sendInput(ch, {}) }

async function openAndSelect(label) {
  const onClose = vi.fn()
  const ui = renderWithProviders(
    <CommandPalette context={context} onClose={onClose} onNavigate={() => {}} onTheme={() => {}} themes={[]} />,
  )
  await type(label.toLowerCase())
  const row = new RegExp(`▶ ${label.replace(/[()]/g, '\\$&')}\\s{2,}`)
  for (let i = 0; i < 9 && !row.test(ui.lastFrame()); i++) await sendInput('', { downArrow: true })
  expect(ui.lastFrame()).toMatch(row)
  await sendInput('', { return: true })
  return { ui, onClose }
}

describe('palette write actions need confirmation', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { cleanup() })

  for (const [label, fn, message] of WRITES) {
    it(`${label}: asks first, n cancels without writing`, async () => {
      const { ui, onClose } = await openAndSelect(label)
      await waitForExpectation(() => expect(ui.lastFrame()).toContain(message))
      expect(ui.lastFrame()).toContain('Fix retry')
      expect(executor[fn]).not.toHaveBeenCalled()
      await sendInput('n', {})
      expect(executor[fn]).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it(`${label}: Esc cancels, y runs exactly once`, async () => {
      await openAndSelect(label)
      await sendInput('', { escape: true })
      expect(executor[fn]).not.toHaveBeenCalled()
      cleanup()
      await openAndSelect(label)
      await sendInput('y', {})
      await waitForExpectation(() => expect(executor[fn]).toHaveBeenCalledTimes(1))
    })
  }

  it('run() fails closed when a caller skips the confirmation', () => {
    const actions = buildActions({ onNavigate() {}, onTheme() {}, onClose() {}, onQuit() {}, themes: [] })
    const writes = actions.filter(a => a.write)
    expect(writes.map(a => a.label).sort()).toEqual(WRITES.map(w => w[0]).sort())
    for (const a of writes) expect(() => a.run({ ...context })).toThrow(/needs confirmation/)
    for (const [, fn] of WRITES) expect(executor[fn]).not.toHaveBeenCalled()
  })
})
