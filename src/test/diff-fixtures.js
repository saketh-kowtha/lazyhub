// Turns a unified-diff text into the per-file executor results the diff pane now loads (#509),
// so a test can keep one readable diff fixture. Pure: no mocks are installed here.

/**
 * Split a unified diff into files with their patch text.
 * @param {string} text
 * @returns {{ path: string, additions: number, deletions: number, patch: string|null }[]}
 */
export function splitDiff(text) {
  return String(text || '').split(/^(?=diff --git )/m).filter(chunk => chunk.startsWith('diff --git ')).map(chunk => {
    const lines = chunk.replace(/\n$/, '').split('\n')
    const path = (lines[0].match(/ b\/(.+)$/) || [])[1] || ''
    const at = lines.findIndex(l => l.startsWith('@@'))
    const body = at < 0 ? [] : lines.slice(at)
    return {
      path,
      additions: body.filter(l => l.startsWith('+')).length,
      deletions: body.filter(l => l.startsWith('-')).length,
      patch: at < 0 ? null : body.join('\n'),
    }
  })
}

/**
 * The first (and only) page of the file list for a diff text.
 * @param {string} text
 */
export function diffFilesPage(text) {
  const files = splitDiff(text).map(({ path, additions, deletions }) => ({ path, additions, deletions, changeType: 'MODIFIED' }))
  return { files, hasNextPage: false, endCursor: null, totalCount: files.length }
}

/**
 * A getPRFilePatch implementation answering from a diff text.
 * @param {string} text
 */
export function fakeFilePatch(text) {
  const byPath = new Map(splitDiff(text).map(f => [f.path, f]))
  return async (_repo, _number, path) => {
    const f = byPath.get(path)
    if (!f) return { status: 'missing', patch: null, oldPath: null, additions: 0, deletions: 0 }
    return f.patch
      ? { status: 'ok', patch: f.patch, oldPath: null, additions: f.additions, deletions: f.deletions }
      : { status: 'empty', patch: null, oldPath: null, additions: 0, deletions: 0 }
  }
}
