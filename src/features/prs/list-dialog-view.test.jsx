import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergePR, reviewPR } from '../../executor.js'
import { renderPRListDialog } from './list-dialog-view.jsx'

vi.mock('../../executor.js', async (original) => ({ ...await original(), mergePR: vi.fn(), reviewPR: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

const props = (dialog, extra = {}) => ({
  dialog, repo: 'o/r', selectedPR: { number: 7, title: 'PR' }, items: [], repoInfo: {},
  authorFilter: '', effectiveHeight: 5, mergeOptions: null,
  setMergeOptions: vi.fn(), setDialog: vi.fn(), setCursor: vi.fn(), setScrollOffset: vi.fn(),
  setAuthorFilter: vi.fn(), showStatus: vi.fn(), closeDialog: vi.fn(), refetch: vi.fn(),
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
    expect(state.refetch).toHaveBeenCalledOnce()
  })

  for (const [dialog, review, body] of [
    ['approve-body', 'approve', ''], ['reqchanges-body', 'request-changes', undefined],
  ]) {
    it(`preserves the ${review} request body semantics`, async () => {
      const state = props(dialog)
      const form = renderPRListDialog(state)
      expect(reviewPR).not.toHaveBeenCalled()
      await form.props.onSubmit({})
      expect(reviewPR).toHaveBeenCalledWith('o/r', 7, review, body)
      expect(state.closeDialog).toHaveBeenCalledOnce()
      expect(state.refetch).not.toHaveBeenCalled()
    })
  }

  it('keeps the list visible when a selected-PR dialog loses its selection', () => {
    expect(renderPRListDialog(props('merge', { selectedPR: undefined }))).toBeNull()
    expect(renderPRListDialog(props('merge-confirm'))).toBeNull()
    expect(renderPRListDialog(props(null))).toBeNull()
  })

  it('returns fuzzy selections to the same centered list position', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ number: i + 1, title: `PR ${i}`, author: { login: 'author' } }))
    const state = props('fuzzy', { items })
    const search = renderPRListDialog(state)
    expect(search.props.items[6].authorLogin).toBe('author')
    search.props.onSubmit(search.props.items[6])
    expect(state.setCursor).toHaveBeenCalledWith(6)
    expect(state.setScrollOffset).toHaveBeenCalledWith(4)
    expect(state.closeDialog).toHaveBeenCalledOnce()
  })
})
