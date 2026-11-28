/**
 * executor/evidence-explain.js - plain-language explanations for the review evidence rows (#175, #127).
 *
 * Every row of `evidenceRows()` gets one short `explain` sentence: what the fact means, where it
 * comes from and, where people tend to over-read it, what it does not mean. The text is fixed
 * copy written here, never GitHub data and never produced by a model, so it needs no cleaning.
 * No explanation is a verdict: nothing here says a change is safe, correct or ready.
 *
 *   explainRow(row) -> string    always a non-empty sentence (a generic one for an unlisted row)
 */

/** Keyed by `section:label`; the label of an attention or file-observation row is its code. */
const EXPLAIN = Object.freeze(/** @type {Record<string, string>} */ ({
  'Revision:head': 'The newest commit on the PR branch as GitHub reports it now, and the branch it merges into. Every fact below describes this commit.',
  'Revision:changed': 'New commits arrived after you opened this. The facts below describe the new head; what you read before was about the old one. Refreshing does not mark the new commits as read.',
  'Revision:inspected': 'The head is still the commit you first saw here. Refreshing reads the facts again; it never changes which commit you inspected.',
  'Revision:inspected:unknown': 'One of the two heads could not be read, so it cannot be told whether the PR changed. Treat it as possibly changed.',
  'Revision:read': 'How long ago these facts were read from GitHub. After a minute they are marked stale; r reads them again. An old reading is never shown as current.',

  'Attention:review_requested': 'GitHub lists you, or a team you may be in, as a requested reviewer. A team request cannot be matched to you exactly.',
  'Attention:ci_failing': 'At least one check on the head commit failed. It does not say why; the checks and their logs do.',
  'Attention:ci_pending': 'Some checks on the head commit have not finished, so the result can still change.',
  'Attention:checks_unavailable': 'The check status could not be read. That is not the same as passing.',
  'Attention:changes_requested': 'A reviewer\'s latest review asks for changes. It stays until they review again or the review is dismissed.',
  'Attention:stale_approval': 'An approval was given on an older commit. The newer commits were not part of what that reviewer approved.',
  'Attention:unresolved_threads': 'Review conversations not marked resolved. Unresolved does not mean wrong; nobody has closed the thread yet.',
  'Attention:merge_conflict': 'GitHub says the branch conflicts with its base and cannot be merged as it is.',
  'Attention:mergeability_unknown': 'GitHub has not worked out yet whether the branch merges cleanly. Not known is not mergeable.',
  'Attention:draft': 'The author marked the PR as a draft: not ready for review, by their own account.',
  'Attention:none': 'No attention rule matched the facts below. That is not a safety verdict on the change.',

  'Checks:rollup': 'The combined status of every check on the head commit. Passing checks show the checks ran green; they do not prove the change works.',
  'Checks:checks': 'The check status could not be read. Unknown is never counted as passing.',
  'Checks:required': 'Checks the base branch requires before merging, as GitHub evaluates them for this PR. A required check that never started is not listed by GitHub, so it cannot be counted here.',

  'Review:decision': 'GitHub\'s overall review state under the branch rules (for example APPROVED, CHANGES_REQUESTED or REVIEW_REQUIRED). It is GitHub\'s review, not a decision made here.',
  'Review:approvals': 'The latest review of each reviewer, counted. A stale approval was given on an earlier commit.',
  'Review:reviews': 'The reviews could not be read. Unknown is not the same as approved.',
  'Review:you': 'Your own latest review on this PR, if you left one.',
  'Review:requested of you': 'Whether GitHub asked you for a review, directly or through a team. For a team, GitHub does not say which member it means.',
  'Review:threads': 'Review conversations still open, out of all the conversations read.',

  'Merge:mergeable': 'Whether GitHub can merge the branch into its base without conflicts. It says nothing about checks or reviews.',
  'Merge:draft': 'Whether the author marked the PR as a draft.',

  'Files:changed': 'How many files changed and how many lines were added and removed, from GitHub\'s file list.',
  'Files:by path': 'Changed files grouped by what their path looks like (test, docs, ci, lockfile, manifest, source). Names only, not content.',
  'Files:note': 'The files were read at a different commit than the facts above. Refresh for one consistent reading.',
  'Files:files': 'The file list could not be read, so no file observation is made. The diff (d) may still load.',
  'Files:tests_removed': 'Test files were deleted. It may be a clean-up or a lost safety net; the diff shows which.',
  'Files:ci_workflow_changed': 'Files under .github/workflows changed. They decide what CI runs, so the checks above may test something different from before.',
  'Files:lockfile_without_manifest': 'A lockfile changed but no package manifest did: dependency versions moved without a declared change.',
  'Files:no_test_files_changed': 'Source files changed and no path looks like a test. Tests may live elsewhere; this is a pointer, not a verdict.',

  File: 'One changed file: how it changed, lines added and removed, and its path. d opens the diff.',
  'Written by the author (unverified)': 'Written by the PR author or a commenter. It is shown as text only, is not checked, and never feeds the facts above.',
  'Written by the author (unverified):actor': 'Who opened the PR, by GitHub login and account type. Whether a person or an agent wrote the change cannot be verified.',
  'Not read': 'This part could not be read from GitHub, so it is shown as unknown, never as fine. r tries again.',
}))

// Rows whose own sentence already covers the unknown case.
const UNKNOWN_ROWS = new Set(['Checks:checks', 'Review:reviews', 'Files:files', 'Revision:inspected:unknown'])
const UNKNOWN_NOTE = 'It could not be read this time; unknown is never counted as passing.'
const FALLBACK = 'A fact read from GitHub, shown as read. It is an observation, not a verdict.'

/**
 * @param {{section: string, label: string, value?: string, tone?: string, untrusted?: boolean}} row
 * @returns {string}
 */
export function explainRow(row) {
  let key = `${row.section}:${row.label}`
  if (key === 'Revision:inspected' && row.tone === 'warn') key = 'Revision:inspected:unknown'
  const base = EXPLAIN[key] || EXPLAIN[row.section] || FALLBACK
  const unknown = !row.untrusted && /^unknown\b/.test(String(row.value || ''))
  return unknown && !UNKNOWN_ROWS.has(key) ? `${base} ${UNKNOWN_NOTE}` : base
}

/** The table's keys (tests: every row the builders can emit has its own sentence). */
export const EXPLAINED_KEYS = Object.freeze(Object.keys(EXPLAIN))
