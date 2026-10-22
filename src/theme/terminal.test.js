import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import cliBoxes from 'cli-boxes'
import { GLYPH_MAP, lacksUnicode, stripColor, terminalPrefs, toAscii, wrapStdout } from './terminal.js'
import { DEFAULT_CONFIG } from '../config/schema.js'
import { displayWidth } from '../utils.js'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(jsx?|toml)$/.test(name) && !/\.test\.jsx?$/.test(name) ? [path] : []
  })
}

describe('ASCII glyph map', () => {
  it('maps every non-ASCII character used in shipped source, pane icons and Ink borders', () => {
    const used = new Set()
    for (const file of sourceFiles(SRC)) {
      for (const ch of readFileSync(file, 'utf8')) if (ch.codePointAt(0) > 127) used.add(ch)
    }
    for (const pane of Object.values(DEFAULT_CONFIG.panes)) for (const ch of pane.icon || '') used.add(ch)
    for (const box of Object.values(cliBoxes)) for (const part of Object.values(box)) for (const ch of String(part)) used.add(ch)
    const unmapped = [...used].filter(ch => ch.codePointAt(0) > 127 && !(ch in GLYPH_MAP))
    expect(unmapped).toEqual([])
  })

  it('maps to ASCII of the same display width (keeps the #275 icon-width layout valid)', () => {
    for (const [glyph, ascii] of Object.entries(GLYPH_MAP)) {
      expect(ascii, glyph).toMatch(/^[\x20-\x7e]+$/)
      expect(displayWidth(ascii), `${glyph} -> ${ascii}`).toBe(displayWidth(glyph))
    }
  })

  it('leaves ordinary text, including non-symbol Unicode, untouched', () => {
    expect(toAscii('⎇  Pull Requests ─ ✓ ok')).toBe('P  Pull Requests - v ok')
    expect(toAscii('Café 日本語')).toBe('Café 日本語')
  })
})

describe('terminal capability detection', () => {
  const utf8 = { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' }
  const cases = [
    ['modern UTF-8 terminal', utf8, 'linux', false],
    ['TERM=linux (kernel console)', { ...utf8, TERM: 'linux' }, 'linux', true],
    ['TERM=dumb', { ...utf8, TERM: 'dumb' }, 'linux', true],
    ['LANG=C', { TERM: 'xterm', LANG: 'C' }, 'linux', true],
    ['LC_ALL beats LANG', { TERM: 'xterm', LANG: 'en_US.UTF-8', LC_ALL: 'POSIX' }, 'linux', true],
    ['LC_ALL=C.UTF-8', { TERM: 'xterm', LANG: 'C', LC_ALL: 'C.UTF-8' }, 'linux', false],
    ['unset locale is not evidence', { TERM: 'xterm' }, 'linux', false],
    ['legacy Windows console', { TERM: undefined }, 'win32', true],
    ['Windows Terminal', { WT_SESSION: 'abc' }, 'win32', false],
    ['Windows VS Code terminal', { TERM_PROGRAM: 'vscode' }, 'win32', false],
  ]
  it.each(cases)('%s', (_name, env, platform, ascii) => {
    expect(lacksUnicode(env, platform)).toBe(ascii)
  })

  it('[ui].icons overrides detection in both directions', () => {
    const linux = { TERM: 'linux' }
    expect(terminalPrefs({ icons: 'unicode' }, linux, 'linux').ascii).toBe(false)
    expect(terminalPrefs({ icons: 'ascii' }, utf8, 'linux').ascii).toBe(true)
    expect(terminalPrefs({}, linux, 'linux').ascii).toBe(true)
  })

  it('honors NO_COLOR only when non-empty, and [ui].no_color', () => {
    expect(terminalPrefs({}, { NO_COLOR: '1' }, 'linux').noColor).toBe(true)
    expect(terminalPrefs({}, { NO_COLOR: '' }, 'linux').noColor).toBe(false)
    expect(terminalPrefs({ no_color: true }, {}, 'linux').noColor).toBe(true)
    expect(terminalPrefs({}, {}, 'linux').noColor).toBe(false)
  })
})

describe('output downgrade', () => {
  it('stripColor drops colors but keeps bold/inverse/reset', () => {
    expect(stripColor('\x1b[1m\x1b[38;2;1;2;3mhi\x1b[39m\x1b[22m')).toBe('\x1b[1mhi\x1b[22m')
    expect(stripColor('\x1b[48;5;200;7mx\x1b[0m')).toBe('\x1b[7mx\x1b[0m')
    expect(stripColor('\x1b[32;1mok\x1b[m')).toBe('\x1b[1mok\x1b[m')
  })

  it('wrapStdout converts string writes and passes everything else through', () => {
    const written = []
    const stdout = { columns: 80, write: chunk => { written.push(chunk); return true }, on() { return this } }
    expect(wrapStdout(stdout, { ascii: false, noColor: false })).toBe(stdout)
    const wrapped = wrapStdout(stdout, { ascii: true, noColor: true })
    wrapped.write('\x1b[31m● ✓\x1b[39m')
    expect(written).toEqual(['* v'])
    expect(wrapped.columns).toBe(80)
  })
})
