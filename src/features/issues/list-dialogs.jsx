/**
 * Issue list dialogs and their mutation feedback.
 */

import React from 'react'
import { Box } from 'ink'
import { sanitize } from '../../utils.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { IssueLabelDialog, IssueAssigneeDialog } from './dialogs.jsx'

export function IssueListDialogs({ dialog, repo, items, selectedIssue, onJump, onClose, showStatus, closeIssue, createIssue, onChanged }) {
  // The list owns the writes (useMutation); a dialog only confirms and hands over (D16: one row is patched).
  if (dialog === 'fuzzy') {
    const fuzzyItems = items.map(issue => ({ ...issue, authorLogin: issue.author?.login || '' }))
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={fuzzyItems}
          searchFields={['title', 'number', 'authorLogin']}
          onSubmit={(item) => {
            const idx = items.findIndex(i => i.number === item.number)
            if (idx !== -1) onJump(idx)
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
          onConfirm={() => {
            onClose()
            closeIssue(selectedIssue.number)
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
          validate={(values) => ((values.title || '').trim() ? null : 'a title is required')}
          onSubmit={(values) => {
            onClose()
            createIssue(values)
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
        onClose={() => { onClose(); onChanged(selectedIssue.number) }}
      />
    )
  }

  if (dialog === 'assignees' && selectedIssue) {
    return (
      <IssueAssigneeDialog
        repo={repo} issue={selectedIssue}
        onError={(err) => showStatus(`✗ Updating assignees failed: ${sanitize(err.message)}`, true)}
        onClose={() => { onClose(); onChanged(selectedIssue.number) }}
      />
    )
  }

  return null
}
