/** bg-detect.js — Terminal background brightness detection for theme selection. */
/**
 * bg-detect.js — Terminal background brightness detection.
 *
 * Pure function, no side effects, no I/O. Reads environment variables
 * passed in as an argument (defaults to process.env) for easy testing.
 *
 * Detection strategy (in priority order):
 *   1. $COLORFGBG   — set by many terminal emulators, format "fg;bg"
 *                     bg component: 7 or 15 = light background, 0 or 8 = dark.
 *   2. $TERM_PROGRAM — well-known values that imply a default background.
 *   3. $COLORTHEME  — explicit hint some terminals set ('light'|'dark').
 *
 * Returns 'dark' | 'light' | 'unknown'.
 *
 * Reference for COLORFGBG convention:
 *   The variable has the form "fg;bg" (sometimes "fg;bg;color-count").
 *   The bg component encodes a terminal palette index:
 *     0 = black (dark bg)       8  = bright black / dark gray (dark bg)
 *     7 = white (light bg)      15 = bright white (light bg)
 *   Some terminals write just the bg number; some write fg;bg.
 *   We extract the LAST numeric segment to get the bg value.
 *
 * @param {NodeJS.ProcessEnv} [env] — injectable for testing; defaults to process.env
 * @returns {'dark' | 'light' | 'unknown'}
 */
/**
 * Detect terminal background brightness from environment variables.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {'dark' | 'light' | 'unknown'}
 */
export function detectBackground(env = process.env) {
  // ── 1. $COLORFGBG ──────────────────────────────────────────────────────────
  const colorfgbg = env.COLORFGBG
  if (colorfgbg) {
    const result = parseColorFgBg(colorfgbg)
    if (result !== 'unknown') return result
  }

  // ── 2. $COLORTHEME (explicit hint) ────────────────────────────────────────
  const colorTheme = env.COLORTHEME
  if (colorTheme) {
    const lower = colorTheme.toLowerCase()
    if (lower === 'light') return 'light'
    if (lower === 'dark')  return 'dark'
  }

  // ── 3. $TERM_PROGRAM heuristics ───────────────────────────────────────────
  const termProgram = env.TERM_PROGRAM
  if (termProgram) {
    const result = guessFromTermProgram(termProgram)
    if (result !== 'unknown') return result
  }

  return 'unknown'
}

/**
 * Parse $COLORFGBG and return background brightness.
 *
 * Format: "fg;bg"  or  "fg;middle;bg"  or  just "bg"
 * We take the LAST semicolon-delimited segment as the bg palette index.
 *
 * Light bg indices: 7, 15
 * Dark  bg indices: 0, 8
 * Anything else → 'unknown'
 *
 * @param {string} value
 * @returns {'dark' | 'light' | 'unknown'}
 */
export function parseColorFgBg(value) {
  if (typeof value !== 'string') return 'unknown'

  const parts = value.trim().split(';')
  const last = parts[parts.length - 1]
  const n = parseInt(last, 10)

  if (isNaN(n)) return 'unknown'

  // Light terminal backgrounds: palette index 7 (white) or 15 (bright white)
  if (n === 7 || n === 15) return 'light'

  // Dark terminal backgrounds: palette index 0 (black) or 8 (dark gray/bright black)
  if (n === 0 || n === 8) return 'dark'

  return 'unknown'
}

/**
 * Guess background from $TERM_PROGRAM known values.
 *
 * Most modern terminals default to dark backgrounds. Notable exceptions:
 *   - Apple Terminal.app: historically defaults to white/light.
 *   - Others: dark by convention.
 *
 * This is a heuristic only — COLORFGBG is always preferred.
 *
 * @param {string} termProgram
 * @returns {'dark' | 'light' | 'unknown'}
 */
export function guessFromTermProgram(termProgram) {
  if (typeof termProgram !== 'string') return 'unknown'
  const lower = termProgram.toLowerCase()

  // Apple Terminal.app — default theme is "Basic" which is light.
  if (lower === 'apple_terminal') return 'light'

  // These are all dark-defaulting terminals.
  const darkTerminals = [
    'iterm.app',
    'hyper',
    'wezterm',
    'alacritty',
    'kitty',
    'ghostty',
    'vscode',
    'tabby',
    'terminus',
  ]

  if (darkTerminals.includes(lower)) return 'dark'

  return 'unknown'
}
