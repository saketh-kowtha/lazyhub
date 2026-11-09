import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../../test/test-helpers.jsx'
import { PRRow, PRDetailPopoverContentMemo, previewHint } from './list-row.jsx'
import { DEFAULT_CONFIG } from '../../config/schema.js'
import { resolveTheme } from '../../theme.js'

afterEach(cleanup)
const t = resolveTheme('github-dark')
const pr = {
  number: 1, title: 'safe&amp;title', state: 'OPEN',
  author: { login: 'a&amp;b' }, headRefName: 'head&amp;branch', baseRefName: 'base&amp;branch',
  labels: [{ name: 'label&amp;name' }], reviewRequests: [{ login: 'review&amp;name' }],
}

describe('PR list API text', () => {
  it('sanitizes author, branch, label and reviewer text in expanded rows', () => {
    const view = renderWithProviders(<PRRow pr={pr} isSelected={true} t={t} titleWidth={25} expanded={true} />)
    const frame = view.lastFrame()
    for (const value of ['safe&title', '@a&b', 'head&branch', 'base&branch', 'label&name', '@review&name']) expect(frame).toContain(value)
    expect(frame).not.toContain('&amp;')
  })

  it('sanitizes author and base branch in the popover', () => {
    const view = renderWithProviders(<PRDetailPopoverContentMemo pr={pr} t={t} width={52} />)
    expect(view.lastFrame()).toContain('@a&b')
    expect(view.lastFrame()).toContain('base&branch')
    expect(view.lastFrame()).not.toContain('&amp;')
  })
})

describe('PR list CI summaries', () => {
  it('keeps failure and pending counts consistent between expanded metadata and the popover', () => {
    const checkedPR = { ...pr, statusCheckRollup: [{ conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }, { conclusion: 'SUCCESS' }] }
    const row = renderWithProviders(<PRRow pr={checkedPR} isSelected={true} t={t} titleWidth={25} expanded={true} />).lastFrame()
    expect(row).toContain('✗ 1/3')
    expect(row).toMatch(/✓ 1\s+● 1\s+✗ 1\s+\/ 3/)
    const popover = renderWithProviders(<PRDetailPopoverContentMemo pr={checkedPR} t={t} width={52} />).lastFrame()
    expect(popover).toContain('✗ 1 failing')
  })

  it('preserves the compact badge status fallback for status-only failures', () => {
    const checkedPR = { ...pr, statusCheckRollup: [{ status: 'FAILURE' }] }
    const row = renderWithProviders(<PRRow pr={checkedPR} isSelected={true} t={t} titleWidth={25} expanded={true} />).lastFrame()
    expect(row).toContain('✗ 1/1')
    expect(row).toMatch(/✓ 1\s+\/ 1/)
    const popover = renderWithProviders(<PRDetailPopoverContentMemo pr={checkedPR} t={t} width={52} />).lastFrame()
    expect(popover).toContain('✓ ci-pass')
  })
})

describe('preview popover hint bar (#485)', () => {
  const withKeymap = (keymap) => ({ ...DEFAULT_CONFIG, keymaps: { 'pr-list': keymap } })

  it('is derived from the registry, not typed next to the handler', () => {
    expect(previewHint(DEFAULT_CONFIG)).toBe('↩ open · a approve · m merge · Esc hide')
    const view = renderWithProviders(<PRDetailPopoverContentMemo pr={pr} t={t} width={80} />)
    expect(view.lastFrame()).toContain('open · a approve · m merge · Esc hide')
  })

  it('follows a rebind and drops an unbound action', () => {
    expect(previewHint(withKeymap({ unbind: { a: true }, x: 'pr.approve' }))).toBe('↩ open · x approve · m merge · Esc hide')
    expect(previewHint(withKeymap({ unbind: { m: true } }))).toBe('↩ open · a approve · Esc hide')
  })
})
