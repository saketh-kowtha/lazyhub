// @ts-nocheck
/**
 * src/features/prs/diff/editor.js — synchronous comment editor round-trip.
 */

import { editTextInEditor } from '../../../services/platform.js'

/** Edit a comment in a temporary file, retaining its text on editor failure.
 * @param {string} initial
 * @returns {string} edited or original comment
 */
export function openEditorSync(initial) {
  return editTextInEditor(initial, { filename: 'comment.md' }).text
}
