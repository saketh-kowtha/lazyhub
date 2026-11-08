// @ts-nocheck
/**
 * src/executor/claims.js - the read-only data behind the claims check (#361).
 *
 * Three reads, all through runGh(): the PR's closing-issue links, every changed file with its
 * (length-capped) patch, and the issues the description says it fixes. Nothing is written and
 * nothing here sees the PR description; the claims module owns that untrusted text.
 */
import { getRepo, runGh } from './core.js'

/** GitHub lists at most 3000 files of a PR; the REST file list is paged to the end. */
export const CLAIMS_FILE_LIMIT = 3000
/** A patch longer than this is cut and flagged `patchTruncated` (never silently). */
export const CLAIMS_PATCH_CHARS = 20_000

const PATCH_JQ = `.[] | {path: .filename, status: .status, additions: .additions, deletions: .deletions, patch: ((.patch // "")[0:${CLAIMS_PATCH_CHARS}]), patchTruncated: ((.patch // "") | length > ${CLAIMS_PATCH_CHARS})}`

function parseLines(text) {
  const rows = []
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* a malformed line is skipped; the count below shows the difference */ }
  }
  return rows
}

/**
 * Every changed file of a PR with its patch text, paged to the end.
 * @param {string} repo
 * @param {number} number
 * @returns {Promise<{ files: {path:string,status:string,additions:number,deletions:number,patch:string,patchTruncated:boolean}[], truncated: boolean }>}
 */
export async function listPRFilesWithPatches(repo, number) {
  const r = getRepo(repo)
  const text = await runGh(['api', `repos/${r}/pulls/${Number(number)}/files?per_page=100`, '--paginate', '--jq', PATCH_JQ], { json: false })
  const files = parseLines(text)
    .filter(f => f && typeof f.path === 'string' && f.path)
    .map(f => ({ path: f.path, status: String(f.status || ''), additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0, patch: typeof f.patch === 'string' ? f.patch : '', patchTruncated: Boolean(f.patchTruncated) }))
  return { files, truncated: files.length >= CLAIMS_FILE_LIMIT }
}

/**
 * Issue numbers GitHub itself links as closed by this PR.
 * @param {string} repo
 * @param {number} number
 * @returns {Promise<number[]>}
 */
export async function getClosingIssueNumbers(repo, number) {
  const pr = await runGh(['pr', 'view', String(Number(number)), '--repo', getRepo(repo), '--json', 'closingIssuesReferences'])
  return (pr?.closingIssuesReferences || []).map(i => Number(i?.number)).filter(Number.isInteger)
}

/**
 * Look up the issues a description claims to fix. A number that is not an issue maps to null
 * (contradicts the claim); a lookup that failed for any other reason is left out (unverifiable).
 * @param {string} repo
 * @param {number[]} numbers
 * @returns {Promise<Record<number, {number:number,state:string,body:string}|null>>}
 */
export async function getIssuesForClaims(repo, numbers) {
  const out = {}
  const r = getRepo(repo)
  for (const n of numbers) {
    try {
      const issue = await runGh(['issue', 'view', String(Number(n)), '--repo', r, '--json', 'number,state,body'])
      out[n] = issue ? { number: Number(issue.number), state: String(issue.state || ''), body: String(issue.body || '') } : null
    } catch (err) {
      if (/could not resolve|not found|404/i.test(String(err?.message || err?.stderr || ''))) out[n] = null
    }
  }
  return out
}

/**
 * Everything the claims verifier needs about a PR, read-only. The three reads run together.
 * @param {string} repo
 * @param {number} number
 * @param {number[]} [issueNumbers] issues the description says it fixes
 * @returns {Promise<{ files: object[], filesTruncated: boolean, closing: number[], issues: Record<number, object|null> }>}
 */
export async function getClaimsContext(repo, number, issueNumbers = []) {
  const [filesResult, closing, issues] = await Promise.all([
    listPRFilesWithPatches(repo, number),
    getClosingIssueNumbers(repo, number),
    getIssuesForClaims(repo, issueNumbers),
  ])
  return { files: filesResult.files, filesTruncated: filesResult.truncated, closing, issues }
}
