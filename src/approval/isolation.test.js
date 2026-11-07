import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Groundwork isolation (docs/design/optional-approval.md sections 1.3 and 9):
// nothing on a runtime path may reach the approval module, and the module may
// not reach anything that writes to GitHub or opens a connection.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPROVAL = join(SRC, 'approval')
const CONTEXT_FILE = join(SRC, 'executor', 'approval-context.js')
const BARREL = join(SRC, 'executor.js')

function walk(root) {
  const out = []
  for (const name of readdirSync(root)) {
    const full = join(root, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx|mjs|cjs)$/.test(name)) out.push(full)
  }
  return out
}

const isTest = file => /\.(test|spec)\.(js|jsx)$/.test(file) || file.includes(`${sep}fixtures${sep}`)
const all = walk(SRC)
const product = all.filter(file => !isTest(file))
const insideApproval = file => file === APPROVAL || file.startsWith(APPROVAL + sep)
const rel = file => relative(SRC, file).split(sep).join('/')

// Import specifiers (static, dynamic and re-export) found in a source text.
function specifiers(text) {
  const out = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1])
  return out
}

describe('approval isolation', () => {
  it('finds the module under test (guards against a vacuous scan)', () => {
    expect(product.some(insideApproval)).toBe(true)
    expect(product.length).toBeGreaterThan(50)
  })

  it('no file outside src/approval imports src/approval (tests excluded)', () => {
    // The single allowed edge: the context reader throws the catalog's error type, a leaf module.
    const allowed = file => file === CONTEXT_FILE
    const offenders = []
    for (const file of product.filter(f => !insideApproval(f))) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (!/(^|\/)approval(\/|$)/.test(spec)) continue
        if (allowed(file) && /^\.\.\/approval\/errors\.js$/.test(spec)) continue
        offenders.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('readApprovalContext is referenced only by its own module and the executor barrel', () => {
    const offenders = product
      .filter(file => file !== CONTEXT_FILE && file !== BARREL)
      .filter(file => /readApprovalContext|approval-context/.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
    const barrel = readFileSync(BARREL, 'utf8')
    expect(barrel).toMatch(/export \* from '\.\/executor\/approval-context\.js'/)
  })

  it('no importer of the executor barrel or the context module calls readApprovalContext outside tests', () => {
    // The barrel re-exports the symbol; nothing may actually use it yet.
    const users = product.filter(file => /\breadApprovalContext\b/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(users.sort()).toEqual(['executor/approval-context.js'])
  })

  it('src/approval imports no executor module except the pure evidence constants', () => {
    const offenders = []
    for (const file of product.filter(insideApproval)) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (/(^|\/)executor(\.js|\/)/.test(spec) && !/executor\/evidence\.js$/.test(spec)) offenders.push(`${rel(file)} -> ${spec}`)
        if (/(^|\/)(daemon|mcp|ipc|cli|services)(\.js|\/|$)/.test(spec)) offenders.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('src/approval has no merge, review, check-run write, network or process spawning', () => {
    const forbidden = [
      [/\bgh\s+pr\s+merge|['"]pr['"]\s*,\s*['"]merge['"]/, 'gh pr merge'],
      [/check-runs/, 'check-runs endpoint'],
      [/\/reviews\b|['"]review['"]/, 'review endpoint'],
      [/\b(?:node:)?(?:https?|net|tls|dgram|http2)['"]/, 'network module'],
      [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/, 'network call'],
      [/\b(?:execa|execFile|execSync|spawn|spawnSync|child_process)\b/, 'process spawning'],
      [/\brunGh\b/, 'runGh'],
      [/\bmerge(?:PullRequest|PR)\b|\bmutation\b/, 'mutation'],
      [/\bDate\.now\s*\(|\bMath\.random\s*\(/, 'ambient clock or randomness'],
    ]
    const hits = []
    for (const file of product.filter(insideApproval)) {
      const text = readFileSync(file, 'utf8')
      for (const [re, label] of forbidden) if (re.test(text)) hits.push(`${rel(file)}: ${label}`)
    }
    expect(hits).toEqual([])
  })

  it('the context module only reads: no mutation, no write verbs, no raw HTTP', () => {
    const text = readFileSync(CONTEXT_FILE, 'utf8')
    expect(text).not.toMatch(/\bmutation\b|--method|-X\b|--input|check-runs|fetch\s*\(|node:https?/)
    expect(specifiers(text).filter(s => !s.startsWith('./') && !s.startsWith('../') && !s.startsWith('node:'))).toEqual([])
  })

  it('no config key, IPC type, MCP tool or CLI command mentions approval', () => {
    const surfaces = [
      join(SRC, 'daemon', 'protocol.js'),
      join(SRC, 'mcp.js'),
      join(SRC, 'config', 'loader.js'),
    ].filter(file => { try { return statSync(file).isFile() } catch { return false } })
    const hits = surfaces.filter(file => /(^|[^_a-zA-Z])approval(s|_)?/i.test(readFileSync(file, 'utf8').replace(/allow_approvals/g, ''))).map(rel)
    expect(hits).toEqual([])
  })
})
