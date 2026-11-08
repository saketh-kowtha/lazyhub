/**
 * src/focus/chords.js — the one chord-token normaliser (#446, #483).
 *
 * A multi-key binding is written several ways: joined (`gg`), spaced (`g l`, the form
 * which-key shows), or with named keys (`<space><space>`, `g <Esc>`). Every consumer
 * (keymap lookup, which-key, the focus router) goes through chordTokens() so all
 * spellings mean the same sequence. Pure: no React, no Ink.
 */

const NAMED = {
  space: 'Space', enter: 'Enter', return: 'Enter', esc: 'Esc', escape: 'Esc', tab: 'Tab',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', pageup: 'PageUp', pagedown: 'PageDown',
}

function namedToken(token) {
  const m = token.match(/^<(.+)>$/)
  const body = m ? m[1] : token
  const lower = body.toLowerCase()
  if (NAMED[lower]) return NAMED[lower]
  const mod = lower.match(/^(c|s|m)-(.+)$/)
  if (mod) return `${{ c: 'Ctrl', s: 'Shift', m: 'Meta' }[mod[1]]}+${mod[2].toUpperCase()}`
  return body
}

/**
 * Split a binding string into its key tokens.
 * `gg` -> ['g','g']; `g l` -> ['g','l']; `<space><space>` -> ['Space','Space'];
 * `Ctrl+R` and `Enter` stay one token; a single character is one token.
 * @param {string} binding binding as written in a keymap or registry
 * @returns {string[]} normalised key tokens (empty for an empty binding)
 */
export function chordTokens(binding) {
  const raw = String(binding ?? '').trim()
  if (!raw) return []
  const out = []
  for (const part of raw.split(/\s+/)) {
    if (part.includes('<')) {
      // <name> groups, possibly back to back, possibly mixed with plain characters.
      for (const g of part.match(/<[^>]+>|[^<>]/g) || []) out.push(namedToken(g))
    } else if (part.length > 1 && !part.includes('+') && !NAMED[part.toLowerCase()]) {
      // A bare run of characters is a joined chord (`gg`, `gl`).
      out.push(...part)
    } else {
      out.push(namedToken(part))
    }
  }
  return out
}

/**
 * Canonical spelling of a chord: tokens joined by one space.
 * @param {string} binding binding as written
 * @returns {string} e.g. `g l`
 */
export function canonicalChord(binding) {
  return chordTokens(binding).join(' ')
}

/**
 * Every spelling a two-key chord may have been bound under, canonical first.
 * @param {string} first first key
 * @param {string} second second key
 * @returns {string[]} lookup candidates
 */
export function chordSpellings(first, second) {
  return [...new Set([`${first} ${second}`, `${first}${second}`])]
}

/**
 * Two-key chord timing, independent of React. Feed each key; when the previous plain
 * key arrived within the window, `feed` returns it so the caller can resolve the pair.
 * @param {{ windowMs?: number, now?: () => number }} [opts] timing options
 * @returns {{ feed: (input: string, key?: object) => string|null, reset: () => void }} tracker
 */
export function createChordTracker({ windowMs = 400, now = Date.now } = {}) {
  let last = { input: null, at: 0 }
  return {
    feed(input, key = {}) {
      const t = now()
      const prev = last
      const plain = input && input.length === 1 && !key.ctrl && !key.meta ? input : null
      last = { input: plain, at: t }
      return plain && prev.input && t - prev.at <= windowMs ? prev.input : null
    },
    reset() { last = { input: null, at: 0 } },
  }
}
