/**
 * Issue list dialogs and their mutation feedback.
 */

import React from 'react'
import { Box } from 'ink'
import { closeIssue, createIssue } from '../../executor.js'
import { sanitize } from '../../utils.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { IssueLabelDialog, IssueAssigneeDialog } from './dialogs.jsx'

export function IssueListDialogs({ dialog, repo, items, selectedIssue, setCursor, setScrollOffset, onClose, showStatus, refetch, refreshIssue = undefined }) {
  // Patch the one changed row when the list supports it; otherwise refetch (D16).
  const changed = (number, opts) => (refreshIssue ? refreshIssue(number, opts) : refetch())
  if (dialog === 'fuzzy') {
    const fuzzyItems = items.map(issue => ({ ...issue, authorLogin: issue.author?.login || '' }))
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={fuzzyItems}
          searchFields={['title', 'number', 'authorLogin']}
          onSubmit={(item) => {
            const idx = items.findIndex(i => i.number === item.number)
            if (idx !== -1) { setCursor(idx); setScrollOffset(Math.max(0, idx - 2)) }
            onClose()
          }}
          onCancel={onClose}
        />
      </Box>
    )
  }

  if (dialog === 'close' && selectedIssue) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message={`Close issue #${selectedIssue.number}: ${sanitize(selectedIssue.title)}?`}
          destructive={true}
          onConfirm={async () => {
            onClose()
            try {
              await closeIssue(repo, selectedIssue.number)
              showStatus(`Closed #${selectedIssue.number}`)
              changed(selectedIssue.number)
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={onClose}
        />
      </Box>
    )
  }

  if (dialog === 'new') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FormCompose
          title="New Issue"
          fields={[
            { name: 'title', label: 'Title', type: 'text' },
            { name: 'body', label: 'Body', type: 'multiline' },
          ]}
          onSubmit={async (values) => {
            onClose()
            try {
              const created = await createIssue(repo, /** @type {any} */ ({ title: values.title, body: values.body }))
              showStatus('Issue created')
              const number = Number(String(created || '').match(/\/issues\/(\d+)/)?.[1])
              if (number) changed(number, { added: true })
              else refetch()
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={onClose}
        />
      </Box>
    )
  }

  if (dialog === 'labels' && selectedIssue) {
    return (
      <IssueLabelDialog
        repo={repo} issue={selectedIssue}
        onError={(err) => showStatus(`✗ Updating labels failed: ${sanitize(err.message)}`, true)}
        onClose={() => { onClose(); changed(selectedIssue.number) }}
      />
    )
  }

  if (dialog === 'assignees' && selectedIssue) {
    return (
      <IssueAssigneeDialog
        repo={repo} issue={selectedIssue}
        onError={(err) => showStatus(`✗ Updating assignees failed: ${sanitize(err.message)}`, true)}
        onClose={() => { onClose(); changed(selectedIssue.number) }}
      />
    )
  }

  return null
}
