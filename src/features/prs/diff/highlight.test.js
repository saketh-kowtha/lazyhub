import { describe, expect, it } from 'vitest'
import { t } from '../../../theme.js'
import { expandTabs, syntaxHighlight } from './highlight.js'

describe('diff tab expansion (#426)', () => {
  it('expands tabs to the next tab stop', () => {
    expect(expandTabs('\tfoo')).toBe('    foo')
    expect(expandTabs('ab\tc')).toBe('ab  c')
    expect(expandTabs('abcd\tc')).toBe('abcd    c')
    expect(expandTabs('a\t\tb', 2)).toBe('a   b')
    expect(expandTabs('plain')).toBe('plain')
  })

  it('counts wide characters by display width when finding the tab stop', () => {
    expect(expandTabs('中\t', 4)).toBe('中  ')
  })

  it('emits no raw TAB from syntaxHighlight, with or without a language', () => {
    expect(syntaxHighlight('\tconst x = 1', 'javascript', null, t)).not.toContain('\t')
    expect(syntaxHighlight('\tconst x = 1', null, null, t)).not.toContain('\t')
  })
})
