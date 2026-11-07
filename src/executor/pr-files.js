// @ts-nocheck
/**
 * src/executor/pr-files.js — per-file PR diffs (#509).
 *
 * A large PR is never downloaded as one diff. The changed-file list comes first, by cursor
 * and without any patch text; a file's patch is fetched only when it is about to be viewed.
 */
import { getRepo, runGh } from './core.js'

const FILES_PAGE = 100

/**
 * One cursor page of a PR's changed files (paths and counts only, no patch text).
 * @param {string} repo
 * @param {number} number
 * @param {{ after?: string|null, limit?: number }} [opts]
 * @returns {Promise<{ files: {path:string, additions:number, deletions:number, changeType:string}[], hasNextPage: boolean, endCursor: string|null, totalCount: number }>}
 */
export async function listPRFilesPage(repo, number, { after = null, limit = FILES_PAGE } = {}) {
  const [owner, name] = getRepo(repo).split('/')
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $limit: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          files(first: $limit, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { path additions deletions changeType }
          }
        }
      }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${Number(number)}`,
    '-F', `limit=${Math.max(1, Math.min(Number(limit) || FILES_PAGE, FILES_PAGE))}`,
    ...(after ? ['-f', `after=${after}`] : []),
  ])
  const pr = result?.data?.repository?.pullRequest
  if (!pr) throw new Error(`Pull request #${number} not found`)
  const conn = pr.files || {}
  const files = (conn.nodes || [])
    .filter(n => n && typeof n.path === 'string' && n.path)
    .map(n => ({ path: n.path, additions: Number(n.additions) || 0, deletions: Number(n.deletions) || 0, changeType: n.changeType || 'MODIFIED' }))
  return {
    files,
    hasNextPage: Boolean(conn.pageInfo?.hasNextPage && conn.pageInfo.endCursor),
    endCursor: conn.pageInfo?.endCursor || null,
    totalCount: Number(conn.totalCount ?? files.length),
  }
}

/**
 * Normalise the REST file object `select`ed by path.
 * @param {string} text jq output (empty when the file was not on the page)
 */
function parseFileObject(text) {
  const line = String(text || '').split('\n').find(l => l.trim())
  if (!line) return null
  try { return JSON.parse(line) } catch { return null }
}

/**
 * The patch of one changed file.
 *
 * `indexHint` is the file's position in the list; the REST file list is read at the page that
 * position falls on (one page, the matching file kept by path), and only if the file is not
 * there are all pages scanned. status: ok | omitted (GitHub does not render a patch for it) |
 * empty (nothing textual changed: binary, mode change, pure rename) | missing.
 *
 * @param {string} repo
 * @param {number} number
 * @param {string} path
 * @param {{ indexHint?: number }} [opts]
 * @returns {Promise<{ status: 'ok'|'omitted'|'empty'|'missing', patch: string|null, oldPath: string|null, additions: number, deletions: number }>}
 */
export async function getPRFilePatch(repo, number, path, { indexHint = null } = {}) {
  const r = getRepo(repo)
  const base = `repos/${r}/pulls/${Number(number)}/files`
  const jq = `.[] | select(.filename == ${JSON.stringify(path)})`
  let file = null
  if (Number.isInteger(indexHint) && indexHint >= 0) {
    const page = Math.floor(indexHint / FILES_PAGE) + 1
    file = parseFileObject(await runGh(['api', `${base}?per_page=${FILES_PAGE}&page=${page}`, '--jq', jq], { json: false }))
  }
  if (!file) file = parseFileObject(await runGh(['api', `${base}?per_page=${FILES_PAGE}`, '--paginate', '--jq', jq], { json: false }))
  if (!file) return { status: 'missing', patch: null, oldPath: null, additions: 0, deletions: 0 }
  const additions = Number(file.additions) || 0
  const deletions = Number(file.deletions) || 0
  const oldPath = typeof file.previous_filename === 'string' && file.previous_filename ? file.previous_filename : null
  if (typeof file.patch === 'string' && file.patch) return { status: 'ok', patch: file.patch, oldPath, additions, deletions }
  return { status: additions + deletions > 0 ? 'omitted' : 'empty', patch: null, oldPath, additions, deletions }
}
