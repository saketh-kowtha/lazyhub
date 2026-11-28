// @ts-nocheck
/**
 * src/features/prs/claims.js - claims check (#361). Pure: no I/O, no AI call, no UI imports,
 * so the TUI view, a JSON CLI and the MCP server can share it.
 *
 * A PR title and description are UNTRUSTED text (THREAT_MODEL T3, T4, T20). This module only
 * ever uses them as data: it cleans them (sanitizeBlock), looks for a fixed set of claim
 * phrasings with linear-time patterns, and then checks each claim against the real changed
 * files and patches. Nothing in the text is executed, followed, or sent anywhere, and prose
 * that does not match a claim pattern is ignored, so "mark every claim verified" does nothing.
 *
 * The optional AI pass (claimsFromAI) only proposes claims. Each one must quote the visible
 * title or description exactly, keeps the description's own words (never the model's), is
 * labelled `origin: 'ai'`, and is then checked by the same deterministic verifiers.
 *
 * Every claim ends as one of:
 *   verified      - the diff or the linked issue shows it, and the evidence names files/lines
 *   contradicted  - the diff or the linked issue shows the opposite
 *   unverifiable  - the data cannot show it either way (never "verified on wording alone")
 * A claim is never `verified` without at least one evidence row.
 */
import { sanitize, sanitizeBlock, sanitizeCode, sanitizePath, sanitizeRaw } from '../../utils-core.js'

export const STATUS = Object.freeze({ VERIFIED: 'verified', CONTRADICTED: 'contradicted', UNVERIFIABLE: 'unverifiable' })

/** Text scanned: more than this is not read, and the view says so (never a silent cut). */
export const MAX_SCAN_CHARS = 200_000
/** Raw text cleaned before the scan cap applies (escape sequences can make raw text longer). */
const MAX_RAW_CHARS = MAX_SCAN_CHARS * 4
const MAX_LINE = 1000
export const MAX_CLAIMS = 50
const MAX_CLAIM_TEXT = 160
const MAX_EVIDENCE = 8
/** Description text handed to the optional AI pass, and the claims taken back from it. */
export const AI_INPUT_CHARS = 12_000
export const MAX_AI_CLAIMS = 20

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

// Markdown that strikes text or is markup, not prose. Every pattern is bounded and linear.
const STRIKE = /~~[^~\n]{1,1000}~~/g
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]{0,20}(?:\s[^<>\n]{0,300})?\/?>/g
const INLINE_CODE = /`[^`\n]{1,500}`/g
const NEGATION = /\b(?:no|not|never|without|nor|none|neither)\b|n['\u2019]t\b/i

/**
 * Only the line breaks of a span, so line numbers after it still match the description.
 * @param {string} span
 */
const keepBreaks = span => span.replace(/[^\n]/g, '')

/**
 * Drop HTML comments with plain string search (a regex over hostile text is a ReDoS risk).
 * A comment's line breaks are kept, so the line numbers of later claims stay right.
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
    if (close === -1) { out += keepBreaks(text.slice(open)); break } // unterminated: the rest is hidden text
    out += keepBreaks(text.slice(open, close + 3))
    i = close + 3
  }
  return out
}

/**
 * The words of a line a reader sees as prose: struck text and HTML tags removed. With `code`,
 * inline code is blanked too (GitHub does not link a closing keyword written as code);
 * without it only the backticks go.
 * @param {string} text
 * @param {boolean} code
 */
function prose(text, code) {
  const t = text.replace(STRIKE, ' ').replace(HTML_TAG, '')
  return code ? t.replace(INLINE_CODE, ' ') : t.replace(/`/g, '')
}

/**
 * A negated phrase ("adds no tests", "does not update docs", "not backwards compatible") is
 * not a claim. Looks at the last three words before the match in the same clause and, when
 * `inside`, at the match itself.
 * @param {string} text
 * @param {RegExpExecArray} m
 * @param {boolean} [inside]
 */
