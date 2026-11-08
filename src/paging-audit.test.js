/**
 * paging-audit.test.js -- static completeness gate (#510, R14).
 *
 * "Never miss anything": a fixed size in a gh call (`first: N`, `--limit`, `per_page`) is a place
 * where results can be cut off. Every such site must either page (or be a nested connection that
 * is only a preview), or tell the user that GitHub capped the answer. This test pins the sites that
 * exist today per file, so adding one is a conscious change here, with the reason, not a surprise.
 *
 * When this fails: if your new call pages or shows a "N of M" / cap notice, raise the count below
 * and say how it is covered. If it does neither, fix the call.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// file -> [count, how every site is covered]
const COVERED = {
  'src/bootstrap.js': [1, 'repo picker preview (20 most recent); the full list is the repo switcher, which pages'],
  'src/features/onboarding/flow.js': [1, 'repo list for onboarding, one page of 100 sorted by push date, search covers the rest'],
  'src/cli/watch-only.js': [3, 'user-chosen --limit with --max-pages; truncation reported as *_truncated in the report'],
  'src/cli/doctor/coverage.js': [1, 'ruleset names for the coverage report; count is shown, not a list that can hide rows'],
  'src/daemon/protocol.js': [3, 'daemon passes the caller\'s own limit through to gh'],
  'src/executor/pr-comments.js': [2, 'first: 50 with after: cursors; hasNextPage drives load-more'],
  'src/executor/branches.js': [3, 'branches page by page up to a ceiling with a truncated flag; open-PR walk by cursor; --limit 1 is a lookup'],
  'src/executor/activity.js': [10, 'nested preview connections of one PR; the totals come from totalCount / pageInfo'],
  'src/executor/actions.js': [2, 'runs list shows the newest 30 (workflow runs are a feed); check pages walk to the end'],
  'src/executor/issues.js': [5, 'issue pages by cursor with N of M; collaborators page to a ceiling with a truncated flag; nested label/assignee previews'],
  'src/executor/notifications.js': [1, 'pages to a ceiling and reports truncated / partialError'],
  'src/executor/collisions.js': [2, 'files(first: 100) is the first page of a PR\'s files: filesTotal/filesCursor drive extra pages and the view lists every PR whose list is still incomplete; REST per_page=100 is walked page by page to a ceiling with a truncated flag (open PRs themselves page by cursor via $limit, capped with a visible "not scanned" count)'],
  'src/executor/claims.js': [1, 'claims check: the REST file list is read with --paginate to the end; GitHub caps a PR at 3000 files and the view says so'],
  'src/executor/pr-files.js': [2, 'per-file patch lookup: the page a file is on, else --paginate to the end; the file list itself walks after: cursors'],
  'src/executor/ci-why.js': [3, 'PR file paths walk pages up to a ceiling and report truncated, which the view shows; base-branch history is a bounded sample (N commits, shown as N of N) and flags partial'],
  'src/executor/pr-story.js': [1, 'compare call for "since your last review": per_page=1 only trims the commit list; the file list is GitHub\'s own (capped at 300) and `capped` is reported to the user'],
  'src/executor/prs.js': [8, 'PR list pages by cursor; nested label/reviewer/context previews have totalCount or pageInfo'],
  'src/watch-only/report.js': [1, 'message text only'],
}

const SITE = /first: ?\d+|--limit|per_page/g

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.|\.audit\.|fixtures?\.|\/test\//.test(path)) out.push(path)
  }
  return out
}

describe('fixed-size gh calls are pinned (#510)', () => {
  const counts = {}
  for (const file of sourceFiles('src')) {
    const n = (readFileSync(file, 'utf8').match(SITE) || []).length
    if (n > 0) counts[file] = n
  }

  it('has no fixed-size call outside the audited files', () => {
    const unknown = Object.keys(counts).filter(file => !COVERED[file])
    expect(unknown, 'new first:/--limit/per_page site: page it or show a cap notice, then list it in COVERED').toEqual([])
  })

  for (const [file, [count, how]] of Object.entries(COVERED)) {
    it(`${file} keeps ${count} audited site(s)`, () => {
      expect(counts[file] || 0, `${file}: ${how}`).toBe(count)
    })
  }
})
