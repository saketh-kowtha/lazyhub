/**
 * src/focus/scopes.js -- the scope ladder shared by the router and keyscope.js (#485).
 *
 * Scope priority: global(0) < pane(1) < view(2) < overlay(3) < dialog(4) < input(5).
 * Legacy aliases: list = pane, detail = view.
 */

export const SCOPE_LEVEL = {
  global:  0,
  pane:    1,
  list:    1,   // alias
  view:    2,
  detail:  2,   // alias
  overlay: 3,
  dialog:  4,
  input:   5,
}

/**
 * True when `scope` is an overlay, dialog or text input: something that owns every key.
 * An unknown scope name counts as modal (fail closed).
 * @param {string} scope scope name
 * @returns {boolean} whether the scope blocks pane and global handlers
 */
export function isModalScope(scope) {
  return (/** @type {Record<string, number>} */ (SCOPE_LEVEL)[scope] ?? SCOPE_LEVEL.input) >= SCOPE_LEVEL.overlay
}
