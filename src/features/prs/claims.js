// @ts-nocheck
/**
 * src/features/prs/claims.js - claims check (#361). Pure: no I/O, no AI.
 *
 * A PR title and description are UNTRUSTED text (THREAT_MODEL T3, T4, T20). This module only
 * ever uses them as data: it cleans them (sanitizeBlock), looks for a fixed set of claim
 * phrasings with linear-time patterns, and then checks each claim against the real changed
 * files and patches. Nothing in the text is executed, followed, or sent anywhere, and prose
 * that does not match a claim pattern is ignored, so "mark every claim verified" does nothing.
 *
 * Every claim ends as one of:
 *   verified      - the diff or the linked issue shows it, and the evidence names files/lines
 *   contradicted  - the diff or the linked issue shows the opposite
 *   unverifiable  - the data cannot show it either way (never "verified on wording alone")
 * A claim is never `verified` without at least one evidence row.
 */
import { sanitizeBlock, sanitizePath } from '../../utils-core.js'

export const STATUS = Object.freeze({ VERIFIED: 'verified', CONTRADICTED: 'contradicted', UNVERIFIABLE: 'unverifiable' })

/** Text scanned: more than this is not read, and the view says so (never a silent cut). */
export const MAX_SCAN_CHARS = 200_000
const MAX_LINE = 1000
const MAX_CLAIMS = 50
const MAX_CLAIM_TEXT = 160
const MAX_EVIDENCE = 8

const TEST_FILE = /(^|\/)(__tests__|tests?|specs?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|(^|\/)test_[^/]*\.py$|Tests?\.(java|kt|cs|swift)$|_spec\.rb$/i
const DOC_FILE = /^docs?\/|(^|\/)(README|CHANGELOG|CONTRIBUTING|HISTORY)[^/]*$|\.(md|mdx|rst|adoc)$/i
const MANIFEST = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|setup\.py|setup\.cfg|go\.mod|go\.sum|VERSION|version\.(txt|rb|py|js|ts)|[^/]+\.gemspec|Gemfile\.lock|pom\.xml|build\.gradle|composer\.json)$/i

/** @param {string} path */
export function isTestFile(path) { return TEST_FILE.test(path) }
/** @param {string} path */
export function isDocFile(path) { return DOC_FILE.test(path) }

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

