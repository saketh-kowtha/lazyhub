import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../test/test-helpers.jsx'
import { Sidebar } from './Sidebar.jsx'
import { DEFAULT_CONFIG } from '../config/schema.js'

afterEach(cleanup)

describe('Sidebar footer key hints', () => {
  it('only advertises keys that are bound in the default keymap', () => {
    const view = renderWithProviders(
      <Sidebar currentPane="focus" visiblePanes={['focus', 'prs']} paneLabels={{ focus: 'Focus', prs: 'PRs' }} paneIcons={{}} repo="acme/rocket" width={40} height={14} paneCounts={{}} />,
    )
    const hints = [...view.lastFrame().matchAll(/\b([A-Za-z?,])\s+(?:help|cfg|edit)\b/g)].map(m => m[1])
    const bound = new Set(Object.values(DEFAULT_CONFIG.actions).flatMap(a => a.keys || []))
    const dead = hints.filter(k => !bound.has(k))
    expect(dead, view.lastFrame()).toEqual([]) // "S cfg": settings is `,`, nothing binds S
  })
})