function negated(text, m, inside = true) {
  const clause = text.slice(0, m.index).split(/[.;:!?()[\]]|,\s/).pop() || ''
  const before = clause.trim().split(/\s+/).slice(-3).join(' ')
  return NEGATION.test(before) || (inside && NEGATION.test(m[0]))
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
    // A fence closes only with the same character, at least as long and with nothing after it
    // (CommonMark), so a ```` block cannot be ended early by a ``` line to pass code as prose.
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null
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
 * The cleaned title and description lines a reader sees as prose (code, quotes, comments and
 * unticked checkboxes left out), with a notice when the description is longer than the scan.
 * @param {{ title?: string, body?: string }} pr raw GitHub text
 * @returns {{ lines: {source:'title'|'body', line:number, text:string}[], notices: string[] }}
 */
export function visibleLines({ title = '', body = '' } = {}) {
  const notices = []
  const cleanTitle = sanitizeBlock(String(title ?? '').slice(0, MAX_LINE * 4)).split('\n')[0] || ''
  const rawBody = String(body ?? '')
  const rawCut = rawBody.length > MAX_RAW_CHARS
  let cleanBody = sanitizeBlock(rawCut ? rawBody.slice(0, MAX_RAW_CHARS) : rawBody)
  if (rawCut || cleanBody.length > MAX_SCAN_CHARS) {
    const total = rawCut ? rawBody.length : cleanBody.length
    notices.push(`The description is ${total.toLocaleString('en-US')} characters long; only the first ${MAX_SCAN_CHARS.toLocaleString('en-US')} were scanned for claims.`)
    cleanBody = cleanBody.slice(0, MAX_SCAN_CHARS)
  }
  return { lines: [...claimLines(cleanTitle, 'title'), ...claimLines(cleanBody, 'body')], notices }
}

const claimKey = c => `${c.type}:${c.key ?? ''}`

/**
 * Find the claims in a PR title and description.
 * @param {{ title?: string, body?: string }} pr raw GitHub text
 * @returns {{ claims: object[], notices: string[] }}
 *   claim: { id, type, text, source: 'title'|'body', line, origin: 'rules', key?, issue?, target?, scope? }
 */
export function extractClaims({ title = '', body = '' } = {}) {
  const { lines, notices } = visibleLines({ title, body })
  const claims = []
  const seen = new Set()
  const add = (c) => {
    const key = claimKey(c)
    if (seen.has(key)) return
    if (claims.length >= MAX_CLAIMS) { seen.add('overflow'); return }
    seen.add(key)
    claims.push({ ...c, origin: 'rules', id: `c${claims.length + 1}` })
  }
  const claimed = (patterns, line) => {
    for (const re of [].concat(patterns)) {
      const m = re.exec(line)
      if (m && !negated(line, m)) return m
    }
    return null
  }

  for (const src of lines) {
    const { text } = src
    const plain = prose(text, false)
    const base = { source: src.source, line: src.line }
    let m
    FIXES.lastIndex = 0
    const noCode = prose(text, true)
    while ((m = FIXES.exec(noCode)) !== null) {
      for (const ref of m[1].match(new RegExp(REF, 'g')) || []) {
        const hash = ref.lastIndexOf('#')
        const repo = ref.slice(0, hash)
        const number = Number(ref.slice(hash + 1))
        add({ ...base, type: 'fixes', key: `${repo}#${number}`, issue: { repo: repo || null, number }, text: excerpt(text, m.index) })
      }
    }
    if (claimed(TESTS, plain)) add({ ...base, type: 'tests', text: excerpt(text) })
    if ((m = NO_BREAKING.exec(plain)) && !negated(plain, m, false)) add({ ...base, type: 'no-breaking', text: excerpt(text) })
    // Backticks stay here: they delimit the claimed path.
    const marked = text.replace(STRIKE, ' ').replace(HTML_TAG, '')
    if ((m = ONLY_TOUCHES.exec(marked)) && !negated(marked, m, false)) {
      // A sentence's full stop is not part of the path ("Only touches src/ai.").
      const scope = m[1].startsWith('`') ? m[1].replace(/^`|`$/g, '') : m[1].replace(/[.,;:!?]+$/, '')
      add({ ...base, type: 'only-touches', key: scope.toLowerCase(), scope, text: excerpt(text, m.index) })
    }
    if (claimed(DOCS, plain)) add({ ...base, type: 'docs', text: excerpt(text) })
    if ((m = VERSION_TARGET.exec(plain)) && !negated(plain, m, false)) add({ ...base, type: 'version', key: m[1], target: m[1], text: excerpt(text, m.index) })
    else if (claimed(VERSION_BUMP, plain)) add({ ...base, type: 'version', key: '', target: null, text: excerpt(text) })
    if (claimed(PERF, plain)) add({ ...base, type: 'performance', text: excerpt(text) })
    if (claimed(SECURITY, plain)) add({ ...base, type: 'security', text: excerpt(text) })
  }
  if (seen.has('overflow')) notices.push(`More than ${MAX_CLAIMS} claims were found; only the first ${MAX_CLAIMS} are checked.`)
  return { claims, notices }
}

// ---------------------------------------------------------------------------------------------
// Optional AI pass: input text, and anchoring what comes back
// ---------------------------------------------------------------------------------------------

/**
 * The visible title and description lines for the optional AI pass, capped at AI_INPUT_CHARS.
 * Hidden text (HTML comments), code, quotes and unticked checkboxes are not sent.
 * @param {{ title?: string, body?: string }} pr raw GitHub text
 * @returns {{ text: string, notices: string[] }}
 */
export function claimsPromptText(pr = {}) {
  const { lines } = visibleLines(pr)
  const notices = []
  let text = ''
  for (const l of lines) {
    const row = `${l.source === 'title' ? 'title' : `line ${l.line}`}: ${l.text.trim()}\n`
    if (text.length + row.length > AI_INPUT_CHARS) {
      notices.push(`Only the first ${AI_INPUT_CHARS.toLocaleString('en-US')} characters of the description were given to the AI pass.`)
      break
    }
    text += row
  }
  return { text, notices }
}

const AI_KINDS = new Set(['fixes', 'tests', 'docs', 'no-breaking', 'only-touches', 'version', 'performance', 'security', 'other'])
const norm = s => sanitize(s).replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Tie one AI-proposed claim to the line it quotes. Returns null when the quote is not in the
 * visible text, or a field the kind needs (issue, path, version) is not in that line.
 * @param {object} item { kind, quote, issue?, scope?, version? } from the AI parser
 * @param {{source:string, line:number, text:string}[]} lines visibleLines().lines
 */
function anchorAIClaim(item, lines) {
  if (!item || typeof item !== 'object' || !AI_KINDS.has(item.kind) || typeof item.quote !== 'string') return null
  const quote = norm(item.quote)
  if (quote.length < 4 || quote.length > 300) return null
  if (item.kind !== 'no-breaking' && item.kind !== 'other' && NEGATION.test(quote)) return null
  const hit = lines.find(l => norm(l.text).includes(quote) || norm(prose(l.text, false)).includes(quote))
  if (!hit) return null
  const at = Math.max(0, hit.text.toLowerCase().indexOf(quote.slice(0, 20)))
  const fields = aiClaimFields(item, hit.text, quote)
  return fields && { source: hit.source, line: hit.line, text: excerpt(hit.text, at), origin: 'ai', ...fields }
}

/**
 * The type-specific fields of an anchored AI claim, or null when a field the kind needs (issue,
 * path, version) is not in the quoted line.
 * @param {object} item parsed AI proposal
 * @param {string} text the quoted line
 * @param {string} quote the normalised quote
 */
function aiClaimFields(item, text, quote) {
  const lower = text.toLowerCase()
  switch (item.kind) {
    case 'fixes': {
      const n = item.issue
      if (!Number.isInteger(n) || n < 1 || n > 999_999_999) return null
      if (!new RegExp(`#${n}(?!\\d)`).test(prose(text, true))) return null
      return { type: 'fixes', key: `#${n}`, issue: { repo: null, number: n } }
    }
    case 'only-touches': {
      const scope = typeof item.scope === 'string' ? item.scope.trim() : ''
      if (!/^[\w./@*-]{1,120}$/.test(scope) || !lower.includes(scope.toLowerCase())) return null
      return { type: 'only-touches', key: scope.toLowerCase(), scope }
    }
    case 'version': {
      const v = typeof item.version === 'string' ? item.version.replace(/^v/, '') : ''
      const target = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][\w.]{1,30})?$/.test(v) && text.includes(v) ? v : null
      return { type: 'version', key: target || '', target }
    }
    case 'other': return { type: 'other', key: quote.slice(0, 80) }
    default: return { type: item.kind }
  }
}

