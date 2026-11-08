// @ts-check

/** Active PR list dialog rendering and confirmed actions; no list state is owned here. */
import React from 'react'
import { Box } from 'ink'
import { enableAutoMerge, disableAutoMerge, mergePR, closePR, checkoutBranch, reviewPR, addPRComment } from '../../executor.js'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { ReviewDialog } from '../../components/dialogs/ReviewDialog.jsx'
import { sanitize } from '../../utils.js'
import { NewPRDialog } from './NewPRDialog.jsx'
import { MERGE_OPTIONS, autoMergeOption, canToggleAutoMergeFromList, mergeMethodLabel } from './list-row.jsx'
import { rememberAuthor } from './author-candidates.js'
import { rememberedMergeIndex, rememberMergeMethod } from './merge-methods.js'
import { LabelDialog, AssigneeDialog, AuthorSearchDialog, ReviewerDialog, SearchQueryDialog } from './list-dialogs.jsx'

const SELECTION_DIALOGS = { labels: LabelDialog, assignees: AssigneeDialog, reviewers: ReviewerDialog }

/** Return the active dialog, or null to keep the list visible. */
export function renderPRListDialog({
  dialog, selectedPR, items, repo, repoInfo, authorFilter, effectiveHeight,
  mergeOptions, setMergeOptions, setDialog, setCursor, setScrollOffset,
  setAuthorFilter, searchText = '', setSearchText = (/** @type {string} */ _query) => {}, showStatus, closeDialog, refetch, refreshPR = refetch,
  runWrite = (_label, fn) => fn(),
}) {
  if (dialog === 'search') {
    return (
      <SearchQueryDialog
        current={searchText}
        onSubmit={(query) => {
          setSearchText(query)
          setCursor(0); setScrollOffset(0)
          showStatus(query ? `search: ${query}` : 'search cleared')
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'author-search') {
    return (
      <AuthorSearchDialog
        current={authorFilter}
        repo={repo}
        rows={items}
        onSubmit={(author) => {
          rememberAuthor(repo, author)
          setAuthorFilter(author)
          setCursor(0); setScrollOffset(0)
          showStatus(author ? `author: @${author}` : 'author: all')
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'merge' && selectedPR) {
    return (
      <OptionPicker
        title={`Merge PR #${selectedPR.number}: ${sanitize(selectedPR.title)}`}
        options={canToggleAutoMergeFromList(selectedPR) ? [...MERGE_OPTIONS, autoMergeOption(selectedPR)] : MERGE_OPTIONS}
        initialIndex={Math.max(0, rememberedMergeIndex(MERGE_OPTIONS, repo))}
        promptText="Commit message (optional, Enter to skip)"
        onSubmit={(val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg      = typeof val === 'object' ? val.text  : undefined
          if (strategy === 'auto-merge') { setDialog('auto-merge'); return }
          rememberMergeMethod(repo, strategy)
          setMergeOptions({ strategy, msg })
          setDialog('merge-confirm')
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'merge-confirm' && selectedPR && mergeOptions) {
    return (
      <ConfirmDialog
        message={`Merge PR #${selectedPR.number} via ${mergeMethodLabel(mergeOptions.strategy)}?${mergeOptions.msg ? `\nMessage: "${mergeOptions.msg}"` : ''}`}
        destructive={true}
        onConfirm={async () => {
          closeDialog()
          await runWrite(`Merging #${selectedPR.number}`, async () => {
            try {
              await mergePR(repo, selectedPR.number, mergeOptions.strategy, mergeOptions.msg)
              showStatus(`✓ Merged PR #${selectedPR.number}`)
              refreshPR(selectedPR.number)
            } catch (err) {
              showStatus(`✗ Merge failed: ${err.message}`, true)
            }
          })
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'checkout' && selectedPR) {
    return (
      <ConfirmDialog
        message={`Checkout branch "${sanitize(selectedPR.headRefName)}" from PR #${selectedPR.number}?`}
        destructive={false}
        onConfirm={async () => {
          closeDialog()
          await runWrite(`Checking out #${selectedPR.number}`, async () => {
            try {
              await checkoutBranch(repo, selectedPR.number)
              showStatus(`✓ Checked out ${selectedPR.headRefName}`)
            } catch (err) {
              showStatus(`✗ Checkout: ${err.message}`, true)
            }
          })
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'auto-merge' && selectedPR) {
    const disabling = !!selectedPR.autoMergeRequest
    return (
      <ConfirmDialog
        message={`${disabling ? 'Disable' : 'Enable'} auto-merge on PR #${selectedPR.number}: ${sanitize(selectedPR.title)}?`}
        onConfirm={() => {
          closeDialog()
          const request = () => disabling
            ? disableAutoMerge(repo, selectedPR.number)
            : enableAutoMerge(repo, selectedPR.number, repoInfo?.squashMergeAllowed ? 'squash' : 'merge')
          return runWrite(`${disabling ? 'Disabling' : 'Enabling'} auto-merge on #${selectedPR.number}`, () => request()
            .then(() => { showStatus(disabling ? '✓ Auto-merge disabled' : '⟳ Auto-merge enabled'); refreshPR(selectedPR.number) })
            .catch(err => { showStatus(`✗ Auto-merge failed: ${sanitize(err.message)}`, true); refreshPR(selectedPR.number) }))
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'close-pr' && selectedPR) {
    return (
      <ConfirmDialog
        message={`Close PR #${selectedPR.number}: ${sanitize(selectedPR.title)}?`}
        destructive={true}
        onConfirm={async () => {
          closeDialog()
          await runWrite(`Closing #${selectedPR.number}`, async () => {
            try {
              await closePR(repo, selectedPR.number)
              showStatus(`Closed PR #${selectedPR.number}`)
              refreshPR(selectedPR.number)
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          })
        }}
        onCancel={closeDialog}
      />
    )
  }

  const SelectionDialog = SELECTION_DIALOGS[dialog]
  if (SelectionDialog && selectedPR) {
    return (
      <SelectionDialog
        repo={repo} pr={selectedPR} runWrite={runWrite}
        onError={(err) => showStatus(`✗ Updating ${dialog} failed: ${sanitize(err.message)}`, true)}
        onClose={() => { closeDialog(); refreshPR(selectedPR.number) }}
      />
    )
  }

  if ((dialog === 'approve-body' || dialog === 'reqchanges-body') && selectedPR) {
    const approving = dialog === 'approve-body'
    return (
      <ReviewDialog
        number={selectedPR.number}
        mode={approving ? 'approve' : 'request-changes'}
        onSubmit={async (body) => {
          closeDialog()
          await runWrite(approving ? `Approving #${selectedPR.number}` : `Requesting changes on #${selectedPR.number}`, async () => {
            try {
              await reviewPR(repo, selectedPR.number, approving ? 'approve' : 'request-changes', body)
              showStatus(approving ? `✓ Approved PR #${selectedPR.number}` : `✓ Requested changes on PR #${selectedPR.number}`)
              refreshPR(selectedPR.number) // the row's review state is stale otherwise (#439)
            } catch (err) {
              showStatus(`✗ ${err.message}`, true)
            }
          })
        }}
        onCancel={closeDialog}
      />
    )
  }

  // A plain comment from the row (#314): the typed text is the deliberate step, like request changes.
  if (dialog === 'comment-pr' && selectedPR) {
    return (
      <FormCompose
        title={`Comment on PR #${selectedPR.number}`}
        fields={[{ name: 'body', label: 'Comment (required)', type: 'text' }]}
        validate={(v) => ((v.body || '').trim() ? null : 'a comment is required')}
        onSubmit={async (values) => {
          closeDialog()
          await runWrite(`Commenting on #${selectedPR.number}`, async () => {
            try {
              await addPRComment(repo, selectedPR.number, values.body.trim())
              showStatus(`✓ Commented on PR #${selectedPR.number}`)
            } catch (err) {
              showStatus(`✗ ${err.message}`, true)
            }
          })
        }}
        onCancel={closeDialog}
      />
    )
  }

  if (dialog === 'new-pr') {
    return (
      <Box flexDirection="column" flexGrow={1} paddingY={1} paddingX={1}>
        <NewPRDialog
          repo={repo}
          onClose={closeDialog}
          onCreated={() => { showStatus('✓ PR created'); refetch() }}
        />
      </Box>
    )
  }

  return null
}
