import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergePR, reviewPR, disableAutoMerge } from '../../executor.js'
import { renderPRListDialog } from './list-dialog-view.jsx'

vi.mock('../../executor.js', async (original) => ({ ...await original(), mergePR: vi.fn(), reviewPR: vi.fn(), disableAutoMerge: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

const props = (dialog, extra = {}) => ({
  dialog, repo: 'o/r', selectedPR: { number: 7, title: 'PR' }, items: [], repoInfo: {},
  authorFilter: '', effectiveHeight: 5, mergeOptions: null,
  setMergeOptions: vi.fn(), setDialog: vi.fn(), setCursor: vi.fn(), setScrollOffset: vi.fn(),
  setAuthorFilter: vi.fn(), showStatus: vi.fn(), closeDialog: vi.fn(), refetch: vi.fn(), refreshPR: vi.fn(),
  ...extra,
})

describe('PR list dialog contract', () => {
  it('preserves the selected merge strategy and message until explicit confirmation', async () => {
    const state = props('merge')
    renderPRListDialog(state).props.onSubmit({ value: 'squash', text: 'commit message' })
    expect(state.setMergeOptions).toHaveBeenCalledWith({ strategy: 'squash', msg: 'commit message' })
    expect(state.setDialog).toHaveBeenCalledWith('merge-confirm')
    expect(mergePR).not.toHaveBeenCalled()
    const confirm = renderPRListDialog({ ...state, dialog: 'merge-confirm', mergeOptions: state.setMergeOptions.mock.calls[0][0] })
    expect(confirm.props.destructive).toBe(true)
    expect(mergePR).not.toHaveBeenCalled()
    await confirm.props.onConfirm()
    expect(mergePR).toHaveBeenCalledWith('o/r', 7, 'squash', 'commit message')
    expect(state.refreshPR).toHaveBeenCalledWith(7)
    expect(state.refetch).not.toHaveBeenCalled()
  })

  for (const [dialog, review, body] of [
    ['approve-body', 'approve', ''], ['reqchanges-body', 'request-changes', 'needs work'],
  ]) {
    it(`preserves the ${review} request body semantics`, async () => {
      const state = props(dialog)
      const form = renderPRListDialog(state)
      expect(reviewPR).not.toHaveBeenCalled()
      await form.props.onSubmit(body)
      expect(reviewPR).toHaveBeenCalledWith('o/r', 7, review, body)
      expect(state.closeDialog).toHaveBeenCalledOnce()
      // The row's review state is patched in place (#439); the pages are not reset.
      expect(state.refreshPR).toHaveBeenCalledWith(7)
      expect(state.refetch).not.toHaveBeenCalled()
    })

    it(`does not patch the row when the ${review} request fails`, async () => {
      reviewPR.mockRejectedValueOnce(new Error('nope'))
      const state = props(dialog)
      await renderPRListDialog(state).props.onSubmit({ body: 'x' })
      expect(state.showStatus).toHaveBeenCalledWith('✗ nope', true)
      expect(state.refreshPR).not.toHaveBeenCalled()
    })
  }

  it('reports a failed auto-merge disable with a sanitized message and re-reads the row', async () => {
    disableAutoMerge.mockRejectedValue(new Error('still \u001b[31menabled'))
    const state = props('auto-merge', { selectedPR: { number: 7, title: 'PR', autoMergeRequest: { enabledAt: 'x' } } })
    renderPRListDialog(state).props.onConfirm()
    await vi.waitFor(() => expect(state.showStatus).toHaveBeenCalled())
    const [msg, isError] = state.showStatus.mock.calls[0]
    expect(isError).toBe(true)
    expect(msg).toContain('Auto-merge failed')
    expect(msg).not.toContain('\u001b')
    expect(state.refreshPR).toHaveBeenCalledWith(7)
  })

  it('keeps the list visible when a selected-PR dialog loses its selection', () => {
    expect(renderPRListDialog(props('merge', { selectedPR: undefined }))).toBeNull()
    expect(renderPRListDialog(props('merge-confirm'))).toBeNull()
    expect(renderPRListDialog(props(null))).toBeNull()
  })

  it('applies a search to the server query, resets the cursor and closes the dialog (#508)', () => {
    const state = props('search', { searchText: 'old' })
    state.setSearchText = vi.fn()
    const dialog = renderPRListDialog(state)
    expect(dialog.props.current).toBe('old')
    dialog.props.onSubmit('author:bob')
    expect(state.setSearchText).toHaveBeenCalledWith('author:bob')
    expect(state.setCursor).toHaveBeenCalledWith(0)
    expect(state.closeDialog).toHaveBeenCalledOnce()
  })
})