const REF = '(?:[\\w.-]{1,40}\\/[\\w.-]{1,100})?#\\d{1,9}'
const FIXES = new RegExp(`\\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\\s?:?\\s+(${REF}(?:\\s{0,3}(?:,|and|&)\\s{0,3}${REF}){0,9})`, 'gi')
const TESTS = [
  /\b(?:add(?:s|ed|ing)?|updat(?:e|es|ed|ing)|includ(?:e|es|ed|ing)|extend(?:s|ed)?|improv(?:e|es|ed)|with)\s+(?:[\w-]{1,20}\s+){0,3}?(?:tests?|test cases?|test coverage|specs?)\b/i,
  /\b(?:tests?|specs?|test cases?)\s+(?:added|included|updated)\b/i,
]
const NO_BREAKING = /\b(?:no\s+breaking\s+changes?|non-?breaking|(?:fully\s+)?backwards?[- ]compatible|not\s+a\s+breaking\s+change|no\s+api\s+changes?)\b/i
const ONLY_TOUCHES = /\b(?:only|just)\s+(?:touch(?:es|ed)?|chang(?:es|ed)?|modif(?:y|ies|ied)|affect(?:s|ed)?|updat(?:es|ed)?)\s+(?:the\s+)?(`[^`]{1,120}`|[\w./@*-]{1,120})/i
const DOCS = [
  /\b(?:updat(?:e|es|ed|ing)|add(?:s|ed|ing)?|document(?:s|ed)?|extend(?:s|ed)?)\s+(?:[\w-]{1,20}\s+){0,3}?(?:docs?|documentation|readme|changelog)\b/i,
  /\b(?:docs?|documentation|readme|changelog)\s+(?:updated|added)\b/i,
]
const VERSION_TARGET = /\b(?:bump(?:s|ed)?|upgrad(?:e|es|ed)|releas(?:e|es|ed)|updat(?:e|es|ed))\b[^\n]{0,60}?\bv?(\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][\w.]{1,30})?)/i
const VERSION_BUMP = /\bversion\s+bump\b|\bbump(?:s|ed)?\s+(?:the\s+)?version\b/i
const PERF = /\b(?:improv\w{1,5}|boost\w{0,3}|increas\w{1,4}|better)\s+(?:[\w-]{1,20}\s+){0,2}?(?:performance|perf|speed|latency|throughput)\b|\b\d{1,4}(?:\.\d{1,2})?x\s+faster\b|\bfaster\b|\bspeeds?\s+up\b|\bperformance\s+(?:improvement|boost|fix|win)s?\b/i
const SECURITY = /\bCVE-\d{4}-\d{4,7}\b|\bsecurity\s+(?:fix|patch|improvement|hardening)\b|\b(?:fix\w{0,3}|patch\w{0,3}|address\w{0,3}|harden\w{0,3})\s+(?:[\w-]{1,20}\s+){0,2}?(?:vulnerabilit\w{1,3}|security)\b/i

/**
 * Drop HTML comments with plain string search (a regex over hostile text is a ReDoS risk).
 * @param {string} text
 */
function stripHtmlComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('<!--', i)
    if (open === -1) { out += text.slice(i); break }
    out += text.slice(i, open)
    const close = text.indexOf('-->', open + 4)
    if (close === -1) break // unterminated: the rest is hidden text, drop it
    i = close + 3
  }
  return out
}

/**
 * Lines that can carry a claim: not code, not quotes, not unticked template checkboxes.
 * @param {string} text
 * @param {string} source
 */
function claimLines(text, source) {
  const out = []
  let fence = null
  const lines = stripHtmlComments(text).split('\n')
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n]
    const f = /^\s{0,3}(```+|~~~+)/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence) continue
    if (/^\s*>/.test(line)) continue
    if (/^\s*[-*+]\s+\[ \]/.test(line)) continue
    line = line.replace(/^\s*[-*+]\s+\[[xX]\]\s*/, '')
    if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE)
    if (line.trim()) out.push({ source, line: n + 1, text: line })
  }
  return out
}

function excerpt(text, index = 0) {
  const t = text.trim()
  if (t.length <= MAX_CLAIM_TEXT) return t
  const start = Math.max(0, Math.min(index - 40, t.length - MAX_CLAIM_TEXT))
  return `${start > 0 ? '…' : ''}${t.slice(start, start + MAX_CLAIM_TEXT - 1)}…`
}

/**
 * Find the claims in a PR title and description.
 * @param {{ title?: string, body?: string }} pr raw GitHub text
 * @returns {{ claims: object[], notices: string[] }}
 *   claim: { id, type, text, source: 'title'|'body', line, key?, issue?, target?, scope? }
 */
