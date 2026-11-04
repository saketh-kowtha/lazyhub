// Palette rows show a key hint; that hint must be live in the context where the row is offered (#449).
import { describe, expect, it } from 'vitest'
import { buildActions, filterActions } from './actions.js'

const palette = () => buildActions({ onNavigate() {}, onTheme() {}, onClose() {}, onQuit() {}, themes: [] })
const keysIn = (context, label) => filterActions(palette(), label, context, 20).find(a => a.label === label)?.keys

describe('palette key hints', () => {
  it('PR-list-only keys are not shown in PR detail', () => {
    expect(keysIn('pr-list', 'Checkout PR Branch')).toEqual(['b'])
    expect(keysIn('pr-detail', 'Checkout PR Branch')).toEqual([])
    expect(keysIn('pr-list', 'Copy PR URL')).toEqual(['y'])
    expect(keysIn('pr-detail', 'Copy PR URL')).toEqual([])
  })

  it('keys that are bound in both contexts stay visible in both', () => {
    expect(keysIn('pr-detail', 'Approve PR')).toEqual(['a'])
    expect(keysIn('pr-list', 'Approve PR')).toEqual(['a'])
  })
})
