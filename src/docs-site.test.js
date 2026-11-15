// @ts-nocheck
/**
 * docs-site.test.js - the GitHub Pages keybindings and config pages are generated from
 * src/config/defaultConfig.toml (scripts/gen-site.mjs) and must not drift from it.
 * Fix a failure with: node scripts/gen-site.mjs
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { build, keyModel, readDefaults, renderKeys } from '../scripts/gen-site.mjs'

describe('docs site is in sync with the shipped config', () => {
  it('keybindings.html and config.html are up to date', () => {
    for (const { file, current, next } of build()) expect(current === next, `${file} is stale: run node scripts/gen-site.mjs`).toBe(true)
  })

  it('every action appears on the keybindings page with its keys', () => {
    const defaults = readDefaults()
    const page = readFileSync(new URL('../docs/keybindings.html', import.meta.url), 'utf8')
    const listed = new Set(keyModel(defaults).flatMap(({ rows }) => rows.map(r => r.id)))
    for (const [id, action] of Object.entries(defaults.actions)) {
      expect(listed.has(id), `${id} missing from the key model`).toBe(true)
      if (action.keys?.length) expect(page, id).toContain(renderKeys(action.keys))
    }
  })

  it('the keys the site prose names are bound as described', () => {
    const a = readDefaults().actions
    expect(a['go.queue'].keys).toEqual(['g q'])
    expect(a['pr.evidence'].keys).toEqual(['e'])
    expect(a['pr.why-red'].keys).toEqual(['f'])
    expect(a['pr.claims'].keys).toEqual(['V'])
    expect(a['pr.collisions'].keys).toEqual(['K'])
    expect(a['pr.story'].keys).toEqual(['s'])
    expect(a['queue.open'].keys).toEqual(['Enter'])
  })
})
