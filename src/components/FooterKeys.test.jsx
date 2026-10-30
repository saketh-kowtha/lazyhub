import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../test/test-helpers.jsx'
import { FooterKeys, fitFooterKeys } from './FooterKeys.jsx'

afterEach(cleanup)

const KEYS = [
  { key: 'j/k', label: 'nav', group: 1 },
  { key: 'Tab', label: 'pane', group: 1 },
  { key: 'Enter', label: 'open', group: 2 },
  { key: 'd', label: 'diff', group: 2 },
  { key: 'a', label: 'approve', group: 2 },
  { key: 'm', label: 'merge', group: 2 },
  { key: 'r', label: 'refresh', group: 3 },
  { key: ',', label: 'settings', group: 3 },
  { key: '?', label: 'help' },
]

describe('fitFooterKeys', () => {
  it('keeps everything when there is room', () => {
    const { regular, help } = fitFooterKeys(KEYS, 200)
    expect(regular).toHaveLength(8)
    expect(help.key).toBe('?')
  })

  it('drops the lowest-priority (last) keys first and always keeps help', () => {
    const { regular, help } = fitFooterKeys(KEYS, 40)
    expect(regular[0].key).toBe('j/k')
    expect(regular.map(k => k.key)).not.toContain(',')
    expect(regular.length).toBeLessThan(8)
    expect(help.key).toBe('?')
  })

  it('ellipsizes a lone hint instead of overflowing', () => {
    const { regular } = fitFooterKeys([{ key: 'Enter', label: 'a very long label indeed' }], 14)
    expect(regular[0].label.endsWith('…')).toBe(true)
  })
})

describe('FooterKeys render', () => {
  for (const width of [200, 120, 80, 60, 50, 40]) {
    it(`is exactly 2 rows and fits ${width} columns`, () => {
      const view = renderWithProviders(<FooterKeys keys={KEYS} />)
      Object.defineProperty(view.stdout, 'columns', { value: width, configurable: true })
      view.rerender(<FooterKeys keys={KEYS} />)
      const lines = view.lastFrame().split('\n')
      expect(lines).toHaveLength(2)
      for (const l of lines) expect([...l].length).toBeLessThanOrEqual(width)
      expect(lines[1]).toContain('? help')
    })
  }
})
