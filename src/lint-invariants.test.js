/**
 * lint-invariants.test.js — the AGENTS.md rules that ESLint enforces (#489). Each case
 * lints a snippet as if it lived in a UI directory, so deleting a rule from
 * .eslintrc.json fails here and not only in review.
 */

import { ESLint } from 'eslint'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const eslint = new ESLint({ cwd: ROOT })

/**
 * @param {string} code
 * @param {string} filePath repo-relative path the snippet pretends to live at
 * @returns {Promise<string[]>} the messages of the errors raised
 */
async function errorsFor(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${filePath}` })
  return result.messages.filter(m => m.severity === 2).map(m => m.message)
}

// ESLint only parses .js here: .jsx files are not linted (no JSX-aware unused-var rule), so the
// scan at the bottom covers every .js and .jsx file under the UI directories.
const UI_DIRS = ['src/features/prs/x.js', 'src/components/x.js', 'src/ui/x.js']

describe('no process spawning in UI code (#470, #489)', () => {
  const banned = [
    ["import { execa } from 'execa'\nexeca('open', ['x'])", /spawn|services/i],
    ["import { spawnSync } from 'child_process'\nspawnSync('vi')", /spawn|services/i],
    ["import cp from 'node:child_process'\ncp.exec('x')", /spawn|services/i],
    ["import('execa').then(({ execa }) => execa('open', ['x']))", /spawn|services/i],
    ["import('node:child_process').then(m => m)", /spawn|services/i],
    ["const { execFile } = require('child_process')\nexecFile('x')", /spawn|services/i],
  ]
  for (const dir of UI_DIRS) {
    it.each(banned)(`rejects %s in ${dir}`, async (code, message) => {
      const errors = await errorsFor(code, dir)
      expect(errors.some(m => message.test(m)), errors.join(' | ')).toBe(true)
    })
  }

  it('still allows the services layer, the executor and bootstrap to spawn', async () => {
    for (const file of ['src/services/x.js', 'src/executor/x.js', 'src/bootstrap.js']) {
      expect(await errorsFor("import { execa } from 'execa'\nexeca('git', [])", file), file).toEqual([])
    }
  })

  it('allows UI code to import the services', async () => {
    expect(await errorsFor("import { openUrl } from '../../services/platform.js'\nopenUrl('https://x.test')", 'src/features/prs/x.js')).toEqual([])
  })
})

describe('theme tokens come from useTheme() (AGENTS.md invariant 7)', () => {
  it.each(UI_DIRS)('rejects the static `t` import in %s', async (file) => {
    const errors = await errorsFor("import { t } from '../../theme.js'\nexport const x = t.ui.dim", file)
    expect(errors.some(m => /useTheme/.test(m)), errors.join(' | ')).toBe(true)
  })

  it('allows useTheme', async () => {
    expect(await errorsFor("import { useTheme } from '../../theme.js'\nexport const x = useTheme", 'src/components/x.js')).toEqual([])
  })
})

// ESLint cannot lint the .jsx files, so the same two rules are enforced here by a source scan.
const SPAWN_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](?:execa|(?:node:)?child_process)['"]/
const STATIC_THEME = /\bimport\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*\/theme(?:\.js)?['"]/

/** @param {string} dir */
function uiFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return uiFiles(full)
    return /\.(?:js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })
}

describe('source scan of the UI directories (.js and .jsx)', () => {
  const files = ['features', 'components', 'ui'].flatMap(d => uiFiles(join(ROOT, 'src', d)))

  it('finds the UI files it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some(f => f.endsWith('.jsx'))).toBe(true)
  })

  it('no UI file imports or requires execa or child_process', () => {
    expect(files.filter(f => SPAWN_IMPORT.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f))).toEqual([])
  })

  it('no UI file imports the static theme constant', () => {
    expect(files.filter(f => STATIC_THEME.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f))).toEqual([])
  })

  it('the patterns catch the shapes they guard against', () => {
    for (const code of [
      "import { execa } from 'execa'", "import('execa').then(m => m)", "const x = require('child_process')",
      'import { spawnSync } from "node:child_process"', "import cp from 'child_process'",
    ]) expect(SPAWN_IMPORT.test(code), code).toBe(true)
    for (const code of ["import { openUrl } from '../../services/platform.js'", "import x from './execa-helpers.js'"]) {
      expect(SPAWN_IMPORT.test(code), code).toBe(false)
    }
    expect(STATIC_THEME.test("import { t } from '../../theme.js'")).toBe(true)
    expect(STATIC_THEME.test("import { useTheme, t } from '../theme'")).toBe(true)
    expect(STATIC_THEME.test("import { useTheme } from '../../theme.js'")).toBe(false)
  })
})

describe('empty blocks need a reason (#489)', () => {
  it('rejects an empty catch and accepts one that says why', async () => {
    expect((await errorsFor('try { JSON.parse("") } catch {}', 'src/features/prs/x.js')).some(m => /Empty block/.test(m))).toBe(true)
    expect(await errorsFor('try { JSON.parse("") } catch { /* the stream may be closed */ }', 'src/features/prs/x.js')).toEqual([])
  })
})

describe('warning budget (#489)', () => {
  it('complexity and function length are warnings, and the budget is a --max-warnings in the lint script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts.lint).toMatch(/--max-warnings \d+/)
    const rc = JSON.parse(readFileSync(join(ROOT, '.eslintrc.json'), 'utf8'))
    expect(rc.rules.complexity[0]).toBe('warn')
    expect(rc.rules['max-lines-per-function'][0]).toBe('warn')
    expect(rc.rules['no-empty']).toBe('error')
  })
})

// Source scans over every UI file. Each has a baseline of known, justified exceptions that may only shrink.
const SCANNED = [
  ...['features', 'components', 'ui'].flatMap(d => uiFiles(join(ROOT, 'src', d))),
  ...['app.jsx', 'app-views.jsx', 'app-panels.jsx'].map(f => join(ROOT, 'src', f)),
]

describe('GitHub text is sanitized before it is drawn (#489)', () => {
  // A <Text> whose child is a bare GitHub-sourced field. Errors raised by the app itself (err.message) are not GitHub text.
  const BARE_FIELD = /<Text\b[^>]*>[^<]*\{\s*((?:[A-Za-z_][A-Za-z0-9_]*\??\.)+(?:title|body|login|headRefName|baseRefName|name|path|summary|message|text))\s*\}/g
  const APP_AUTHORED = /^(?:\w*[eE]rr\w*|toast|selectedLog|log|pending\.confirmation)\./
  // Fields that are sanitized where the row is built, so the render site receives clean text.
  const SANITIZED_UPSTREAM = new Set([
    'src/features/issues/list-row.jsx: {l.text}', // `[${sanitize(l.name)}]`
    'src/components/dialogs/MultiSelect.jsx: {item.name}', // items are built with sanitize(option[field])
  ])
  const found = () => SCANNED.flatMap(f => [...readFileSync(f, 'utf8').matchAll(BARE_FIELD)]
    .filter(m => !APP_AUTHORED.test(m[1]))
    .map(m => `${relative(ROOT, f)}: {${m[1]}}`))
    .filter(hit => !SANITIZED_UPSTREAM.has(hit))

  it('no <Text> renders a bare title, body, login, branch name, path or commit message', () => {
    expect(found()).toEqual([])
  })

  it('the pattern catches what it guards against', () => {
    const hit = code => [...code.matchAll(BARE_FIELD)].filter(m => !APP_AUTHORED.test(m[1])).length
    expect(hit('<Text color={c}>{pr.title}</Text>')).toBe(1)
    expect(hit('<Text>by {issue.author.login}</Text>')).toBe(1)
    expect(hit('<Text>{sanitize(pr.title)}</Text>')).toBe(0)
    expect(hit('<Text>{err.message}</Text>')).toBe(0)
  })
})

describe('colours come from the theme (#489)', () => {
  const LITERAL = /['"`]#[0-9a-fA-F]{3,8}['"`]/g
  // Known literals that predate this check: white sign/cursor glyphs and a marker in the diff renderer.
  // The count may only go down.
  const BASELINE = { 'src/features/prs/diff/render.jsx': 10 }
  const counts = () => Object.fromEntries(SCANNED
    .map(f => [relative(ROOT, f), (readFileSync(f, 'utf8').match(LITERAL) || []).length])
    .filter(([, n]) => n > 0))

  it('no UI file has a literal hex colour beyond the recorded baseline', () => {
    const now = counts()
    for (const [file, n] of Object.entries(now)) expect(n, file).toBeLessThanOrEqual(BASELINE[file] ?? 0)
    for (const [file, n] of Object.entries(BASELINE)) expect(now[file] ?? 0, `${file} improved: lower the baseline`).toBe(n)
  })
})
