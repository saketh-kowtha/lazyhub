import { describe, expect, it, vi } from 'vitest'

vi.mock('../../executor.js', () => ({
  enableAutoMerge: vi.fn(), disableAutoMerge: vi.fn(), mergePR: vi.fn(), closePR: vi.fn(),
  checkoutBranch: vi.fn(), reviewPR: vi.fn().mockResolvedValue(null),
  listLabels: vi.fn(), listCollaborators: vi.fn(), addLabels: vi.fn(), removeLabels: vi.fn(),
  addPRAssignees: vi.fn(), removePRAssignees: vi.fn(), requestReviewers: vi.fn(), removeReviewers: vi.fn(),
}))

const { renderPRListDialog } = await import('./list-dialog-view.jsx')

describe('PR list review actions (audit)', () => {
  it.each(['approve-body', 'reqchanges-body'])('%s refreshes the list after a successful review', async (dialog) => {
    const refetch = vi.fn()
    const showStatus = vi.fn()
    const el = renderPRListDialog({
      dialog, selectedPR: { number: 7, title: 't' }, items: [], repo: 'a/b', repoInfo: null,
      authorFilter: '', effectiveHeight: 10, mergeOptions: null, setMergeOptions() {}, setDialog() {},
      setCursor() {}, setScrollOffset() {}, setAuthorFilter() {}, showStatus, closeDialog() {}, refetch,
    })
    await el.props.onSubmit({ body: 'looks good' })
    expect(showStatus).toHaveBeenCalled()
    expect(refetch).toHaveBeenCalled() // reviewDecision shown in the row is stale otherwise
  })
})
