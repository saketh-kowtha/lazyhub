// @ts-nocheck
/**
 * src/executor/collisions.js -- read-only data for the collision radar (#360).
 *
 * Two bounded calls, both through runGh():
 *  - one GraphQL page of open PRs with their changed files (paths and counts, no patch text), walked
 *    by cursor; the caller decides how many pages it will take and is told what was not fetched;
 *  - the patches of one PR, only for the paths asked for, by REST pages that are walked to the end
 *    (or to a stated ceiling, reported as `truncated`).
 */
import { getRepo, runGh } from './core.js'

const PRS_PAGE = 50
const REST_PAGE = 100
const MAX_PATCH_PAGES = 10

const PR_FIELDS = `
  number title isDraft state url baseRefName headRefName updatedAt additions deletions
  author { login }
  files(first: 100) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { path additions deletions changeType }
  }
`

function mapPR(n) {
  return {
    number: n.number,
    title: n.title || '',
    isDraft: Boolean(n.isDraft),
    state: n.state || 'OPEN',
    url: n.url || '',
    baseRefName: n.baseRefName || '',
    headRefName: n.headRefName || '',
    updatedAt: n.updatedAt || '',
    author: n.author?.login || '',
    additions: Number(n.additions) || 0,
    deletions: Number(n.deletions) || 0,
    files: (n.files?.nodes || [])
      .filter(f => f && typeof f.path === 'string' && f.path)
      .map(f => ({ path: f.path, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0, changeType: f.changeType || 'MODIFIED' })),
    filesTotal: Number(n.files?.totalCount ?? (n.files?.nodes || []).length),
    filesCursor: n.files?.pageInfo?.hasNextPage ? n.files.pageInfo.endCursor || null : null,
  }
}

/**
 * One cursor page of open PRs with up to 100 changed files each. A PR with more files has a
 * `filesCursor` to continue from (see `listPRFilesPage`) and `filesTotal` to compare against.
 * @param {string} repo
 * @param {{ after?: string|null }} [opts]
 */
export async function listOpenPRsWithFiles(repo, { after = null } = {}) {
  const [owner, name] = getRepo(repo).split('/')
  const query = `
    query($owner: String!, $name: String!, $limit: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: OPEN, first: $limit, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { ${PR_FIELDS} }
        }
      }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `limit=${PRS_PAGE}`,
    ...(after ? ['-f', `after=${after}`] : []),
  ])
  const conn = result?.data?.repository?.pullRequests
  if (!conn) throw new Error(`Could not list open pull requests for ${repo}`)
  const prs = (conn.nodes || []).filter(n => n && Number.isInteger(n.number)).map(mapPR)
  return {
    prs,
    totalCount: Number(conn.totalCount ?? prs.length),
    hasNextPage: Boolean(conn.pageInfo?.hasNextPage && conn.pageInfo.endCursor),
    endCursor: conn.pageInfo?.endCursor || null,
  }
}

/**
 * One PR by number with its first 100 changed files, for a PR that is not among the scanned page(s).
 * @param {string} repo
 * @param {number} number
 */
export async function getPRWithFiles(repo, number) {
  const [owner, name] = getRepo(repo).split('/')
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) { ${PR_FIELDS} }
      }
    }
  `
  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${Number(number)}`,
  ])
  const node = result?.data?.repository?.pullRequest
  if (!node) throw new Error(`Pull request #${number} not found`)
  return mapPR(node)
}

/**
 * The patches of the named files of one PR, plus each file's previous name when it was renamed.
 * The REST file list is walked page by page; jq keeps only the wanted files so a 3000-file PR does not
 * ship every patch. `paths` may be empty to learn only the rename sources of every file.
 * @param {string} repo
 * @param {number} number
 * @param {string[]} paths files whose patch is wanted
 * @returns {Promise<{ files: {path:string, oldPath:string|null, status:string, additions:number, deletions:number, patch:string|null}[], truncated: boolean }>}
 */
export async function getPRPatches(repo, number, paths) {
  const r = getRepo(repo)
  const wanted = JSON.stringify([...new Set(paths || [])])
  const jq = `[.[] | . as $f | {path: .filename, oldPath: .previous_filename, status: .status, additions: .additions, deletions: .deletions, patch: (if ((${wanted}) | index($f.filename)) != null or ((${wanted}) | index($f.previous_filename // "")) != null then .patch else null end)}]`
  const out = []
  let truncated = false
  for (let page = 1; page <= MAX_PATCH_PAGES; page++) {
    const rows = await runGh(['api', `repos/${r}/pulls/${Number(number)}/files?per_page=${REST_PAGE}&page=${page}`, '--jq', jq])
    const list = Array.isArray(rows) ? rows : []
    for (const f of list) {
      if (!f || typeof f.path !== 'string') continue
      out.push({
        path: f.path,
        oldPath: typeof f.oldPath === 'string' && f.oldPath ? f.oldPath : null,
        status: f.status || 'modified',
        additions: Number(f.additions) || 0,
        deletions: Number(f.deletions) || 0,
        patch: typeof f.patch === 'string' ? f.patch : null,
      })
    }
    if (list.length < REST_PAGE) return { files: out, truncated: false }
    if (page === MAX_PATCH_PAGES) truncated = true
  }
  return { files: out, truncated }
}
