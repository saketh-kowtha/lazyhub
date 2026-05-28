/** tokens.js — Token taxonomy schema for the design system. */
/**
 * tokens.js — Token taxonomy schema for lazyhub's design system.
 *
 * This file defines the SHAPE of the token tree (keys + documentation).
 * It does NOT define values — values live in scheme files.
 *
 * Every scheme must provide a value for every token listed here.
 * The test suite enforces full coverage.
 *
 * Token naming follows the §3.1 spec in DESIGN_REVAMP.md.
 * Adding new tokens requires escalation to Opus (per §12 locked decisions).
 *
 * Diff tokens use an object shape { fg, bg } because they control two
 * independent channels (foreground text color + background row color).
 * All other tokens are plain hex strings.
 */

/**
 * The canonical token taxonomy.
 * Leaf values are human-readable descriptions of what each token controls.
 * Schemes replace these strings with actual hex/color values.
 */
export const TOKEN_SCHEMA = {
  bg: {
    /** Window / root background — the canvas the app sits on. */
    default: 'window background',
    /** Panel / card background — sits one layer above the window. */
    surface: 'panel/card background',
    /** Popover / modal background — topmost z-layer overlay. */
    overlay: 'popover/modal background',
  },

  fg: {
    /** Primary text — high-contrast body copy and titles. */
    default: 'primary text',
    /** Secondary text — timestamps, repo paths, metadata. */
    muted: 'secondary/muted text',
    /** Tertiary text — separators, placeholders, hints. */
    subtle: 'tertiary/subtle text',
    /** Text rendered on an accent-colored background (e.g. selected row badge). */
    inverse: 'text on accent backgrounds',
  },

  accent: {
    /** Focused row highlight, active tab, primary CTA. */
    primary: 'focused row / active tab / primary CTA',
    /** Interactive secondary highlight — links, refs, inline code. */
    secondary: 'links / refs / secondary highlight',
  },

  status: {
    /** CI pass, approval given, merge success. */
    success: 'ci pass / approval',
    /** CI pending, review requested, action needed. */
    warning: 'ci pending / review requested',
    /** CI fail, conflict, destructive action. */
    error: 'ci fail / conflict / error',
    /** Neutral informational notice. */
    info: 'neutral info notice',
  },

  diff: {
    /**
     * Added line — object with fg (text color) and bg (row background).
     * Shape: { fg: string, bg: string }
     */
    add: 'added line { fg, bg }',
    /**
     * Deleted line — object with fg and bg.
     * Shape: { fg: string, bg: string }
     */
    del: 'deleted line { fg, bg }',
    /** Context (unchanged) line foreground. */
    context: 'unchanged context line fg',
    /** Hunk header (@@ line) foreground. */
    hunk: 'hunk header (@@ line) fg',
    /**
     * Within-line addition emphasis (word-diff highlight).
     * Shape: { fg: string, bg: string }
     */
    add_emph: 'within-line add highlight { fg, bg }',
    /**
     * Within-line deletion emphasis (word-diff highlight).
     * Shape: { fg: string, bg: string }
     */
    del_emph: 'within-line del highlight { fg, bg }',
  },

  pr: {
    /** Open PR state indicator (green dot). */
    open: 'open PR indicator',
    /** Draft PR state indicator (gray dot). */
    draft: 'draft PR indicator',
    /** Merged PR state indicator (purple dot). */
    merged: 'merged PR indicator',
    /** Closed PR state indicator (red dot). */
    closed: 'closed PR indicator',
  },

  ci: {
    /** CI check passed (green check). */
    pass: 'ci check passed',
    /** CI check failed (red x). */
    fail: 'ci check failed',
    /** CI check in progress (yellow dot). */
    pending: 'ci check pending',
    /** CI check skipped (gray slash). */
    skipped: 'ci check skipped',
  },

  border: {
    /** Default panel border — low contrast, structural. */
    default: 'default panel border',
    /** Focused panel border — uses accent.primary intensity. */
    focused: 'focused panel border',
    /** Dense row divider — subtle separator between rows. */
    subtle: 'dense row divider',
  },
}

/**
 * Returns a flat list of all token paths (dot-notation).
 * Used by tests to assert 100% coverage across all schemes.
 *
 * Example output: ['bg.default', 'bg.surface', 'fg.default', 'diff.add', ...]
 * @returns {string[]}
 */
export function allTokenPaths() {
  const paths = []

  function walk(node, prefix) {
    for (const key of Object.keys(node)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof node[key] === 'object' && node[key] !== null && !Array.isArray(node[key])) {
        walk(node[key], path)
      } else {
        paths.push(path)
      }
    }
  }

  walk(TOKEN_SCHEMA, '')
  return paths
}

/**
 * Resolves a dot-notation token path against a scheme object.
 * Returns the value or undefined if the path does not exist.
 * @param {object} scheme
 * @param {string} path — e.g. 'diff.add' or 'bg.default'
 * @returns {string | object | undefined}
 */
export function resolveToken(scheme, path) {
  const parts = path.split('.')
  let cur = scheme
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}
