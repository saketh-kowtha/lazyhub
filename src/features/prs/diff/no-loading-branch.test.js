import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Views branch on the derived render mode, never on a `loading` flag (V1/V4b, #597): a flag
// that goes true on a revalidate is how a view with data on screen blanks itself.
const FILES = [
  'src/features/prs/diff/render.jsx',
  'src/features/prs/diff.jsx',
  'src/features/actions/RunLogDialog.jsx',
]

describe('diff and log views have no loading branch (#597)', () => {
  for (const file of FILES) {
    it(`${file} chooses its body by mode`, () => {
      const src = readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8')
      const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      const offenders = code.filter(l => /\bloading\s*(\?|&&)|\bif\s*\(\s*!?\s*\w*[lL]oading\b/.test(l))
      expect(offenders).toEqual([])
    })
  }
})
