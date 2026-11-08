/**
 * src/features/prs/diff.jsx — public PR diff view; composes state and rendering.
 */

import React, { useEffect, useRef } from 'react'
import { useDiffState } from './diff/state.js'
import { DiffView } from './diff/render.jsx'

/** Render the PR diff with its state and actions.
 * @param {object} props
 */
export function PRDiff(props) {
  const state = useDiffState(props)
  // Opened from the review story (#362): move to that file once the list has it, once.
  const pending = useRef(props.initialFile || null)
  useEffect(() => {
    if (!pending.current) return
    const i = state.files.findIndex(f => f.filename === pending.current)
    if (i < 0 || state.fileStartIndices[i] == null) return
    pending.current = null
    state.jumpTo(state.fileStartIndices[i])
  }, [state.files, state.fileStartIndices]) // eslint-disable-line react-hooks/exhaustive-deps
  return <DiffView prNumber={props.prNumber} state={state} />
}
