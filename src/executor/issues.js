import { getRepo, runGh } from './core.js'

/**
 * List issues with optional filters.
 * @param repo
 * @param filter
 */
export async function listIssues(repo, filter = {}) {
  const base = [
    'issue', 'list',
    '--repo', getRepo(repo),
    '--limit', String(filter.limit || 50),
  ]
  if (filter.state)     base.push('--state',     filter.state)
  if (filter.author)    base.push('--author',    filter.author)
  if (filter.label)     base.push('--label',     filter.label)
  if (filter.assignee)  base.push('--assignee',  filter.assignee)
  if (filter.milestone) base.push('--milestone', filter.milestone)

  // Try with comments field; fall back without it for GHE instances where
  // the field is not available in the issue list GraphQL query.
  try {
    return await runGh([...base, '--json', 'number,title,state,author,labels,assignees,updatedAt,body,milestone,comments,url'])
  } catch (err) {
    if (!/unknown|field|not found/i.test(err.message)) throw err
    return runGh([...base, '--json', 'number,title,state,author,labels,assignees,updatedAt,body,milestone,url'])
  }
}

/**
 * Get a single issue by number.
 * @param repo
 * @param number
 */
export async function getIssue(repo, number) {
  const args = [
    'issue', 'view', String(number),
    '--repo', getRepo(repo),
    '--json', 'number,title,state,author,body,labels,assignees,updatedAt,milestone,comments,url',
  ]
  return runGh(args)
}

/**
 * Create a new issue.
 * @param repo
 * @param root0
 * @param root0.title
 * @param root0.body
 * @param root0.labels
 * @param root0.assignees
 * @param root0.milestone
 */
export async function createIssue(repo, { title, body, labels = [], assignees = [], milestone } = {}) {
  const args = [
    'issue', 'create',
    '--repo', getRepo(repo),
    '--title', title,
  ]
  args.push('--body', body || '')
  if (labels.length) args.push('--label', labels.join(','))
  if (assignees.length) args.push('--assignee', assignees.join(','))
  if (milestone) args.push('--milestone', milestone)
  return runGh(args)
}

/**
 * Close an issue.
 * @param repo
 * @param number
 */
export async function closeIssue(repo, number) {
  const args = [
    'issue', 'close', String(number),
    '--repo', getRepo(repo),
  ]
  return runGh(args)
}

// ─── Label functions ──────────────────────────────────────────────────────────

/**
 * List all labels in a repo.
 * @param repo
 */
export async function listLabels(repo) {
  const args = [
    'label', 'list',
    '--repo', getRepo(repo),
    '--json', 'name,color,description',
    '--limit', '100',
  ]
  return runGh(args)
}

/**
 * Add labels to a PR or issue.
 * @param repo
 * @param number
 * @param labels
 * @param type
 */
export async function addLabels(repo, number, labels, type = 'issue') {
  const args = [
    type === 'pr' ? 'pr' : 'issue',
    'edit', String(number),
    '--repo', getRepo(repo),
    '--add-label', labels.join(','),
  ]
  return runGh(args)
}

/**
 * Remove labels from a PR or issue.
 * @param repo
 * @param number
 * @param labels
 * @param type
 */
export async function removeLabels(repo, number, labels, type = 'issue') {
  const args = [
    type === 'pr' ? 'pr' : 'issue',
    'edit', String(number),
    '--repo', getRepo(repo),
    '--remove-label', labels.join(','),
  ]
  return runGh(args)
}

// ─── Collaborator / reviewer functions ───────────────────────────────────────

/**
 * List collaborators for a repo.
 * @param repo
 */
export async function listCollaborators(repo) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/collaborators`,
    '--jq', '[.[] | {login: .login, name: .name}]',
  ]
  return runGh(args)
}

/**
 * Add a general comment to an issue.
 * @param repo
 * @param number
 * @param body
 */
export async function addIssueComment(repo, number, body) {
  const args = [
    'issue', 'comment', String(number),
    '--repo', getRepo(repo),
    '--body', body,
  ]
  return runGh(args)
}

/**
 * Add assignees to an issue.
 * @param repo
 * @param number
 * @param assignees
 */
export async function addIssueAssignees(repo, number, assignees) {
  const args = ['issue', 'edit', String(number), '--repo', getRepo(repo), '--add-assignee', assignees.join(',')]
  return runGh(args)
}

/**
 * Remove assignees from an issue.
 * @param repo
 * @param number
 * @param assignees
 */
export async function removeIssueAssignees(repo, number, assignees) {
  const args = ['issue', 'edit', String(number), '--repo', getRepo(repo), '--remove-assignee', assignees.join(',')]
  return runGh(args)
}