/**
 * Turn the AI pass's proposals into claims. Only proposals that quote the visible title or
 * description are kept; the claim text is the description's own words, never the model's.
 * @param {object[]} items parsed AI output ({ kind, quote, issue?, scope?, version? })
 * @param {{ title?: string, body?: string }} pr raw GitHub text
 * @returns {{ claims: object[], notices: string[] }}
 */
export function claimsFromAI(items, pr = {}) {
  const { lines } = visibleLines(pr)
  const list = Array.isArray(items) ? items : []
  const claims = []
  let dropped = 0
  for (const item of list.slice(0, MAX_AI_CLAIMS)) {
    const c = anchorAIClaim(item, lines)
    if (c) claims.push(c)
    else dropped++
  }
  const notices = []
  if (dropped > 0) notices.push(`${plural(dropped, 'AI-proposed claim')} did not quote the title or description and ${dropped === 1 ? 'was' : 'were'} dropped.`)
  if (list.length > MAX_AI_CLAIMS) notices.push(`The AI pass proposed ${list.length} claims; only the first ${MAX_AI_CLAIMS} were read.`)
  return { claims, notices }
}

/**
 * Rule-based claims first, then AI claims that add something new (same type and key = same
 * claim). Ids are renumbered.
 * @param {object[]} ruleClaims
 * @param {object[]} aiClaims
 */
