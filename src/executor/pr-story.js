// @ts-nocheck
/**
 * src/executor/pr-story.js -- "since your last review" for the review story (#362). Read-only.
 *
 * Finds the viewer's latest submitted review of a PR and the commit it was made on, then asks
 * GitHub which files changed between that commit and the PR head. Every outcome is explicit:
 * `none` (no review by you yet), `same` (nothing changed), `files` (the changed paths) or
 * `unknown` (with the reason). A force-push that removed the reviewed commit is `unknown`; a
 * rebase that kept it reachable is `files` marked `approximate`.
 */
import { getRepo, runGh } from './core.js'
import { logSwallowed } from '../contain.js'

const OID = /^[0-9a-f]{40}$/

/** GitHub lists at most this many files in a compare response; at the cap the list may be incomplete. */
export const COMPARE_FILE_CAP = 300

/**
 * @param {string} repo
 * @param {number} number
 * @returns {Promise<{
 *   status: 'none'|'unknown'|'same'|'files',
 *   reason: string,
 *   headOid: string|null,
 *   reviewedOid: string|null,
 *   submittedAt: string|null,
 *   paths: string[],
 *   capped: boolean,
 *   approximate: boolean,
 * }>}
 */
export async function getReviewDelta(repo, number) {
  const [owner, name] = getRepo(repo).split('/')
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          headRefOid
          viewerLatestReview { state submittedAt commit { oid } }
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
  ])
  const pr = result?.data?.repository?.pullRequest
  if (!pr) throw new Error(`Pull request #${number} not found`)
  const base = { headOid: pr.headRefOid || null, reviewedOid: null, submittedAt: null, paths: [], capped: false, approximate: false }
  const review = pr.viewerLatestReview
  if (!review || review.state === 'PENDING') {
    return { ...base, status: 'none', reason: 'You have not submitted a review on this PR yet.' }
  }
  const reviewedOid = review.commit?.oid
  const info = { ...base, reviewedOid: reviewedOid || null, submittedAt: review.submittedAt || null }
  if (!OID.test(reviewedOid || '') || !OID.test(pr.headRefOid || '')) {
    return { ...info, status: 'unknown', reason: 'GitHub did not record which commit your last review was made on.' }
  }
  if (reviewedOid === pr.headRefOid) {
    return { ...info, status: 'same', reason: 'No commits since your last review.' }
  }
  let cmp
  try {
    // A page size of one keeps the commit list out of the answer; the file list is what is read.
    cmp = await runGh(['api', `repos/${getRepo(repo)}/compare/${reviewedOid}...${pr.headRefOid}?per_page=1`])
  } catch (err) {
    logSwallowed('prs.story.compare', err)
    return { ...info, status: 'unknown', reason: 'Your reviewed commit is no longer reachable (likely a force-push), so what changed since cannot be determined.' }
  }
  const files = Array.isArray(cmp?.files) ? cmp.files : null
  if (!files) return { ...info, status: 'unknown', reason: 'GitHub returned no file list for the comparison.' }
  if (cmp.status === 'behind') {
    return { ...info, status: 'unknown', reason: 'The PR head is behind your reviewed commit (history was rewritten).' }
  }
  const paths = [...new Set(files.map(f => f?.filename).filter(p => typeof p === 'string' && p))]
  for (const f of files) if (typeof f?.previous_filename === 'string' && f.previous_filename) paths.push(f.previous_filename)
  const approximate = cmp.status === 'diverged'
  return {
    ...info,
    status: 'files',
    reason: approximate
      ? 'Your reviewed commit is not an ancestor of the head (rebase or force-push): this is a file-level comparison and may include unrelated changes.'
      : 'Files changed in commits after your last review.',
    paths,
    capped: files.length >= COMPARE_FILE_CAP,
    approximate,
  }
}
