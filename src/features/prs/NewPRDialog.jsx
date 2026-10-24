/**
 * Smart New PR dialog: combines form state with rendering and claims dialog focus.
 */
import React from 'react'
import { useKeyScope } from '../../keyscope.js'
import { useNewPRForm } from './useNewPRForm.js'
import { NewPRDialogView } from './NewPRDialogView.jsx'

export function NewPRDialog({ repo, onClose, onCreated }) {
  useKeyScope('dialog')
  const state = useNewPRForm({ repo, onClose, onCreated })
  return <NewPRDialogView repo={repo} state={state} />
}