export function mergeClaims(ruleClaims, aiClaims = []) {
  const seen = new Set(ruleClaims.map(claimKey))
  const out = [...ruleClaims]
  for (const c of aiClaims) {
    const k = claimKey(c)
    if (seen.has(k) || out.length >= MAX_CLAIMS) continue
    seen.add(k)
    out.push(c)
  }
  return out.map((c, i) => ({ ...c, id: `c${i + 1}` }))
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

/**
 * "Nothing of this kind changed" only contradicts a claim when the whole file list is known.
 * With no files, or GitHub's capped list, the missing file may simply not be listed.
 * @param {string} what e.g. "test file"
 * @param {object[]} files
 * @param {{capped: boolean}} env
 */
function absent(what, files, env) {
  if (files.length === 0) return result(STATUS.UNVERIFIABLE, 'The PR has no changed files to compare.')
  if (env.capped) return result(STATUS.UNVERIFIABLE, `No ${what} changed among the ${plural(files.length, 'file')} GitHub returned, but its file list is capped, so one may be in a file it did not list.`)
  return result(STATUS.CONTRADICTED, `No ${what} changed among ${plural(files.length, 'changed file')}.`)
}

function verifyTests(files, env) {
  const tests = files.filter(f => isTestFile(f.path))
  if (tests.length === 0) return absent('test file', files, env)
  const CASE = /^\s*(?:(?:it|test|describe)(?:\.(?:each|only|skip|concurrent))?\s*\(|def test_|func Test\w+\(|@Test\b|#\[test\])/
  const added = []
  for (const f of tests) {
    for (const l of patchLines(f.patch)) if (l.kind === '+' && CASE.test(l.text)) added.push(evidence(f.path, l.newLine, l.text.trim()))
  }
  if (added.length > 0) return result(STATUS.VERIFIED, `${plural(tests.length, 'test file')} changed; ${plural(added.length, 'test case')} added.`, added)
  return result(STATUS.UNVERIFIABLE, `${plural(tests.length, 'test file')} changed but no new test case was recognised (edited tests, an unknown framework, or a patch GitHub did not return).${env.caveats}`, fileEvidence(tests, 'test file changed'))
}

function verifyDocs(files, env) {
  const docs = files.filter(f => isDocFile(f.path))
  if (docs.length === 0) return absent('documentation file', files, env)
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

function verifyOnlyTouches(claim, files, env) {
  const inside = files.filter(f => inScope(f.path, claim.scope))
  const outside = files.filter(f => !inScope(f.path, claim.scope))
  if (inside.length === 0 && !/[/.*]/.test(claim.scope)) {
    return result(STATUS.UNVERIFIABLE, `"${sanitizePath(claim.scope)}" matches none of the ${plural(files.length, 'changed file')}, so it cannot be read as a path.${env.caveats}`)
  }
  if (outside.length > 0) {
    return result(STATUS.CONTRADICTED, `${plural(outside.length, 'changed file')} outside "${sanitizePath(claim.scope)}".`, fileEvidence(outside, 'outside the claimed scope'))
  }
  if (files.length === 0) return result(STATUS.UNVERIFIABLE, 'The PR has no changed files to compare.')
  if (env.capped) return result(STATUS.UNVERIFIABLE, `The ${plural(files.length, 'file')} GitHub returned are all under "${sanitizePath(claim.scope)}", but its file list is capped, so the rest is not known.`, fileEvidence(files, 'inside the claimed scope'))
  return result(STATUS.VERIFIED, `All ${plural(files.length, 'changed file')} are under "${sanitizePath(claim.scope)}".`, fileEvidence(files, 'inside the claimed scope'))
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
      if (key && !addedBlob.includes(key[1])) hits.push({ ...evidence(file.path, l.oldLine, l.text.trim()), why: `config key ${sanitizeRaw(key[1])} removed` })
      continue
    }
    const flag = /(?:^|[^\w-])(--[a-z][a-z0-9-]{1,40})(?![\w-])/.exec(l.text)
    if (flag && !addedBlob.includes(flag[1])) hits.push({ ...evidence(file.path, l.oldLine, l.text.trim()), why: `CLI flag ${flag[1]} removed` })
  }
  return hits
}

function verifyNoBreaking(files, env) {
  const code = files.filter(f => !isTestFile(f.path) && !isDocFile(f.path))
  if (files.length > 0 && code.length === 0) {
    if (env.capped) return result(STATUS.UNVERIFIABLE, `The ${plural(files.length, 'file')} GitHub returned are tests and documentation, but its file list is capped, so the rest is not known.`, fileEvidence(files, 'test or documentation file'))
    return result(STATUS.VERIFIED, `Only tests and documentation changed (${plural(files.length, 'file')}).`, fileEvidence(files, 'test or documentation file'))
  }
  const hits = code.flatMap(breakingInFile)
  if (hits.length > 0) {
    return result(STATUS.CONTRADICTED, `${plural(hits.length, 'removed or changed export, CLI flag or config key')}: ${hits.slice(0, 3).map(h => h.why).join('; ')}${hits.length > 3 ? '; …' : ''}.`, hits)
  }
  return result(STATUS.UNVERIFIABLE, `No removed export, CLI flag or config key was found in ${plural(code.length, 'source file')}, but that cannot prove compatibility (behaviour and types are not checked).${env.caveats}`)
}

function verifyVersion(claim, files, env) {
  const manifests = files.filter(f => MANIFEST.test(f.path))
  if (manifests.length === 0) return absent('version manifest or lockfile', files, env)
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

function verifyFixes(claim, files, ctx, env) {
  const { issue } = claim
  if (issue.repo) return result(STATUS.UNVERIFIABLE, `#${issue.number} is in ${sanitizePath(issue.repo)}, another repository; it is not checked.`)
  const row = ctx.issues?.[issue.number]
  if (row === undefined) return result(STATUS.UNVERIFIABLE, `Issue #${issue.number} could not be fetched (or is past the first 10 issues checked).`)
  if (row === null) return result(STATUS.CONTRADICTED, `Issue #${issue.number} does not exist in this repository.`)
  if (!(ctx.closing || []).includes(issue.number)) {
    return result(STATUS.UNVERIFIABLE, `Issue #${issue.number} exists but GitHub does not list it as closed by this PR (the keyword only links on the default branch).`)
  }
  const refs = [...new Set(String(row.body || '').slice(0, MAX_SCAN_CHARS).match(REFERENCED_PATH) || [])].slice(0, 200)
  if (refs.length === 0) return result(STATUS.UNVERIFIABLE, `Issue #${issue.number} is linked but names no files, so scope cannot be compared.`)
  const touched = files.filter(f => refs.some(r => f.path === r || f.path.endsWith(`/${r}`) || (!r.includes('/') && f.path.split('/').pop() === r)))
  if (touched.length > 0) return result(STATUS.VERIFIED, `Linked; the PR changes ${plural(touched.length, 'file')} the issue names.`, fileEvidence(touched, `named in issue #${issue.number}`))
  if (env.capped) return result(STATUS.UNVERIFIABLE, `Linked, but none of the ${plural(refs.length, 'file')} issue #${issue.number} names is among the files GitHub returned (its list is capped).`)
  return result(STATUS.CONTRADICTED, `Linked, but none of the ${plural(refs.length, 'file')} issue #${issue.number} names is changed.`)
}

/**
 * Verify extracted claims against the real PR data.
 * @param {object[]} claims from extractClaims() / mergeClaims()
 * @param {{ files: {path:string, patch?:string, patchTruncated?:boolean}[], closing?: number[],
 *           issues?: Record<number, {body?:string}|null>, filesTruncated?: boolean }} ctx
 */
export function verifyClaims(claims, ctx) {
  const files = Array.isArray(ctx?.files) ? ctx.files.filter(f => f && typeof f.path === 'string') : []
  const notices = []
  const cut = files.filter(f => f.patchTruncated).length
  const noPatch = files.filter(f => !f.patch && !isDocFile(f.path)).length
  if (ctx?.filesTruncated) notices.push('GitHub lists at most 3000 changed files; checks use the files it returned.')
  if (cut > 0) notices.push(`${plural(cut, 'patch')} longer than the scan limit were cut; claims about them may be unverifiable.`)
  if (noPatch > 0) notices.push(`${plural(noPatch, 'changed file')} came without patch text (binary, renamed, or too large for GitHub), so lines in them were not read.`)
  const env = { capped: Boolean(ctx?.filesTruncated), caveats: ctx?.filesTruncated ? ' (the file list is capped by GitHub)' : '' }

  const checked = (Array.isArray(claims) ? claims : []).map((claim) => {
    let r
    switch (claim.type) {
      case 'fixes': r = verifyFixes(claim, files, ctx || {}, env); break
      case 'tests': r = verifyTests(files, env); break
      case 'docs': r = verifyDocs(files, env); break
      case 'only-touches': r = verifyOnlyTouches(claim, files, env); break
      case 'no-breaking': r = verifyNoBreaking(files, env); break
      case 'version': r = verifyVersion(claim, files, env); break
      case 'performance': r = result(STATUS.UNVERIFIABLE, 'Performance claims need a measurement; wording alone is never evidence.'); break
      case 'security': r = result(STATUS.UNVERIFIABLE, 'Security claims need a review of the change; wording alone is never evidence.'); break
      case 'other': r = result(STATUS.UNVERIFIABLE, 'A free-form claim found by the AI pass; no deterministic check covers it, so it is never verified.'); break
      default: r = result(STATUS.UNVERIFIABLE, 'This kind of claim is not checked.')
    }
    // Invariant: verified always carries evidence.
    if (r.status === STATUS.VERIFIED && r.evidence.length === 0) r = result(STATUS.UNVERIFIABLE, `${r.reason} (no specific file or line could be cited)`)
    return { ...claim, ...r }
  })
  return { claims: checked, summary: summarize(checked), notices }
}

/**
 * @param {{status:string, origin?:string}[]} claims
 */
export function summarize(claims) {
  const count = s => claims.filter(c => c.status === s).length
  const verified = count(STATUS.VERIFIED)
  const contradicted = count(STATUS.CONTRADICTED)
  const unverifiable = count(STATUS.UNVERIFIABLE)
  const ai = claims.filter(c => c.origin === 'ai').length
  const total = claims.length
  const line = total === 0
    ? 'No checkable claims found in the title or description'
    : `${verified} of ${total} claims verified${contradicted ? `, ${contradicted} contradicted` : ''}${unverifiable ? `, ${unverifiable} unverifiable` : ''}${ai ? ` (${ai} AI-extracted)` : ''}`
  return { verified, contradicted, unverifiable, total, ai, line }
}

/**
 * Every issue number the claims mention in this repository (for the fetch step).
 * @param {object[]} claims
 */
export function referencedIssues(claims) {
  return [...new Set(claims.filter(c => c.type === 'fixes' && !c.issue.repo).map(c => c.issue.number))].slice(0, 10)
}

const TYPE_LABEL = {
  fixes: 'fixes', tests: 'tests', 'no-breaking': 'no breaking changes', 'only-touches': 'only touches',
  docs: 'docs', version: 'version bump', performance: 'performance', security: 'security', other: 'other claim',
}

/**
 * A short name for a claim ("fixes #12", "tests", "only touches"). Raw: clean it to draw it.
 * @param {{type:string, issue?:{repo:string|null, number:number}}} claim
 */
export function claimLabel(claim) {
  if (claim.type === 'fixes') return `fixes ${claim.issue.repo ? claim.issue.repo : ''}#${claim.issue.number}`
  return TYPE_LABEL[claim.type] || claim.type
}

/**
 * The whole check in one call: rule-based claims, optional AI proposals, verification.
 * @param {{ title?: string, body?: string }} pr raw GitHub text
 * @param {object} ctx the data verifyClaims() reads (executor getClaimsContext)
 * @param {{ ai?: object[]|null }} [opts] parsed AI proposals, when the AI pass ran
 * @returns {{ claims: object[], summary: object, notices: string[] }}
 */
export function checkClaims(pr, ctx, { ai = null } = {}) {
  const extracted = extractClaims(pr)
  const fromAI = ai ? claimsFromAI(ai, pr) : { claims: [], notices: [] }
  const checked = verifyClaims(mergeClaims(extracted.claims, fromAI.claims), ctx)
  return { ...checked, notices: [...extracted.notices, ...fromAI.notices, ...checked.notices] }
}

/**
 * A JSON-ready report of a check (for a CLI or MCP surface): plain data, every string that
 * came from GitHub or the diff cleaned for display, nothing raw.
 * @param {{ claims: object[], summary: object, notices: string[] }} checked checkClaims() output
 * @param {{ ai?: boolean }} [opts] whether the AI pass ran
 */
export function claimsReport(checked, { ai = false } = {}) {
  const claims = (checked?.claims || []).map(c => ({
    id: c.id,
    type: c.type,
    label: sanitize(claimLabel(c)),
    status: c.status,
    origin: c.origin === 'ai' ? 'ai' : 'rules',
    text: sanitize(c.text),
    source: c.source === 'title' ? 'title' : 'body',
    line: Number.isInteger(c.line) ? c.line : null,
    ...(c.type === 'fixes' ? { issue: { repo: c.issue.repo ? sanitizePath(c.issue.repo) : null, number: c.issue.number } } : {}),
    ...(c.type === 'only-touches' ? { scope: sanitizePath(c.scope) } : {}),
    ...(c.type === 'version' ? { target: c.target ? sanitizeRaw(c.target) : null } : {}),
    reason: sanitizeRaw(c.reason),
    evidence: (c.evidence || []).map(e => ({ path: sanitizePath(e.path), line: Number.isInteger(e.line) ? e.line : null, text: sanitizeCode(e.text) })),
  }))
  return {
    summary: summarize(claims),
    notices: (checked?.notices || []).map(n => sanitizeRaw(n)),
    ai: Boolean(ai),
    claims,
  }
}