export function extractClaims({ title = '', body = '' } = {}) {
  const notices = []
  const cleanTitle = sanitizeBlock(title).split('\n')[0] || ''
  let cleanBody = sanitizeBlock(body)
  if (cleanBody.length > MAX_SCAN_CHARS) {
    notices.push(`The description is ${cleanBody.length.toLocaleString('en-US')} characters long; only the first ${MAX_SCAN_CHARS.toLocaleString('en-US')} were scanned for claims.`)
    cleanBody = cleanBody.slice(0, MAX_SCAN_CHARS)
  }
  const claims = []
  const seen = new Set()
  const add = (c) => {
    const key = `${c.type}:${c.key ?? ''}`
    if (seen.has(key)) return
    if (claims.length >= MAX_CLAIMS) { seen.add('overflow'); return }
    seen.add(key)
    claims.push({ ...c, id: `c${claims.length + 1}` })
  }

  for (const src of [...claimLines(cleanTitle, 'title'), ...claimLines(cleanBody, 'body')]) {
    const { text } = src
    const base = { source: src.source, line: src.line }
    let m
    FIXES.lastIndex = 0
    while ((m = FIXES.exec(text)) !== null) {
      for (const ref of m[1].match(new RegExp(REF, 'g')) || []) {
        const hash = ref.lastIndexOf('#')
        const repo = ref.slice(0, hash)
        const number = Number(ref.slice(hash + 1))
        add({ ...base, type: 'fixes', key: `${repo}#${number}`, issue: { repo: repo || null, number }, text: excerpt(text, m.index) })
      }
    }
    if (TESTS.some(re => re.test(text))) add({ ...base, type: 'tests', text: excerpt(text) })
    if (NO_BREAKING.test(text)) add({ ...base, type: 'no-breaking', text: excerpt(text) })
    if ((m = ONLY_TOUCHES.exec(text))) {
      const scope = m[1].replace(/^`|`$/g, '')
      add({ ...base, type: 'only-touches', key: scope.toLowerCase(), scope, text: excerpt(text, m.index) })
    }
    if (DOCS.some(re => re.test(text))) add({ ...base, type: 'docs', text: excerpt(text) })
    if ((m = VERSION_TARGET.exec(text))) add({ ...base, type: 'version', key: m[1], target: m[1], text: excerpt(text, m.index) })
    else if (VERSION_BUMP.test(text)) add({ ...base, type: 'version', key: '', target: null, text: excerpt(text) })
    if (PERF.test(text)) add({ ...base, type: 'performance', text: excerpt(text) })
    if (SECURITY.test(text)) add({ ...base, type: 'security', text: excerpt(text) })
  }
  if (seen.has('overflow')) notices.push(`More than ${MAX_CLAIMS} claims were found; only the first ${MAX_CLAIMS} are checked.`)
  return { claims, notices }
}

// ---------------------------------------------------------------------------------------------
// Patch reading
// ---------------------------------------------------------------------------------------------

/**
 * Walk a unified-diff patch of ONE file. Lines are raw patch text (cleaned only when drawn).
 * @param {string} patch
 * @returns {{ kind: '+'|'-', text: string, oldLine: number, newLine: number }[]}
 */
export function patchLines(patch) {
  const out = []
  let oldLine = 0
  let newLine = 0
  for (const raw of String(patch || '').split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw)
    if (h) { oldLine = Number(h[1]); newLine = Number(h[2]); continue }
    const c = raw[0]
    if (c === '+') { out.push({ kind: '+', text: raw.slice(1), oldLine, newLine }); newLine++ }
    else if (c === '-') { out.push({ kind: '-', text: raw.slice(1), oldLine, newLine }); oldLine++ }
    else if (c === ' ') { oldLine++; newLine++ }
  }
  return out
}

const evidence = (path, line, text = '') => ({ path, line: line ?? null, text: String(text).slice(0, 200) })
const fileEvidence = (files, note) => files.slice(0, MAX_EVIDENCE).map(f => evidence(f.path, null, note))
const result = (status, reason, ev = []) => ({ status, reason, evidence: ev.slice(0, MAX_EVIDENCE) })
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------------------------------------
// Verifiers
// ---------------------------------------------------------------------------------------------

