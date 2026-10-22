/**
 * gh-spawn-guard.test.js — AGENTS.md invariant 1: only src/executor/core.js may
 * spawn the `gh` CLI (#288). A static scan, so a new direct spawn fails CI.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const ALLOWED = ['executor', 'core.js'].join(sep)
const DIRECT_GH_SPAWN = /\b(?:execa|execaSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*(['"`])gh\1/

/** @param {string} dir */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(?:js|jsx|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })
}

describe('gh spawn chokepoint', () => {
  it('no source file outside executor/core.js spawns gh directly', () => {
    const offenders = sourceFiles(SRC)
      .filter(file => relative(SRC, file) !== ALLOWED)
      .filter(file => DIRECT_GH_SPAWN.test(readFileSync(file, 'utf8')))
      .map(file => relative(SRC, file))
    expect(offenders).toEqual([])
  })
})
