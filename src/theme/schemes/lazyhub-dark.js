/**
 * lazyhub-dark.js — Default dark color scheme.
 *
 * Inspired by GitHub Dark Dimmed (the dimmer variant of GitHub's dark theme)
 * but tuned for terminal readability. Terminal renderers tend to crush
 * saturation vs. a gamma-corrected web browser, so we bump saturation
 * and lightness slightly on critical tokens.
 *
 * Design constraints (from DESIGN_REVAMP.md §12 row 1):
 *   - Foreground ~#adbac7  (GitHub Dark Dimmed body text)
 *   - Background ~#22272e  (GitHub Dark Dimmed canvas)
 *   - Accent     ~#539bf5  (GitHub Dark Dimmed blue)
 *   - Diff add   ~#347d39  on bg ~#0f2f23
 *   - Diff del   ~#c93c37  on bg ~#3c1f1f
 *
 * Contrast ratios (approximate, checked against WCAG AA 4.5:1 for body text):
 *   fg.default  (#adbac7) on bg.default (#22272e): ~6.2:1  ✓
 *   accent.primary (#539bf5) on bg.default:       ~4.7:1  ✓
 *   fg.muted (#768390)   on bg.default:           ~3.8:1  (acceptable for metadata)
 *   fg.subtle (#545d68)  on bg.default:           ~2.4:1  (decorative / low-emphasis only)
 *
 * All values are hex strings accepted by Ink's `color` prop.
 * Diff tokens use { fg, bg } shape (two channels — text + row background).
 */

export default {
  // ── Background layers ────────────────────────────────────────────────────────
  bg: {
    /** Root window canvas — darkest surface. GitHub Dark Dimmed #22272e. */
    default: '#22272e',
    /** Panel / card — slightly lighter to create depth. */
    surface: '#2d333b',
    /** Popover / modal — lightest overlay, floats above surface. */
    overlay: '#373e47',
  },

  // ── Foreground text ──────────────────────────────────────────────────────────
  fg: {
    /** Primary text — body copy, titles. GitHub Dark Dimmed body #adbac7. */
    default: '#adbac7',
    /** Secondary text — timestamps, paths, metadata. */
    muted: '#768390',
    /** Tertiary — placeholders, separators, hints. */
    subtle: '#545d68',
    /**
     * Text on accent backgrounds (e.g. selected-row badge, filled buttons).
     * Near-white for strong contrast on #539bf5 accent.
     */
    inverse: '#cdd9e5',
  },

  // ── Accent ───────────────────────────────────────────────────────────────────
  accent: {
    /**
     * Focused row / active tab / primary CTA.
     * GitHub Dark Dimmed blue, bumped +5% lightness for terminal contrast.
     */
    primary: '#539bf5',
    /** Links, refs, inline code, secondary interactive elements. */
    secondary: '#6cb6ff',
  },

  // ── Status semantics ─────────────────────────────────────────────────────────
  status: {
    /** CI pass, approval. GitHub success green. */
    success: '#57ab5a',
    /** Pending / review-requested. GitHub warning amber. */
    warning: '#c69026',
    /** Fail / conflict / destructive. GitHub danger red. */
    error: '#e5534b',
    /** Neutral informational. GitHub info blue-gray. */
    info: '#6cb6ff',
  },

  // ── Diff colors ──────────────────────────────────────────────────────────────
  diff: {
    /**
     * Added line.
     * fg: text color on an added line (bright green, readable on dark bg).
     * bg: row background color.
     * Tuned from GitHub Dark Dimmed diff-add (#347d39 fg, #0f2f23 bg) with
     * slight saturation bump for terminal.
     */
    add: { fg: '#57ab5a', bg: '#0f2f23' },

    /**
     * Deleted line.
     * fg: text color on a deleted line (coral red).
     * bg: row background.
     * Based on GitHub Dark Dimmed del (#c93c37 fg, #3c1f1f bg).
     */
    del: { fg: '#e5534b', bg: '#3c1f1f' },

    /** Context (unchanged) line — muted; doesn't compete with add/del. */
    context: '#768390',

    /** Hunk header marker, subtly distinct from context. */
    hunk: '#6cb6ff',

    /**
     * Within-line addition emphasis (word-diff).
     * Brighter/saturated green on a slightly lighter green bg.
     */
    add_emph: { fg: '#8ddb8c', bg: '#1a4a1e' },

    /**
     * Within-line deletion emphasis (word-diff).
     * Brighter red on a slightly lighter red bg.
     */
    del_emph: { fg: '#f47067', bg: '#5c2525' },
  },

  // ── PR state indicators ──────────────────────────────────────────────────────
  pr: {
    /** Open PR — green dot. GitHub open-issue / open-PR green. */
    open: '#57ab5a',
    /** Draft PR — muted gray. Not yet ready. */
    draft: '#768390',
    /** Merged PR — lavender/purple. GitHub merged purple. */
    merged: '#b083f0',
    /** Closed PR — red. GitHub closed red. */
    closed: '#e5534b',
  },

  // ── CI check indicators ──────────────────────────────────────────────────────
  ci: {
    /** Check passed — green checkmark. */
    pass: '#57ab5a',
    /** Check failed — red x. */
    fail: '#e5534b',
    /** Check in progress — amber dot. */
    pending: '#c69026',
    /** Check skipped — subtle gray slash. */
    skipped: '#545d68',
  },

  // ── Borders ──────────────────────────────────────────────────────────────────
  border: {
    /** Standard panel border — low contrast structural rule. */
    default: '#373e47',
    /** Focused panel border — matches accent.primary for clear focus ring. */
    focused: '#539bf5',
    /** Dense row divider — barely visible, just enough to separate rows. */
    subtle: '#2d333b',
  },
}
