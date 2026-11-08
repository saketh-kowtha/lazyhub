/**
 * executor/approval-context.js - typed, read-only pull-request context for the
 * approval record (docs/design/optional-approval.md 4.6).
 *
 * One GraphQL read through runGh() returns the facts an approval binds
 * (repository, pull request, base and head, approver account). Nothing here
 * writes to GitHub, and nothing defaults to a safe value: a missing field
 * throws ERR_APPROVAL_INVALID_INPUT naming it. The daemon is bypassed so the
 * facts are never served from a cache.
 *
 * Groundwork: exported through the executor barrel but imported by no runtime
 * surface; src/approval/isolation.test.js enforces that.
 */

import { runGh } from './core.js'
import { approvalError } from '../approval/errors.js'

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/

const QUERY = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      id
      nameWithOwner
      pullRequest(number: $number) {
        id
        number
        state
        isDraft
        isCrossRepository
        baseRefName
        baseRefOid
        headRefName
        headRefOid
        headRepository { id }
        autoMergeRequest { enabledAt }
      }
    }
    viewer { login id }
  }
`

const missing = (/** @type {any} */ field) => approvalError('ERR_APPROVAL_INVALID_INPUT', [field])
const str = (/** @type {any} */ value, /** @type {any} */ field) => {
  if (typeof value !== 'string' || value === '') throw missing(field)
  return value
}
const bool = (/** @type {any} */ value, /** @type {any} */ field) => {
  if (typeof value !== 'boolean') throw missing(field)
  return value
}

/**
 * Read the facts an approval binds, fresh from GitHub.
 *
 * @param {object} args
 * @param {string} args.repo `owner/name`
 * @param {number} args.number pull request number
 * @param {() => Date} [args.now] injected clock for `fetched_at`
 * @returns {Promise<{host:string, repo_node_id:string, name_with_owner:string, pr_node_id:string, number:number, state:string, is_draft:boolean, is_cross_repository:boolean, base_ref:string, base_sha:string, head_ref:string, head_sha:string, head_repo_node_id:string, auto_merge_enabled:boolean, approver:{host:string, login:string, node_id:string}, fetched_at:string}>}
 */
export async function readApprovalContext({ repo, number, now = () => new Date() }) {
  const [owner, name, extra] = typeof repo === 'string' ? repo.split('/') : []
  if (extra !== undefined || !OWNER_RE.test(owner || '') || !NAME_RE.test(name || '')) throw missing('repo')
  if (!Number.isSafeInteger(number) || number <= 0) throw missing('number')
  const host = (process.env.GH_HOST || 'github.com').toLowerCase()
  if (!HOST_RE.test(host)) throw missing('host')

  const result = await runGh([
    'api', 'graphql',
    '-f', `query=${QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `name=${name}`,
    '-F', `number=${number}`,
  ], { skipDaemon: true })

  const data = result?.data
  const repository = data?.repository
  if (!repository || typeof repository !== 'object') throw missing('repository')
  const pr = repository.pullRequest
  if (!pr || typeof pr !== 'object') throw missing('pr')
  const viewer = data.viewer
  if (!viewer || typeof viewer !== 'object') throw missing('viewer')
  if (pr.autoMergeRequest === undefined) throw missing('auto_merge_enabled')
  if (!pr.headRepository || typeof pr.headRepository !== 'object') throw missing('head_repo_node_id')
  if (!Number.isSafeInteger(pr.number) || pr.number <= 0) throw missing('number')

  return {
    host,
    repo_node_id: str(repository.id, 'repo_node_id'),
    name_with_owner: str(repository.nameWithOwner, 'name_with_owner'),
    pr_node_id: str(pr.id, 'pr_node_id'),
    number: pr.number,
    state: str(pr.state, 'state'),
    is_draft: bool(pr.isDraft, 'is_draft'),
    is_cross_repository: bool(pr.isCrossRepository, 'is_cross_repository'),
    base_ref: str(pr.baseRefName, 'base_ref'),
    base_sha: str(pr.baseRefOid, 'base_sha'),
    head_ref: str(pr.headRefName, 'head_ref'),
    head_sha: str(pr.headRefOid, 'head_sha'),
    head_repo_node_id: str(pr.headRepository.id, 'head_repo_node_id'),
    auto_merge_enabled: pr.autoMergeRequest !== null,
    approver: { host, login: str(viewer.login, 'approver.login'), node_id: str(viewer.id, 'approver.node_id') },
    fetched_at: now().toISOString(),
  }
}
