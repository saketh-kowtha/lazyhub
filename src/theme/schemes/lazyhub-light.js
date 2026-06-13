/**
 * lazyhub-light.js — Light color scheme (daylight counterpart to lazyhub-dark).
 *
 * Auto-selected when the terminal background is detected as light
 * (via $COLORFGBG or bg-detect.js heuristics). Can also be set explicitly
 * via config or the settings switcher.
 *
 * Design approach:
 *   - Light gray canvas (#f6f8fa, GitHub Light surface) instead of dark.
 *   - Dark foreground (#1f2328, GitHub Light body) for contrast.
 *   - Accent blue (#0969da, GitHub Light link) — same family, light-tuned.
 *   - Diff add: #0f7931 fg on #dafbe1 bg (GitHub Light diff-add palette).
 *   - Diff del: #82071e fg on #ffebe9 bg (GitHub Light diff-del palette).
 *
 * Contrast ratios (approximate, WCAG AA 4.5:1 target for body text):
 *   fg.default  (#1f2328) on bg.default (#f6f8fa): ~16:1   ✓
 *   accent.primary (#0969da) on bg.default:        ~5.8:1  ✓
 *   fg.muted (#57606a)   on bg.default:            ~5.0:1  ✓
 *   fg.subtle (#8c959f)  on bg.default:            ~3.0:1  (metadata/decorative)
 *
 * All values are hex strings accepted by Ink's `color` prop.
 * Diff tokens use { fg, bg } shape.
 */

export default {
  // ── Background layers ────────────────────────────────────────────────────────
  bg: {
    /** Root window canvas — lightest surface. GitHub Light canvas #f6f8fa. */
    default: '#f6f8fa',
    /** Panel / card — slightly off-white, subtle depth layer. */
    surface: '#ffffff',
    /** Popover / modal — pure white overlay, distinct from surface. */
    overlay: '#f0f2f5',
  },

  // ── Foreground text ──────────────────────────────────────────────────────────
  fg: {
    /** Primary text — near-black body copy. GitHub Light #1f2328. */
    default: '#1f2328',
    /** Secondary text — timestamps, paths, metadata. Medium gray. */
    muted: '#57606a',
    /** Tertiary — placeholders, separators, hints. Lighter gray. */
    subtle: '#8c959f',
    /**
     * Text on accent backgrounds. Near-white for contrast on #0969da.
     */
    inverse: '#ffffff',
  },

  // ── Accent ───────────────────────────────────────────────────────────────────
  accent: {
    /**
     * Focused row / active tab / primary CTA.
     * GitHub Light link/action blue.
     */
    primary: '#0969da',
    /** Links, refs, inline code, secondary interactive elements. */
    secondary: '#218bff',
  },

  // ── Status semantics ─────────────────────────────────────────────────────────
  status: {
    /** CI pass, approval. GitHub Light open/success green. */
    success: '#1a7f37',
    /** Pending / review-requested. GitHub Light warning amber. */
    warning: '#9a6700',
    /** Fail / conflict / destructive. GitHub Light danger red. */
    error: '#cf222e',
    /** Neutral informational. GitHub Light info blue. */
    info: '#0969da',
  },

  // ── Diff colors ──────────────────────────────────────────────────────────────
  diff: {
    /**
     * Added line.
     * fg: dark green readable on light diff-add bg.
     * bg: light mint row background.
     */
    add: { fg: '#0f7931', bg: '#dafbe1' },

    /**
     * Deleted line.
     * fg: dark red readable on light diff-del bg.
     * bg: light pink/red row background.
     */
    del: { fg: '#82071e', bg: '#ffebe9' },

    /** Context (unchanged) line — muted dark gray. */
    context: '#57606a',

    /** Hunk header marker, blue and distinct from context. */
    hunk: '#0969da',

    /**
     * Within-line addition emphasis (word-diff).
     * Darker green on slightly deeper mint bg.
     */
    add_emph: { fg: '#116329', bg: '#aceebb' },

    /**
     * Within-line deletion emphasis (word-diff).
     * Darker red on slightly deeper pink bg.
     */
    del_emph: { fg: '#6e011a', bg: '#ffc1c0' },
  },

  // ── PR state indicators ──────────────────────────────────────────────────────
  pr: {
    /** Open PR — green dot. */
    open: '#1a7f37',
    /** Draft PR — muted gray. */
    draft: '#8c959f',
    /** Merged PR — purple. */
    merged: '#8250df',
    /** Closed PR — red. */
    closed: '#cf222e',
  },

  // ── CI check indicators ──────────────────────────────────────────────────────
  ci: {
    /** Check passed. */
    pass: '#1a7f37',
    /** Check failed. */
    fail: '#cf222e',
    /** Check in progress. */
    pending: '#9a6700',
    /** Check skipped. */
    skipped: '#8c959f',
  },

  // ── Borders ──────────────────────────────────────────────────────────────────
  border: {
    /** Standard panel border — light gray structural rule. */
    default: '#d0d7de',
    /** Focused panel border — matches accent.primary. */
    focused: '#0969da',
    /** Dense row divider — barely visible on light background. */
    subtle: '#f0f2f5',
  },
}
