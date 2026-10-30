// Palette rows show a key hint; that hint must be live in the context where the row is offered.
import { describe, expect, it } from 'vitest'
import { buildActions } from './ui/actions.js'
import { getActionConfig } from './config/actions.js'
import { actionScopeMatches } from './config/keymap.js'

const REG = { 'global.help': 'app.help', 'global.refresh': 'list.refresh', 'global.quit': 'app.back', 'pr.open-diff': 'pr.diff', 'pr.scope.cycle': 'pr.scope-cycle' }
const SCOPE = { 'pr-list': 'pr-list', 'pr-detail': 'pr-detail' }

describe('palette key hints', () => {
  it('AUDIT FAIL: every key hint the palette shows for pr-list / pr-detail is bound in that scope', () => {
    const cfg = getActionConfig()
    const bad = []
    for (const a of buildActions({ onNavigate() {}, onTheme() {}, onClose() {}, onQuit() {}, themes: [] })) {
      if (!a.keys.length) continue
      const reg = cfg.actions[REG[a.id] || a.id]
      for (const c of [].concat(a.context)) {
        if (SCOPE[c] && !(reg && actionScopeMatches(reg.scope, SCOPE[c]))) bad.push(`${a.label} [${a.keys}] in ${c}`)
      }
    }
    expect(bad).toEqual([])
  })
})
