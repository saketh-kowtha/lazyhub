/**
 * src/html/url.js - link and image source policy. Pure: no network access, ever.
 *
 * Allowed schemes: https, http, mailto. Everything else, and any value holding whitespace, control
 * or spoof characters inside, is rejected. The display form always shows the real host
 * (punycode for international names) and never the userinfo.
 */
import { LIMITS } from './types.js'
import { decodeEntitiesOnce } from './entities.js'
import { hasSpoofChars } from './spoof.js'

const ALLOWED = new Set(['https:', 'http:', 'mailto:'])

/** The base that relative references resolve against: the configured GitHub host. */
export function defaultBase() {
  const host = String(process.env.GH_HOST || 'github.com').trim() || 'github.com'
  try {
    return new URL(`https://${host}/`).href
  } catch {
    return 'https://github.com/'
  }
}

function hasForbiddenChar(v) {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f)) return true
  }
  return false
}

function isAsciiSpace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12
}

function trimAscii(v) {
  let a = 0
  let b = v.length
  while (a < b && isAsciiSpace(v.charCodeAt(a))) a++
  while (b > a && isAsciiSpace(v.charCodeAt(b - 1))) b--
  return v.slice(a, b)
}

function clip(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s
}

/**
 * @param {unknown} rawValue attribute value, undecoded
 * @param {{base?: string}} [opts]
 * @returns {{ok: false} | {ok: true, href: string, scheme: string, host: string, display: string, credentials: boolean}}
 */
export function resolveUrl(rawValue, opts = {}) {
  if (typeof rawValue !== 'string' || rawValue.length >= LIMITS.MAX_ATTR_LEN) return { ok: false }
  const value = trimAscii(decodeEntitiesOnce(rawValue))
  if (!value || hasForbiddenChar(value) || hasSpoofChars(value)) return { ok: false }
  let u
  try {
    u = new URL(value, opts.base || defaultBase())
  } catch {
    return { ok: false }
  }
  if (!ALLOWED.has(u.protocol)) return { ok: false }
  if (u.protocol === 'mailto:') {
    const target = clip(`mailto:${u.pathname}`, LIMITS.URL_PATH_COLS + 7)
    return { ok: true, href: u.href, scheme: 'mailto', host: target, display: target, credentials: false }
  }
  if (!u.hostname) return { ok: false }
  const prefix = u.protocol === 'http:' ? 'http://' : ''
  const host = `${prefix}${u.port ? `${u.hostname}:${u.port}` : u.hostname}`
  const path = (u.pathname === '/' ? '' : u.pathname) + u.search
  return {
    ok: true,
    href: u.href,
    scheme: u.protocol.slice(0, -1),
    host,
    display: host + clip(path, LIMITS.URL_PATH_COLS),
    credentials: u.username !== '' || u.password !== '',
  }
}
