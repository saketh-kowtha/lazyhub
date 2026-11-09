import React, { useState } from 'react'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFocusEntry, useFocusGlobals } from './FocusProvider.js'
import { useInput } from '../hooks/useSafeInput.js'
import { useKeymapInput } from '../config/keymap.js'
import { useKeyScope, isModalScope, isViewScope, liveScope } from '../keyscope.js'
import { describeFocus, focusRouter } from './router.js'
import { getContainedToast, resetContained } from '../contain.js'
import { sendInput, rootListenerCount } from '../test/input-bus.js'
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

  it('the app global handler runs once per key, after entries, and not under a dialog claim (#484)', async () => {
    const order = []
    function Root() {
      const [open, setOpen] = useState(false)
      useFocusEntry('pane', (input) => { order.push('pane:' + input); if (input === 'o') setOpen(true) }, { scope: 'pane' })
      useFocusGlobals((input) => { order.push('global:' + input + ':' + (isModalScope(liveScope()) ? 'modal' : 'free')) })
      return open ? <Dialog /> : null
    }
    function Dialog() { useKeyScope('dialog'); return null }
    renderWithProviders(<Root />)
    await flush(5)
    await sendInput('a')
    expect(order).toEqual(['pane:a', 'global:a:free'])
    await sendInput('o')
    await flush(5)
    order.length = 0
    await sendInput('b')
    // The handler still runs (the app decides), but it sees the dialog on top of the stack.
    expect(order.filter(e => e.startsWith('global:'))).toEqual(['global:b:modal'])
  })

  it('every key goes through the one root listener: panes, globals and dialogs are router entries (#485)', async () => {
    const seen = []
    function Pane() {
      useInput((input) => { seen.push('input:' + input) })
      useKeymapInput((input) => { seen.push('keymap:' + input) })
      useKeyScope('dialog')
      useFocusGlobals((input) => { seen.push('global:' + input) })
      return null
    }
    renderWithProviders(<Pane />)
    await flush(5)
    expect(rootListenerCount()).toBe(1)
    await sendInput('z')
    expect(seen).toEqual(['input:z', 'keymap:z', 'global:z'])
  })

  it('classifies scopes: overlays, dialogs and inputs are modal, views are not', () => {
    for (const s of ['overlay', 'dialog', 'input']) expect(isModalScope(s)).toBe(true)
    for (const s of ['global', 'pane', 'list', 'view', 'detail']) expect(isModalScope(s)).toBe(false)
    expect(isViewScope('view') && isViewScope('detail') && !isViewScope('pane')).toBe(true)
  })
})