function verifyTests(files, caveats) {
  const tests = files.filter(f => isTestFile(f.path))
  if (tests.length === 0) return result(STATUS.CONTRADICTED, `No test file changed among ${plural(files.length, 'changed file')}.${caveats}`)
  const CASE = /^\s*(?:(?:it|test|describe)(?:\.(?:each|only|skip|concurrent))?\s*\(|def test_|func Test\w+\(|@Test\b|#\[test\])/
  const added = []
  for (const f of tests) {
    for (const l of patchLines(f.patch)) if (l.kind === '+' && CASE.test(l.text)) added.push(evidence(f.path, l.newLine, l.text.trim()))
  }
  if (added.length > 0) return result(STATUS.VERIFIED, `${plural(tests.length, 'test file')} changed; ${plural(added.length, 'test case')} added.`, added)
  return result(STATUS.UNVERIFIABLE, `${plural(tests.length, 'test file')} changed but no new test case was recognised (edited tests, an unknown framework, or a patch GitHub did not return).${caveats}`, fileEvidence(tests, 'test file changed'))
}

function verifyDocs(files, caveats) {
  const docs = files.filter(f => isDocFile(f.path))
  if (docs.length === 0) return result(STATUS.CONTRADICTED, `No documentation file changed among ${plural(files.length, 'changed file')}.${caveats}`)
  const ev = docs.slice(0, MAX_EVIDENCE).map(f => {
    const first = patchLines(f.patch).find(l => l.kind === '+')
    return evidence(f.path, first?.newLine ?? null, first?.text.trim() || 'documentation file changed')
  })
  return result(STATUS.VERIFIED, `${plural(docs.length, 'documentation file')} changed.`, ev)
}

function globToRegExp(glob) {
  // Escape everything, then turn * and ** back into wildcards. No nested quantifiers.
  const esc = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  return new RegExp(`^${esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`)
}

function inScope(path, scope) {
  const s = scope.replace(/^\.?\//, '').replace(/\/+$/, '')
  if (!s) return false
  if (s.includes('*')) {
    const re = globToRegExp(s)
    return re.test(path) || re.test(path.split('/').pop())
  }
  const lower = path.toLowerCase()
  const sl = s.toLowerCase()
  const base = lower.split('/').pop()
  return lower === sl || lower.startsWith(`${sl}/`) || lower.includes(`/${sl}/`) || base === sl || base.replace(/\.[^.]+$/, '') === sl
}

function verifyOnlyTouches(claim, files, caveats) {
  const inside = files.filter(f => inScope(f.path, claim.scope))
  const outside = files.filter(f => !inScope(f.path, claim.scope))
  if (inside.length === 0 && !/[/.*]/.test(claim.scope)) {
    return result(STATUS.UNVERIFIABLE, `"${sanitizePath(claim.scope)}" matches none of the ${plural(files.length, 'changed file')}, so it cannot be read as a path.${caveats}`)
  }
  if (outside.length > 0) {
    return result(STATUS.CONTRADICTED, `${plural(outside.length, 'changed file')} outside "${sanitizePath(claim.scope)}".`, fileEvidence(outside, 'outside the claimed scope'))
  }
  if (files.length === 0) return result(STATUS.UNVERIFIABLE, 'The PR has no changed files to compare.')
  return result(STATUS.VERIFIED, `All ${plural(files.length, 'changed file')} are under "${sanitizePath(claim.scope)}".${caveats}`, fileEvidence(files, 'inside the claimed scope'))
}

const EXPORT_DECL = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^def\s+([A-Za-z][\w]*)\s*\(/,
  /^func\s+([A-Z][\w]*)\s*\(/,
  /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_][\w]*)/,
]
const exportName = text => { for (const re of EXPORT_DECL) { const m = re.exec(text); if (m) return m[1] } return null }

/**
 * Removed or changed exports, CLI flags and config keys in one file's patch.
 * @param {{path:string, patch?:string}} file
 */
function breakingInFile(file) {
  const lines = patchLines(file.patch)
  const added = lines.filter(l => l.kind === '+')
  const addedText = new Set(added.map(l => l.text.trim()))
  const addedNames = new Map()
  for (const l of added) { const n = exportName(l.text); if (n && !addedNames.has(n)) addedNames.set(n, l) }
  const addedBlob = added.map(l => l.text).join('\n')
  const hits = []
  const isToml = /\.toml$/i.test(file.path)
  for (const l of lines) {
    if (l.kind !== '-' || addedText.has(l.text.trim())) continue
    const name = exportName(l.text)
    if (name) {
      hits.push(addedNames.has(name)
        ? { ...evidence(file.path, l.oldLine, l.text.trim()), why: `signature of ${name} changed` }
        : { ...evidence(file.path, l.oldLine, l.text.trim()), why: `${name} removed` })
      continue
    }
    if (isToml) {
      const key = /^\s*\[([^\]]{1,120})\]\s*$/.exec(l.text) || /^\s*([A-Za-z0-9_."-]{1,80})\s*=/.exec(l.text)
      if (key && !addedBlob.includes(key[1])) hits.push({ ...evidence(file.path, l.oldLine, l.text.trim()), why: `config key ${key[1]} removed` })
      continue
    }
    const flag = /(?:^|[^\w-])(--[a-z][a-z0-9-]{1,40})(?![\w-])/.exec(l.text)
    if (flag && !addedBlob.includes(flag[1])) hits.push({ ...evidence(file.path, l.oldLine, l.text.trim()), why: `CLI flag ${flag[1]} removed` })
  }
  return hits
}

function verifyNoBreaking(files, caveats) {
  const code = files.filter(f => !isTestFile(f.path) && !isDocFile(f.path))
  if (files.length > 0 && code.length === 0) {
    return result(STATUS.VERIFIED, `Only tests and documentation changed (${plural(files.length, 'file')}).`, fileEvidence(files, 'test or documentation file'))
  }
  const hits = code.flatMap(breakingInFile)
  if (hits.length > 0) {
    return result(STATUS.CONTRADICTED, `${plural(hits.length, 'removed or changed export, CLI flag or config key')}: ${hits.slice(0, 3).map(h => h.why).join('; ')}${hits.length > 3 ? '; …' : ''}.`, hits)
  }
  return result(STATUS.UNVERIFIABLE, `No removed export, CLI flag or config key was found in ${plural(code.length, 'source file')}, but that cannot prove compatibility (behaviour and types are not checked).${caveats}`)
}

function verifyVersion(claim, files, caveats) {
  const manifests = files.filter(f => MANIFEST.test(f.path))
  if (manifests.length === 0) return result(STATUS.CONTRADICTED, `No version manifest or lockfile changed among ${plural(files.length, 'changed file')}.${caveats}`)
  const VERSION_LINE = /["']?version["']?\s*[:=]\s*["']?v?(\d+\.\d+\.\d+[^"'\s,]*)|^\s*v?(\d+\.\d+\.\d+[\w.+-]*)\s*$/i
  const ev = []
  for (const f of manifests) {
    for (const l of patchLines(f.patch)) {
      if (l.kind !== '+') continue
      if (claim.target) {
        if (l.text.includes(claim.target)) ev.push(evidence(f.path, l.newLine, l.text.trim()))
      } else if (VERSION_LINE.test(l.text)) ev.push(evidence(f.path, l.newLine, l.text.trim()))
    }
  }
  if (ev.length > 0) return result(STATUS.VERIFIED, claim.target ? `${claim.target} appears in ${plural(new Set(ev.map(e => e.path)).size, 'changed manifest')}.` : 'A version line changed.', ev)
  const cut = manifests.some(f => f.patchTruncated || !f.patch)
  return result(STATUS.UNVERIFIABLE, `${plural(manifests.length, 'manifest')} changed but ${claim.target ? `none adds ${claim.target}` : 'no version line changed'}${cut ? ' in the patch text GitHub returned (it may be cut)' : ''}.`, fileEvidence(manifests, 'manifest changed'))
}

const REFERENCED_PATH = /[\w@.-]+(?:\/[\w@.-]+)+\.\w{1,8}|\b[\w-]+\.(?:jsx?|tsx?|mjs|cjs|py|go|rs|rb|java|md|toml|json|ya?ml)\b/g

function verifyFixes(claim, files, ctx) {
  const { issue } = claim
  if (issue.repo) return result(STATUS.UNVERIFIABLE, `#${issue.number} is in ${sanitizePath(issue.repo)}, another repository; it is not checked.`)
  const row = ctx.issues?.[issue.number]
  if (row === undefined) return result(STATUS.UNVERIFIABLE, `Issue #${issue.number} could not be fetched (or is past the first 10 issues checked).`)
  if (row === null) return result(STATUS.CONTRADICTED, `Issue #${issue.number} does not exist in this repository.`)
  if (!(ctx.closing || []).includes(issue.number)) {
    return result(STATUS.UNVERIFIABLE, `Issue #${issue.number} exists but GitHub does not list it as closed by this PR (the keyword only links on the default branch).`)
  }
  const refs = [...new Set(String(row.body || '').match(REFERENCED_PATH) || [])].slice(0, 200)
  if (refs.length === 0) return result(STATUS.UNVERIFIABLE, `Issue #${issue.number} is linked but names no files, so scope cannot be compared.`)
  const touched = files.filter(f => refs.some(r => f.path === r || f.path.endsWith(`/${r}`) || (!r.includes('/') && f.path.split('/').pop() === r)))
  if (touched.length > 0) return result(STATUS.VERIFIED, `Linked; the PR changes ${plural(touched.length, 'file')} the issue names.`, fileEvidence(touched, `named in issue #${issue.number}`))
  return result(STATUS.CONTRADICTED, `Linked, but none of the ${plural(refs.length, 'file')} issue #${issue.number} names is changed.`)
}

/**
 * Verify extracted claims against the real PR data.
 * @param {object[]} claims from extractClaims()
 * @param {{ files: {path:string, patch?:string, patchTruncated?:boolean}[], closing?: number[],
 *           issues?: Record<number, {body?:string}|null>, filesTruncated?: boolean }} ctx
 */
export function verifyClaims(claims, ctx) {
  const files = Array.isArray(ctx?.files) ? ctx.files : []
  const notices = []
  const cut = files.filter(f => f.patchTruncated).length
  const noPatch = files.filter(f => !f.patch && !isDocFile(f.path)).length
  if (ctx?.filesTruncated) notices.push('GitHub lists at most 3000 changed files; checks use the files it returned.')
  if (cut > 0) notices.push(`${plural(cut, 'patch')} longer than the scan limit were cut; claims about them may be unverifiable.`)
  if (noPatch > 0) notices.push(`${plural(noPatch, 'changed file')} came without patch text (binary, renamed, or too large for GitHub), so lines in them were not read.`)
  const caveats = ctx?.filesTruncated ? ' (the file list is capped by GitHub)' : ''

  const checked = claims.map((claim) => {
    let r
    switch (claim.type) {
      case 'fixes': r = verifyFixes(claim, files, ctx || {}); break
      case 'tests': r = verifyTests(files, caveats); break
      case 'docs': r = verifyDocs(files, caveats); break
      case 'only-touches': r = verifyOnlyTouches(claim, files, caveats); break
      case 'no-breaking': r = verifyNoBreaking(files, caveats); break
      case 'version': r = verifyVersion(claim, files, caveats); break
      case 'performance': r = result(STATUS.UNVERIFIABLE, 'Performance claims need a measurement; wording alone is never evidence.'); break
      case 'security': r = result(STATUS.UNVERIFIABLE, 'Security claims need a review of the change; wording alone is never evidence.'); break
      default: r = result(STATUS.UNVERIFIABLE, 'This kind of claim is not checked.')
    }
    // Invariant: verified always carries evidence.
    if (r.status === STATUS.VERIFIED && r.evidence.length === 0) r = result(STATUS.UNVERIFIABLE, `${r.reason} (no specific file or line could be cited)`)
    return { ...claim, ...r }
  })
  return { claims: checked, summary: summarize(checked), notices }
}

/**
 * @param {{status:string}[]} claims
 */
export function summarize(claims) {
  const count = s => claims.filter(c => c.status === s).length
  const verified = count(STATUS.VERIFIED)
  const contradicted = count(STATUS.CONTRADICTED)
  const unverifiable = count(STATUS.UNVERIFIABLE)
  const total = claims.length
  const line = total === 0
    ? 'No checkable claims found in the title or description'
    : `${verified} of ${total} claims verified${contradicted ? `, ${contradicted} contradicted` : ''}${unverifiable ? `, ${unverifiable} unverifiable` : ''}`
  return { verified, contradicted, unverifiable, total, line }
}

/**
 * Every issue number the claims mention in this repository (for the fetch step).
 * @param {object[]} claims
 */
export function referencedIssues(claims) {
  return [...new Set(claims.filter(c => c.type === 'fixes' && !c.issue.repo).map(c => c.issue.number))].slice(0, 10)
}
