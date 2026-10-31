import React from 'react'
import { Text } from 'ink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { useGh } from '../../hooks/useGh.js'
import { editPRMembers } from '../../executor.js'
import { LabelDialog, AssigneeDialog, ReviewerDialog, AuthorSearchDialog } from './list-dialogs.jsx'

vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({
  ...await original(),
  editPRMembers: vi.fn(),
}))

class CatchRenderError extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <Text>{this.state.error.message}</Text> : this.props.children }
}

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

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

  for (const [name, Dialog, field, key, kind] of [
    ['labels', LabelDialog, 'labels', 'name', 'label'],
    ['assignees', AssigneeDialog, 'assignees', 'login', 'assignee'],
    ['reviewers', ReviewerDialog, 'reviewRequests', 'login', 'reviewer'],
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
      expect(editPRMembers).toHaveBeenCalledOnce()
      expect(editPRMembers).toHaveBeenCalledWith('o/r', 9, kind, { add: ['new&amp;name'], remove: ['old'] })
    })
  }

  it('reports a failed label update through onError instead of swallowing it', async () => {
    const data = [{ name: 'a' }, { name: 'b' }]
    useGh.mockReturnValue({ loading: false, data })
    editPRMembers.mockRejectedValue(new Error('403 forbidden'))
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

  async function selectFirstAndSubmit(view, onClose) {
    await waitForInputReady(view)
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('▶ ◉ alice'))
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
  }

  it('adding a reviewer does not remove a pending team review request that is not in the collaborator list', async () => {
    useGh.mockReturnValue({ loading: false, data: [{ login: 'alice' }, { login: 'bob' }] })
    const onClose = vi.fn()
    const pr = { number: 7, reviewRequests: [{ login: 'acme/core', name: 'Core Team' }] }
    const view = renderWithProviders(<ReviewerDialog repo="o/r" pr={pr} onClose={onClose} />)
    expect(view.lastFrame()).toContain('Core Team')
    await selectFirstAndSubmit(view, onClose)
    expect(editPRMembers).toHaveBeenCalledWith('o/r', 7, 'reviewer', { add: ['alice'], remove: [] })
  })

  it('removes an off-list team request only when the user deselects it', async () => {
    useGh.mockReturnValue({ loading: false, data: [{ login: 'alice' }] })
    const onClose = vi.fn()
    const pr = { number: 7, reviewRequests: [{ login: 'acme/core', name: 'Core Team' }] }
    const view = renderWithProviders(<ReviewerDialog repo="o/r" pr={pr} onClose={onClose} />)
    await waitForInputReady(view)
    view.stdin.write('\u001b[B')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2/2'))
    await waitForInputReady(view)
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('▶ ○ Core Team'))
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
    expect(editPRMembers).toHaveBeenCalledWith('o/r', 7, 'reviewer', { add: [], remove: ['acme/core'] })
  })

  it('adding an assignee does not unassign someone missing from the first collaborators page', async () => {
    useGh.mockReturnValue({ loading: false, data: [{ login: 'alice' }, { login: 'bob' }] })
    const onClose = vi.fn()
    const view = renderWithProviders(<AssigneeDialog repo="o/r" pr={{ number: 8, assignees: [{ login: 'carol' }] }} onClose={onClose} />)
    await selectFirstAndSubmit(view, onClose)
    expect(editPRMembers).toHaveBeenCalledWith('o/r', 8, 'assignee', { add: ['alice'], remove: [] })
  })

  it('adding a label does not strip a label missing from the fetched label list', async () => {
    editPRMembers.mockResolvedValue(undefined)
    useGh.mockReturnValue({ loading: false, data: [{ name: 'alice' }] })
    const onClose = vi.fn()
    const view = renderWithProviders(<LabelDialog repo="o/r" pr={{ number: 8, labels: [{ name: 'old-label' }] }} onClose={onClose} />)
    await selectFirstAndSubmit(view, onClose)
    expect(editPRMembers).toHaveBeenCalledWith('o/r', 8, 'label', { add: ['alice'], remove: [] })
  })

  it('Esc closes the picker while the options are still loading', async () => {
    useGh.mockReturnValue({ loading: true })
    const onClose = vi.fn()
    const view = renderWithProviders(<AssigneeDialog repo="o/r" pr={{ number: 1 }} onClose={onClose} />)
    await waitForInputReady(view)
    view.stdin.write('\u001b')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('shows why the picker is empty when the gh call fails, and r retries', async () => {
    const refetch = vi.fn()
    useGh.mockReturnValue({ loading: false, data: undefined, error: new Error('HTTP 403: Must have push access'), refetch })
    const onClose = vi.fn()
    const view = renderWithProviders(<AssigneeDialog repo="o/r" pr={{ number: 1 }} onClose={onClose} />)
    expect(view.lastFrame()).toMatch(/cannot read|403|push access/i)
    expect(view.lastFrame()).not.toContain('No items')
    await waitForInputReady(view)
    view.stdin.write('r')
    await waitForExpectation(() => expect(refetch).toHaveBeenCalled())
    view.stdin.write('\u001b')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
  })
  it('removes a team that gh reports with a slug, by org/slug rather than its display name', async () => {
    useGh.mockReturnValue({ loading: false, data: [{ login: 'alice' }] })
    const onClose = vi.fn()
    const pr = { number: 7, reviewRequests: [{ __typename: 'Team', name: 'Core Team', slug: 'acme/core' }] }
    const view = renderWithProviders(<ReviewerDialog repo="o/r" pr={pr} onClose={onClose} />)
    expect(view.lastFrame()).toContain('Core Team')
    await waitForInputReady(view)
    view.stdin.write('\u001b[B')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2/2'))
    await waitForInputReady(view)
    view.stdin.write(' ')
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
    expect(editPRMembers).toHaveBeenCalledWith('o/r', 7, 'reviewer', { add: [], remove: ['acme/core'] })
  })

  it('keeps the values from when the dialog opened as the diff base when the PR refetches underneath', async () => {
    useGh.mockReturnValue({ loading: false, data: [{ name: 'alice' }, { name: 'old' }] })
    const onClose = vi.fn()
    function Host() {
      const [pr, setPr] = React.useState({ number: 3, labels: [{ name: 'old' }] })
      React.useEffect(() => { const id = setTimeout(() => setPr({ number: 3, labels: [] }), 30); return () => clearTimeout(id) }, [])
      return <LabelDialog repo="o/r" pr={pr} onClose={onClose} />
    }
    const view = renderWithProviders(<Host />)
    await new Promise(r => setTimeout(r, 100))
    await waitForInputReady(view)
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('▶ ◉ alice'))
    await waitForInputReady(view)
    view.stdin.write('\u001b[B')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2/2'))
    await waitForInputReady(view)
    view.stdin.write(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('▶ ○ old'))
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalledOnce())
    expect(editPRMembers).toHaveBeenCalledWith('o/r', 3, 'label', { add: ['alice'], remove: ['old'] })
  })
})
