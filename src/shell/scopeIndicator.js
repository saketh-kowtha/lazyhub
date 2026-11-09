/**
 * The status bar's scope chip: nothing for the resting scopes, the upper-cased name otherwise.
 * One definition for every view (it used to be pasted into eight StatusBar call sites).
 *
 * @param {string} activeScope scope name from the focus manager
 * @returns {string | null} chip text, or null when the scope is global, pane or list
 */
export function scopeIndicator(activeScope) {
  return ['global', 'pane', 'list'].includes(activeScope) ? null : String(activeScope).toUpperCase()
}
