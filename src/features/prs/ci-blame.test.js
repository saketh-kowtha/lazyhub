import { describe, expect, it } from 'vitest'
import { matchPath, matchLocationsToFiles, locateInPatch, matchChangedLines, normalizePath } from './ci-blame.js'

const PATCH = ['@@ -5,4 +5,5 @@', ' keep', '-old', '+new line six', '+new line seven', ' tail'].join('\n')
const files = [
  { path: 'src/math.js', status: 'modified' },
  { path: 'src/win.js', status: 'modified' },
  { path: 'src/new-name.js', previousPath: 'src/old-name.js', status: 'renamed' },
  { path: 'a/index.js', status: 'modified' },
  { path: 'b/index.js', status: 'modified' },
]

describe('matchPath', () => {
  it('matches a runner absolute path on whole segments', () => {
    expect(matchPath('/home/runner/work/r/r/src/math.js', files)).toMatchObject({ file: { path: 'src/math.js' }, via: 'exact' })
  })
  it('never matches a partial file name', () => {
    expect(matchPath('/work/xsrc/math.js', files)).toBeNull()
    expect(matchPath('/work/src/amath.js', files)).toBeNull()
  })
  it('handles Windows drive paths and backslashes', () => {
    expect(normalizePath('C:\\a\\r\\src\\win.js').path).toBe('/a/r/src/win.js')
    expect(matchPath('D:/a/r/r/SRC/WIN.JS', files)).toMatchObject({ file: { path: 'src/win.js' } })
  })
  it('matches the pre-rename path and says so', () => {
    expect(matchPath('/w/src/old-name.js', files)).toMatchObject({ file: { path: 'src/new-name.js' }, via: 'rename' })
  })
  it('matches a shorter log path by suffix only with two segments, and flags it', () => {
    expect(matchPath('src/math.js', [{ path: 'pkg/src/math.js' }])).toMatchObject({ via: 'suffix' })
    expect(matchPath('math.js', [{ path: 'pkg/src/math.js' }])).toBeNull()
  })
  it('returns ambiguous rather than guessing between equal matches', () => {
    expect(matchPath('index.js', files)).toBeNull()
    expect(matchPath('src/index.js', [{ path: 'a/src/index.js' }, { path: 'b/src/index.js' }])).toEqual({ ambiguous: true })
  })
})

describe('locateInPatch', () => {
  it('finds an added line exactly', () => {
    expect(locateInPatch(PATCH, 'src/math.js', 6)).toEqual({ kind: 'changed', line: 6, text: 'new line six' })
  })
  it('reports a nearby added line as near, not as a hit', () => {
    expect(locateInPatch(PATCH, 'src/math.js', 9)).toMatchObject({ kind: 'near', line: 7 })
  })
  it('says the file changed but not the line when far away', () => {
    expect(locateInPatch(PATCH, 'src/math.js', 100)).toEqual({ kind: 'file', line: 100, text: '' })
  })
})

describe('matchChangedLines', () => {
  const patches = new Map([['src/math.js', { status: 'ok', patch: PATCH }], ['src/win.js', { status: 'omitted', patch: null }]])
  it('ranks changed lines first and reports unmatched / ambiguous counts', () => {
    const r = matchChangedLines([
      { path: '/w/src/win.js', line: 3 },
      { path: '/w/src/math.js', line: 6 },
      { path: '/w/node-only/other.js', line: 1 },
      { path: 'src/index.js', line: 1 },
    ], [...files, { path: 'x/src/index.js' }, { path: 'y/src/index.js' }], patches)
    expect(r.items.map(i => i.kind)).toEqual(['changed', 'no-patch'])
    expect(r.items[0]).toMatchObject({ path: 'src/math.js', line: 6, text: 'new line six' })
    expect(r.unmatched).toBe(1)
    expect(r.ambiguous).toBe(1)
  })
  it('returns nothing for an unmatched trace', () => {
    const r = matchLocationsToFiles([{ path: '/w/lib/else.js', line: 2 }], files)
    expect(r.matches).toEqual([])
    expect(matchChangedLines([{ path: '/w/lib/else.js', line: 2 }], files, patches).items).toEqual([])
  })
})
