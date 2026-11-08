import React, { useState } from 'react'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFocusEntry } from './FocusProvider.js'
import { describeFocus, focusRouter } from './router.js'
import { getContainedToast, resetContained } from '../contain.js'
import { sendInput } from '../test/input-bus.js'
import { cleanup, flush, renderWithProviders } from '../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../test/input-bus.js')).mockUseInput(React) }
})

afterEach(() => { cleanup(); resetContained(); focusRouter.disarmPrefix() })

describe('FocusProvider', () => {
  it('routes one key event to the entry that owns the active scope', async () => {
    const pane = vi.fn()
    const dialog = vi.fn()
    function Pane() { useFocusEntry('pane', pane, { scope: 'pane' }); return <Text>pane</Text> }
    function Dialog() { useFocusEntry('dialog', dialog, { scope: 'dialog', captures: true }); return <Text>dialog</Text> }
    function App() {
      const [open, setOpen] = useState(false)
      useFocusEntry('opener', (input) => { if (input === 'o') setOpen(true) }, { scope: 'pane' })
      return <><Pane />{open ? <Dialog /> : null}</>
    }
    renderWithProviders(<App />)
    await flush(5)
    await sendInput('a')
    expect(pane).toHaveBeenCalledTimes(1)
    await sendInput('o')
    await flush(5)
    await sendInput('b')
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(dialog.mock.calls[0][0]).toBe('b')
    expect(pane).toHaveBeenCalledTimes(2) // 'a' and 'o'; never 'b'
    expect(describeFocus().stack.map(e => e.id)).toContain('dialog')
  })

  it('the commit that mounts a claim already owns the scope (no one-commit lag)', async () => {
    let sawScopeAtMount = null
    function Probe() {
      useFocusEntry('probe', null, { scope: 'dialog' })
      return null
    }
    function Parent() {
      React.useLayoutEffect(() => { sawScopeAtMount = focusRouter.activeScope() }, [])
      return <Probe />
    }
    renderWithProviders(<Parent />)
    // Parent's layout effect runs after the child's claim in the same commit.
    expect(sawScopeAtMount).toBe('dialog')
  })

  it('releases the claim on unmount', async () => {
    function Probe() { useFocusEntry('probe', null, { scope: 'dialog' }); return null }
    const view = renderWithProviders(<Probe />)
    await flush(2)
    expect(focusRouter.activeScope()).toBe('dialog')
    view.unmount()
    expect(focusRouter.activeScope()).toBe('global')
  })

  it('a throwing handler becomes a toast and later keys still arrive', async () => {
    const seen = []
    function Pane() {
      useFocusEntry('pane.bug', (input) => { seen.push(input); if (input === 'x') throw new Error('bug') }, { scope: 'pane' })
      return <Text>alive</Text>
    }
    renderWithProviders(<Pane />)
    await flush(5)
    await sendInput('x')
    await sendInput('y')
    expect(seen).toEqual(['x', 'y'])
    expect(getContainedToast()).toMatch(/pane\.bug.*bug/)
  })
})
