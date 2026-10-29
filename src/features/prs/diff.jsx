/**
 * src/features/prs/diff.jsx — public PR diff view; composes state and rendering.
 */

import React from 'react'
import { useDiffState } from './diff/state.js'
import { DiffView } from './diff/render.jsx'

/** Render the PR diff with its state and actions.
 * @param {object} props
 */
export function PRDiff(props) {
  const state = useDiffState(props)
  return <DiffView prNumber={props.prNumber} state={state} />
}
