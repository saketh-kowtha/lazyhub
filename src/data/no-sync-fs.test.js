import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// The fetch path (hooks/ and data/) must never block the input thread on the disk (#455, #481).
const SYNC_FS = /\b(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|existsSync|mkdirSync|rmSync|unlinkSync|openSync|readSync)\b/

describe('no synchronous fs on the fetch path', () => {
  for (const dir of ['src/hooks', 'src/data']) {
    it(`${dir} has no sync fs call outside tests`, () => {
      const offenders = readdirSync(dir)
        .filter(f => /\.(js|jsx)$/.test(f) && !/\.test\./.test(f))
        .filter(f => SYNC_FS.test(readFileSync(join(dir, f), 'utf8')))
      expect(offenders).toEqual([])
    })
  }
})
