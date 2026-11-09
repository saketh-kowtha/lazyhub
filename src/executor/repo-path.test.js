import { afterEach, describe, expect, it } from 'vitest'
import { repoPath } from './core.js'

describe('repoPath', () => {
  const saved = process.env.GHUI_REPO
  afterEach(() => {
    if (saved === undefined) delete process.env.GHUI_REPO
    else process.env.GHUI_REPO = saved
  })

  it('keeps a plain owner/name unchanged', () => {
    expect(repoPath('octo/hello')).toBe('octo/hello')
  })

  it('keeps dots, dashes and underscores', () => {
    expect(repoPath('my-org/my.repo_name')).toBe('my-org/my.repo_name')
  })

  it('percent-encodes each segment', () => {
    expect(repoPath('o c/r?x')).toBe('o%20c/r%3Fx')
    expect(repoPath('a%2Fb/c')).toBe('a%252Fb/c')
  })

  it('falls back to GHUI_REPO', () => {
    process.env.GHUI_REPO = 'env/repo'
    expect(repoPath()).toBe('env/repo')
  })

  it('rejects a missing slash', () => {
    expect(() => repoPath('justname')).toThrow(/owner\/name/)
  })

  it('rejects extra slashes and empty segments', () => {
    expect(() => repoPath('a/b/c')).toThrow(/owner\/name/)
    expect(() => repoPath('/b')).toThrow(/owner\/name/)
    expect(() => repoPath('a/')).toThrow(/owner\/name/)
  })

  it('rejects an unset repository', () => {
    delete process.env.GHUI_REPO
    expect(() => repoPath(undefined)).toThrow(/owner\/name/)
  })
})
