import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderWithProviders, waitForExpectation, waitForInputReady } from '../../test/test-helpers.jsx'
import { OptionPicker } from './OptionPicker.jsx'
import { autoMergeOption, canToggleAutoMergeFromList } from '../../features/prs/list-row.jsx'

afterEach(cleanup)

const options = [{ value: 'merge', label: '--merge' }, autoMergeOption({ autoMergeRequest: { enabledAt: 'x' } })]

describe('OptionPicker skipPrompt (#448)', () => {
  it('submits a skipPrompt option at once, without the commit-message step', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<OptionPicker options={options} promptText="Commit message" onSubmit={onSubmit} onCancel={() => {}} />)
    await waitForInputReady(view)
    view.stdin.write('j')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/▶.*Disable auto-merge|Disable auto-merge/))
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onSubmit).toHaveBeenCalledWith('auto-merge'))
    expect(view.lastFrame()).not.toContain('Commit message')
  })

  it('still asks for the commit message for a normal option', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<OptionPicker options={options} promptText="Commit message" onSubmit={onSubmit} onCancel={() => {}} />)
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Commit message'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('auto-merge picker option', () => {
  it('offers Disable when auto-merge is on and Enable when it is off', () => {
    expect(autoMergeOption({ autoMergeRequest: { enabledAt: 'x' } }).label).toBe('Disable auto-merge')
    expect(autoMergeOption({ autoMergeRequest: null }).label).toBe('Enable auto-merge')
  })

  it('is offered only for open, non-draft PRs', () => {
    expect(canToggleAutoMergeFromList({ state: 'OPEN', isDraft: false })).toBe(true)
    expect(canToggleAutoMergeFromList({ state: 'OPEN', isDraft: true })).toBe(false)
    expect(canToggleAutoMergeFromList({ state: 'MERGED' })).toBe(false)
  })
})

describe('OptionPicker promptKey and initialIndex (#468)', () => {
  const methods = [{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }]

  it('the prompt key opens the message step, titled, without submitting', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<OptionPicker title="Merge PR #1" options={methods} promptText="Commit message" promptKey="e" initialIndex={1} onSubmit={onSubmit} onCancel={() => {}} />)
    await waitForInputReady(view)
    expect(view.lastFrame()).toContain('[Enter] Second')
    view.stdin.write('e')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Commit message'))
    expect(view.lastFrame()).toContain('Merge PR #1')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Enter submits the initial option at once', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<OptionPicker options={methods} promptText="Commit message" promptKey="e" initialIndex={1} onSubmit={onSubmit} onCancel={() => {}} />)
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onSubmit).toHaveBeenCalledWith('b'))
  })
})
