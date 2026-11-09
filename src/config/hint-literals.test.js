/**
 * hint-literals.test.js -- hint strings typed by hand are how hints came to lie (#445, #449, #511).
 *
 * Hints must come from the registry (`hintLine`, `effectiveHintKey`, `actionHints`,
 * `contextFooterHints`). Files that still hold a hand-typed `[key] label` literal are
 * listed here with their count: the table can only shrink. A new literal (or a new file
 * with one) fails the test; removing one fails it too until the count is lowered, so the
 * ratchet cannot go slack. Migration of the remaining views belongs to #487 (R9).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HINT = /\[(?:Esc|Enter|Tab|Space|Shift\+Tab|Ctrl\+[A-Za-z]|[A-Za-z0-9?/@,.;:+-]|[A-Za-z]( ?\/ ?[A-Za-z]+)+)\] ?[a-z]/
const SKIP_DIRS = new Set(['test', 'config', 'render-checks', 'node_modules'])

const BASELINE = {
  'src/app-panels.jsx': 1,
  'src/components/AIAssistant.jsx': 3,
  'src/components/AIReviewPane.jsx': 5,
  'src/components/CommandPalette.jsx': 1,
  'src/components/CustomPane.jsx': 3,
  'src/components/ErrorBoundary.jsx': 1,
  'src/components/dialogs/ConfirmDialog.jsx': 2,
  'src/components/dialogs/FormCompose.jsx': 3,
  'src/components/dialogs/OptionPicker.jsx': 3,
  'src/features/branches/index.jsx': 1,
  'src/features/issues/detail-view.jsx': 2,
  'src/features/issues/dialogs.jsx': 1,
  'src/features/issues/list-view.jsx': 1,
  'src/features/logs/index.jsx': 2,
  'src/features/prs/ConflictView.jsx': 9,
  'src/features/prs/NewPRDialogView.jsx': 6,
  'src/features/prs/collisions/view.jsx': 1,
  'src/features/prs/comments.jsx': 2,
  'src/features/prs/detail.jsx': 3,
  'src/features/prs/diff/render.jsx': 7,
  'src/features/prs/list-dialogs.jsx': 2,
  'src/features/prs/list-view.jsx': 3,
  'src/features/settings/index.jsx': 7,
}

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sources(path, out)
    } else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(path)
  }
  return out
}

function literalCounts() {
  const counts = {}
  for (const file of sources('src')) {
    const lines = readFileSync(file, 'utf8').split('\n')
    const n = lines.filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line) && HINT.test(line)).length
    if (n) counts[file] = n
  }
  return counts
}

describe('hand-typed key hints (ratchet)', () => {
  it('no file gains a hint literal and none stays above its recorded count', () => {
    expect(literalCounts()).toEqual(BASELINE)
  })

  it('the preview popover and the registry-derived bars hold no literal', () => {
    const counts = literalCounts()
    for (const file of ['src/features/prs/list-row.jsx', 'src/components/Sidebar.jsx', 'src/ui/WhichKey.jsx', 'src/components/dialogs/MultiSelect.jsx', 'src/components/dialogs/FuzzySearch.jsx']) {
      expect(counts[file], file).toBeUndefined()
    }
  })
})
