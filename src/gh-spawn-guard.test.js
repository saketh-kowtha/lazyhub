/**
 * gh-spawn-guard.test.js — AGENTS.md invariant 1: only src/executor/core.js may
 * spawn the `gh` CLI (#288). A static scan, so a new direct spawn fails CI.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const ROOTS = [SRC, fileURLToPath(new URL('../bin/', import.meta.url))]
const ALLOWED = ['executor', 'core.js'].join(sep)
// Any exec*/spawn*/fork call whose first argument is the gh binary (a bare 'gh' or a 'gh ...' command line).
const DIRECT_GH_SPAWN = /\b(?:exec\w*|spawn\w*|fork)\s*\(\s*(['"`])gh(?:\1|\s)/

/** @param {string} dir */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(?:[cm]?js|jsx|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })
}

describe('gh spawn chokepoint', () => {
  it('no source file outside executor/core.js spawns gh directly', () => {
    const offenders = ROOTS.flatMap(sourceFiles)
      .filter(file => relative(SRC, file) !== ALLOWED)
      .filter(file => DIRECT_GH_SPAWN.test(readFileSync(file, 'utf8')))
      .map(file => relative(SRC, file))
    expect(offenders).toEqual([])
  })

  it('the pattern catches the spawn shapes it guards against', () => {
    for (const code of [
      "execa('gh', args)", 'execa("gh", a)', 'execa(`gh`, a)', "execa(\n  'gh',", "execFile('gh', a)",
      "spawnSync('gh', a)", "execSync('gh api user')", "cp.spawn('gh', a)", "execaCommand('gh pr list')",
    ]) expect(DIRECT_GH_SPAWN.test(code), code).toBe(true)
    for (const code of ["execa('git', a)", "execa('ghost', a)", "runGh(['pr'])"]) {
      expect(DIRECT_GH_SPAWN.test(code), code).toBe(false)
    }
  })
})
