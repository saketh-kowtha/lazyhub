/**
 * src/input-validation.js — shared runtime validators for untrusted
 * agent/model-supplied input (MCP adapter, AI assistant). Dependency-free so
 * the daemon can import it without pulling in UI code.
 */

const REPO_RE = /^([A-Za-z0-9.-]{1,253}\/)?[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

/** @param {unknown} v */
export const isRepoSlug = v => typeof v === 'string' && REPO_RE.test(v)

/** @param {unknown} v */
export const isPositiveId = v => Number.isSafeInteger(v) && /** @type {number} */ (v) > 0

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/
const ITEM_NUMBER_RE = /^[1-9][0-9]{0,8}$/
const SHORT_REF_RE = /^([^/#\s]+)\/([^/#\s]+)#([0-9]+)$/
const URL_PATH_RE = /^\/([^/]+)\/([^/]+)\/(pull|issues)\/([0-9]+)(?:\/(?:files|commits|checks))?\/?$/

const isName = s => NAME_RE.test(s) && !/^\.+$/.test(s)

/**
 * Strictly parse the argument of `lazyhub <reference>` (#315). Accepted forms:
 *   owner/repo#N, #N, N, https://<host>/owner/repo/(pull|issues)/N
 * Pure and offline: a URL host is never contacted, only compared against the
 * allowlist (github.com plus the caller-supplied configured hosts).
 *
 * `kind` is 'pr'/'issue' when the form names it (URLs) and null otherwise;
 * `repo` is null for #N / N (resolved from the current directory by the caller);
 * `host` is the validated URL host, null for non-URL forms.
 *
 * @param {unknown} input
 * @param {{hosts?: string[]}} [opts] configured GHES hosts accepted besides github.com
 * @returns {{ok: boolean, ref?: {repo: string|null, number: number, kind: string|null, host: string|null}, error?: string}}
 */
export function parseItemReference(input, { hosts = [] } = {}) {
  const bad = error => ({ ok: false, error })
  if (typeof input !== 'string' || input.length === 0 || input.length > 300 || /[\s\x00-\x1f\x7f]/.test(input)) return bad('not a PR or issue reference')
  const ref = (repo, number, kind, host) => ({ ok: true, ref: { repo, number: Number(number), kind, host } })

  const bare = input.startsWith('#') ? input.slice(1) : input
  if (ITEM_NUMBER_RE.test(bare)) return ref(null, bare, null, null)

  const short = SHORT_REF_RE.exec(input)
  if (short) {
    const [, owner, name, num] = short
    if (!isName(owner) || !isName(name) || !ITEM_NUMBER_RE.test(num)) return bad('not a PR or issue reference')
    return ref(`${owner}/${name}`, num, null, null)
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(input)) {
    let url
    try { url = new URL(input) } catch { return bad('not a valid URL') }
    if (url.protocol !== 'https:') return bad('only https:// URLs are accepted')
    if (url.username || url.password || url.port) return bad('URL must not contain credentials or a port')
    const host = url.hostname.toLowerCase()
    const allowed = ['github.com', ...hosts.filter(h => typeof h === 'string' && h).map(h => h.toLowerCase())]
    if (!allowed.includes(host)) return bad(`host ${host} is not github.com or your configured GitHub Enterprise host`)
    const m = URL_PATH_RE.exec(url.pathname)
    if (!m || !isName(m[1]) || !isName(m[2]) || !ITEM_NUMBER_RE.test(m[4])) return bad('URL is not a pull request or issue URL')
    return ref(`${m[1]}/${m[2]}`, m[4], m[3] === 'pull' ? 'pr' : 'issue', host)
  }
  return bad('not a PR or issue reference')
}
