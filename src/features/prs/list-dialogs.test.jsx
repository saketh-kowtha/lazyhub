import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { useGh } from '../../hooks/useGh.js'
import { addLabels, removeLabels, addPRAssignees, removePRAssignees, requestReviewers, removeReviewers } from '../../executor.js'
import { LabelDialog, AssigneeDialog, ReviewerDialog, AuthorSearchDialog } from './list-dialogs.jsx'

vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({
  ...await original(),
  addLabels: vi.fn(), removeLabels: vi.fn(),
  addPRAssignees: vi.fn(), removePRAssignees: vi.fn(),
  requestReviewers: vi.fn(), removeReviewers: vi.fn(),
}))

class CatchRenderError extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <Text>{this.state.error.message}</Text> : this.props.children }
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('PR list dialogs', () => {
  for (const [name, Dialog, message] of [
    ['labels', LabelDialog, 'Loading labels…'],
    ['assignees', AssigneeDialog, 'Loading collaborators…'],
    ['reviewers', ReviewerDialog, 'Loading collaborators…'],
  ]) {
    it(`renders the ${name} loading state without crashing`, () => {
      useGh.mockReturnValue({ loading: true })
      const view = renderWithProviders(<CatchRenderError><Dialog repo="o/r" pr={{ number: 1 }} onClose={() => {}} /></CatchRenderError>)
      expect(view.lastFrame()).toContain(message)
    })
  }

  it('opens author search and submits the current author on Enter', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<CatchRenderError><AuthorSearchDialog current="octocat" onSubmit={onSubmit} onCancel={() => {}} /></CatchRenderError>)
    expect(view.lastFrame()).toContain('Filter by author')
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onSubmit).toHaveBeenCalledWith('octocat'))
  })

  for (const [name, Dialog, data, pr] of [
    ['labels', LabelDialog, [{ name: 'safe&amp;label' }], { number: 1 }],
    ['assignees', AssigneeDialog, [{ login: 'safe&amp;user' }], { number: 1 }],
    ['reviewers', ReviewerDialog, [{ login: 'safe&amp;reviewer' }], { number: 1 }],
  ]) {
    it(`sanitizes API names in the ${name} picker`, () => {
      useGh.mockReturnValue({ loading: false, data })
      const view = renderWithProviders(<CatchRenderError><Dialog repo="o/r" pr={pr} onClose={() => {}} /></CatchRenderError>)
      expect(view.lastFrame()).toContain(data[0].name?.replace('&amp;', '&') || data[0].login.replace('&amp;', '&'))
      expect(view.lastFrame()).not.toContain('&amp;')
    })
  }

  for (const [name, Dialog, field, key, add, remove, extra] of [
    ['labels', LabelDialog, 'labels', 'name', addLabels, removeLabels, ['pr']],
    ['assignees', AssigneeDialog, 'assignees', 'login', addPRAssignees, removePRAssignees, []],
    ['reviewers', ReviewerDialog, 'reviewRequests', 'login', requestReviewers, removeReviewers, []],
  ]) {
    it(`diffs ${name} and preserves raw IDs when applying additions and removals`, async () => {
      const data = ['keep', 'old', 'new&amp;name'].map(value => ({ [key]: value }))
      useGh.mockReturnValue({ loading: false, data })
      const onClose = vi.fn()
      const pr = { number: 9, [field]: data.slice(0, 2) }
      const view = renderWithProviders(<Dialog repo="o/r" pr={pr} onClose={onClose} />)
      await waitForInputReady(view)
      view.stdin.write('\u001b[B')
      await waitForExpectation(() => expect(view.lastFrame()).toContain('2/3'))
      await waitForInputReady(view)
      view.stdin.write(' ')
      await waitForExpectation(() => expect(view.lastFrame()).toContain('▶ ○ old'))
      await waitForInputReady(view)
      view.stdin.write('\u001b[B')
      await waitForExpectation(() => expect(view.lastFrame()).toContain('3/3'))
      await waitForInputReady(view)
      view.stdin.write(' ')
      await waitForExpectation(() => expect(view.lastFrame()).toContain('▶ ◉ new&name'))
      await waitForInputReady(view)
      view.stdin.write('\r')
      await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
      expect(add).toHaveBeenCalledWith('o/r', 9, ['new&amp;name'], ...extra)
      expect(remove).toHaveBeenCalledWith('o/r', 9, ['old'], ...extra)
      expect(add.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0])
    })
  }

  it('reports a failed label update through onError instead of swallowing it', async () => {
    const data = [{ name: 'a' }, { name: 'b' }]
    useGh.mockReturnValue({ loading: false, data })
    addLabels.mockRejectedValue(new Error('403 forbidden'))
    const onClose = vi.fn()
    const onError = vi.fn()
    const view = renderWithProviders(<LabelDialog repo="o/r" pr={{ number: 3, labels: [{ name: 'a' }] }} onClose={onClose} onError={onError} />)
    await waitForInputReady(view)
    view.stdin.write('\u001b[B')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2/2'))
    await waitForInputReady(view)
    view.stdin.write(' ')
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: '403 forbidden' }))
  })
})
