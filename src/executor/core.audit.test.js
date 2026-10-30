import { afterEach, describe, expect, it } from 'vitest'
import { runGh } from './core.js'
import { classifyGhFailure } from './classify.js'

const savedPath = process.env.PATH
afterEach(() => { process.env.PATH = savedPath })

describe('runGh spawn failure (audit)', () => {
  it('a missing gh binary is classified as gh_missing, not unknown', async () => {
    process.env.PATH = '/nonexistent-dir-for-audit'
    let err
    try { await runGh(['pr', 'list', '--repo', 'a/b']) } catch (e) { err = e }
    expect(err).toBeDefined()
    expect(classifyGhFailure(err).kind).toBe('gh_missing')
  })

  it('a missing gh binary keeps the spawn error text and a numeric exit code', async () => {
    process.env.PATH = '/nonexistent-dir-for-audit'
    let err
    try { await runGh(['pr', 'list', '--repo', 'a/b']) } catch (e) { err = e }
    expect(`${err.message} ${err.stderr}`).toMatch(/ENOENT/)
    expect(Number.isInteger(err.exitCode)).toBe(true)
  })
})
