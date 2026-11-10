// View bodies of the PR list and PR detail choose what to draw from the derived render mode, never from
// `loading`, and never draw a "refreshing…" row (#597, lane V4a). A source scan, like the other lint-style tests.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = new URL('.', import.meta.url).pathname
const files = [
  'list-view.jsx', 'list-dialog-view.jsx', 'detail.jsx',
  ...readdirSync(join(dir, 'detail')).filter(f => /\.jsx$/.test(f) && !/\.test\./.test(f)).map(f => join('detail', f)),
]

describe('PR list and detail views', () => {
  for (const file of files) {
    it(`${file} has no \`loading ?\` branch and no "refreshing" row`, () => {
      const src = readFileSync(join(dir, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(src).not.toMatch(/\bloading\s*(\?|&&|\|\|)/)
      expect(src).not.toMatch(/refreshing/i)
    })
  }
})
