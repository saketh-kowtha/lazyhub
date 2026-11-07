/**
 * ReviewDialog.jsx — approve / request-changes flow shared by PR detail, diff and list (#468).
 * Approve: comment form, then an "Approve PR #N?" confirm that defaults to No, so Enter never approves by itself.
 * Request changes: the reason is required; an empty body does not submit.
 * Props: number, mode ('approve' | 'request-changes'), onSubmit(body), onCancel()
 */

import React, { useState } from 'react'
import { FormCompose } from './FormCompose.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { sanitize } from '../../utils.js'

export function ReviewDialog({ number, mode, onSubmit, onCancel }) {
  const approving = mode === 'approve'
  const [pendingBody, setPendingBody] = useState(null)

  if (approving && pendingBody !== null) {
    return (
      <ConfirmDialog
        message={`Approve PR #${number}?${pendingBody ? `\nComment: "${sanitize(pendingBody)}"` : ''}`}
        onConfirm={() => onSubmit(pendingBody)}
        onCancel={onCancel}
      />
    )
  }

  return (
    <FormCompose
      title={approving ? `Approve PR #${number}` : `Request changes on PR #${number}`}
      fields={[{
        name: 'body',
        label: approving ? 'Comment (optional)' : 'Describe the changes needed (required)',
        type: 'text',
      }]}
      validate={approving ? undefined : (v) => ((v.body || '').trim() ? null : 'a reason is required')}
      onSubmit={(values) => (approving ? setPendingBody(values.body || '') : onSubmit(values.body.trim()))}
      onCancel={onCancel}
    />
  )
}
