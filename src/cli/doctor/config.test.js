/**
 * cli/doctor/config.test.js — config doctor tests.
 */

import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { checkConfig, formatConfigReport } from './config.js'

describe('checkConfig', () => {
  it('reports valid config summaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-doctor-'))
    const configPath = join(dir, 'lazyhub.toml')
    writeFileSync(configPath, '[theme]\nname = "lazyhub-dark"\n', 'utf8')

    const report = checkConfig({ configPath })

    expect(report.ok).toBe(true)
    expect(report.summary.theme).toBe('lazyhub-dark')
    expect(report.summary.actions).toBeGreaterThan(0)
  })

  it('formats JSON output for agents', () => {
    const text = formatConfigReport({
      ok: true,
      configPath: '/tmp/lazyhub.toml',
      checks: [{ ok: true, label: 'Valid TOML syntax' }],
      warnings: [],
      summary: { theme: 'lazyhub-dark', actions: 1, keyBindings: 2, tabs: 1 },
    }, { json: true })

    expect(JSON.parse(text).summary.tabs).toBe(1)
  })
})
