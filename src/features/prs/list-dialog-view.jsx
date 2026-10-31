// @ts-check

/** Active PR list dialog rendering and confirmed actions; no list state is owned here. */
import React from 'react'
import { Box } from 'ink'
import { enableAutoMerge, disableAutoMerge, mergePR, closePR, checkoutBranch, reviewPR } from '../../executor.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { sanitize } from '../../utils.js'
import { NewPRDialog } from './NewPRDialog.jsx'
import { MERGE_OPTIONS, autoMergeOption, canToggleAutoMergeFromList } from './list-row.jsx'
import { LabelDialog, AssigneeDialog, AuthorSearchDialog, ReviewerDialog } from './list-dialogs.jsx'

const SELECTION_DIALOGS = { labels: LabelDialog, assignees: AssigneeDialog, reviewers: ReviewerDialog }

/** Return the active dialog, or null to keep the list visible. */
export function renderPRListDialog({
  dialog, selectedPR, items, repo, repoInfo, authorFilter, effectiveHeight,
  mergeOptions, setMergeOptions, setDialog, setCursor, setScrollOffset,
  setAuthorFilter, showStatus, closeDialog, refetch,
  runWrite = (_label, fn) => fn(),
}) {
  if (dialog === 'fuzzy') {
    const fuzzyItems = items.map(pr => ({ ...pr, authorLogin: pr.author?.login || '' }))
    return (
      <FuzzySearch
        items={fuzzyItems}
        searchFields={['title', 'number', 'authorLogin', 'headRefName']}
        onSubmit={(item) => {
          const idx = items.findIndex(p => p.number === item.number)
          if (idx !== -1) {
            setCursor(idx)
            setScrollOffset(Math.max(0, idx - Math.floor(effectiveHeight / 2)))
          }
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
        onSubmit={(author) => {
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
        promptText="Commit message (optional, Enter to skip)"
        onSubmit={(val) => {
          const strategy = typeof val === 'object' ? val.value : val
          const msg      = typeof val === 'object' ? val.text  : undefined
          if (strategy === 'auto-merge') { setDialog('auto-merge'); return }
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
        message={`Merge PR #${selectedPR.number} via --${mergeOptions.strategy}?${mergeOptions.msg ? `\nMessage: "${mergeOptions.msg}"` : ''}`}
        destructive={true}
        onConfirm={async () => {
          closeDialog()
          await runWrite(`Merging #${selectedPR.number}`, async () => {
            try {
              await mergePR(repo, selectedPR.number, mergeOptions.strategy, mergeOptions.msg)
              showStatus(`✓ Merged PR #${selectedPR.number}`)
              refetch()
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
            .then(() => { showStatus(disabling ? '✓ Auto-merge disabled' : '⟳ Auto-merge enabled'); refetch() })
            .catch(err => { showStatus(`✗ Auto-merge failed: ${sanitize(err.message)}`, true); refetch() }))
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
              refetch()
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
        onClose={() => { closeDialog(); refetch() }}
      />
    )
  }

  if ((dialog === 'approve-body' || dialog === 'reqchanges-body') && selectedPR) {
    const approving = dialog === 'approve-body'
    return (
      <FormCompose
        title={approving ? `Approve PR #${selectedPR.number}` : `Request changes on PR #${selectedPR.number}`}
        fields={[{ name: 'body', label: approving ? 'Optional comment (Ctrl+G to submit, leave empty to skip)' : 'Describe the changes needed', type: 'text' }]}
        onSubmit={async (values) => {
          closeDialog()
          await runWrite(approving ? `Approving #${selectedPR.number}` : `Requesting changes on #${selectedPR.number}`, async () => {
            try {
              await reviewPR(repo, selectedPR.number, approving ? 'approve' : 'request-changes', approving ? values.body || '' : values.body)
              showStatus(approving ? `✓ Approved PR #${selectedPR.number}` : `✓ Requested changes on PR #${selectedPR.number}`)
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
