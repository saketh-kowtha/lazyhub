/**
 * src/theme/terminal.js — terminal capability fallbacks for the theme layer (#311).
 *
 * Components keep emitting the same glyphs and colors; this module decides, once
 * at startup, whether the terminal can show them, and wraps the stdout handed to
 * Ink so the frame is downgraded on the way out:
 *   - ASCII mode swaps every glyph in GLYPH_MAP for a same-width ASCII stand-in
 *     (width is preserved so the B-55/#275 icon-width layout math stays valid).
 *   - No-color mode drops SGR foreground/background colors but keeps bold, dim,
 *     inverse and underline.
 * Color depth (truecolor -> 256 -> 16) is chalk's own COLORTERM/TERM detection.
 */

import { loadConfig } from '../config/loader.js'

/** Every non-ASCII symbol lazyhub renders, mapped to an ASCII string of equal display width. */
export const GLYPH_MAP = {
  // box drawing (Ink border styles + hand-drawn rules)
  '─': '-', '━': '=', '│': '|', '┃': '|', '┊': ':', '═': '=', '║': '|',
  '┌': '+', '┐': '+', '└': '+', '┘': '+', '├': '+', '┤': '+', '┬': '+', '┴': '+', '┼': '+',
  '┏': '+', '┓': '+', '┗': '+', '┛': '+', '╭': '+', '╮': '+', '╰': '+', '╯': '+',
  '╔': '+', '╗': '+', '╚': '+', '╝': '+', '╓': '+', '╖': '+', '╙': '+', '╜': '+',
  '╒': '+', '╕': '+', '╘': '+', '╛': '+',
  // blocks, bars and markers
  '█': '#', '▒': ':', '░': '.', '▎': '|', '▍': '|', '▣': '#',
  '●': '*', '○': 'o', '◉': '@', '◎': 'o', '◆': '#', '◇': '+', '◈': '*', '◐': '%', '•': '*', '·': '.',
  '▶': '>', '►': '>', '▸': '>', '❯': '>', '›': '>', '▲': '^',
  // arrows and punctuation
  '→': '>', '←': '<', '↑': '^', '↓': 'v', '↩': '<', '↘': '\\', '↙': '/', '↖': '\\', '↗': '/','↺': '~', '⟳': '~', '…': '~',
  '—': '-', '–': '-', '≥': '>', '≤': '<', '±': '+', '§': '#',
  // status
  '✓': 'v', '✗': 'x', '⚠': '!', '⊘': '-', '◷': '~', 'ℹ': 'i',
  // pane and sidebar icons (current and pre-#275 defaults)
  '⎇': 'P', '⚑': 'I', '⌥': 'B', '↯': 'A', '✦': '*', '⌘': 'S', '⌸': 'L', '⌂': 'H', '⌨': 'K', '⚙': 'S',
  '⑂': 'Y', '⚡': '!!',
  // spinner frames
  '⠋': '|', '⠙': '/', '⠹': '-', '⠸': '\\', '⠼': '|', '⠴': '/', '⠦': '-', '⠧': '\\', '⠇': '|', '⠏': '/',
  // emoji (two columns wide)
  '🔒': 'LK', '📋': '[]', '💬': '""',
}

const GLYPH_RE = new RegExp(`[${Object.keys(GLYPH_MAP).join('')}]`, 'gu')

/**
 * Replace every known symbol with its ASCII stand-in; all other text is untouched.
 * @param {string} text
 * @returns {string}
 */
export function toAscii(text) {
  return text.replace(GLYPH_RE, ch => GLYPH_MAP[ch])
}

/**
 * Drop SGR color parameters (30-37, 38;..., 39, 40-47, 48;..., 49, 90-97, 100-107)
 * while keeping every other attribute (bold, dim, inverse, underline, resets).
 * @param {string} text
 * @returns {string}
 */
export function stripColor(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[([0-9;]*)m/g, (seq, params) => {
    if (params === '') return seq
    const parts = params.split(';')
    const kept = []
    for (let i = 0; i < parts.length; i += 1) {
      const n = Number(parts[i])
      if (n === 38 || n === 48) { i += parts[i + 1] === '5' ? 2 : parts[i + 1] === '2' ? 4 : 0; continue }
      if ((n >= 30 && n <= 39) || (n >= 40 && n <= 49) || (n >= 90 && n <= 97) || (n >= 100 && n <= 107)) continue
      kept.push(parts[i])
    }
    return kept.length ? `\x1b[${kept.join(';')}m` : ''
  })
}

/**
 * True when the terminal probably cannot render lazyhub's symbols.
 * Linux VT / dumb terminals, a non-UTF-8 locale, or a legacy Windows console.
 * An unset locale is not evidence either way, so it keeps Unicode.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} platform
 * @returns {boolean}
 */
export function lacksUnicode(env, platform) {
  if (platform === 'win32') {
    // Legacy conhost (no VT / TrueType fallback fonts) sets none of these.
    return !(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON'
      || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' || /^(xterm|alacritty)/.test(env.TERM || ''))
  }
  if (env.TERM === 'linux' || env.TERM === 'dumb') return true
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG
  return Boolean(locale) && !/utf-?8/i.test(locale)
}

/**
 * Decide the output downgrades. `[ui].icons` = "ascii" | "unicode" overrides the
 * auto-detection; `NO_COLOR` (non-empty) and `[ui].no_color` both disable color.
 * @param {object} [ui] the `[ui]` config table
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {{ ascii: boolean, noColor: boolean }}
 */
export function terminalPrefs(ui = {}, env = process.env, platform = process.platform) {
  const icons = ui.icons || 'auto'
  return {
    ascii: icons === 'ascii' || (icons === 'auto' && lacksUnicode(env, platform)),
    noColor: Boolean(env.NO_COLOR) || ui.no_color === true,
  }
}

/**
 * Wrap a TTY stream so frames written through it are downgraded. Returns the
 * stream itself when nothing needs downgrading.
 * @param {import('stream').Writable} stdout
 * @param {{ ascii: boolean, noColor: boolean }} prefs
 */
export function wrapStdout(stdout, { ascii, noColor }) {
  if (!ascii && !noColor) return stdout
  const convert = text => {
    const colored = noColor ? stripColor(text) : text
    return ascii ? toAscii(colored) : colored
  }
  return new Proxy(stdout, {
    get(target, prop) {
      if (prop === 'write') {
        return (chunk, ...rest) => target.write(typeof chunk === 'string' ? convert(chunk) : chunk, ...rest)
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Stdout for the Ink render, downgraded per config + environment.
 * @param {import('stream').Writable} [stdout]
 */
export function terminalStdout(stdout = process.stdout) {
  let ui = {}
  try { ui = loadConfig().ui || {} } catch { /* config errors surface elsewhere; fall back to env detection */ }
  return wrapStdout(stdout, terminalPrefs(ui))
}
