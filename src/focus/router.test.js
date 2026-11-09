// Pure router tests: no Ink, no React.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFocusRouter } from './router.js'
import { chordTokens, canonicalChord, chordSpellings, createChordTracker } from './chords.js'
import { resetContained, getContainedToast } from '../contain.js'

function setup(opts) {
  const onError = vi.fn()
  return { onError, router: createFocusRouter({ onError, ...opts }) }
}

describe('focus router: stack order', () => {
  it('defaults to the global scope', () => {
    expect(setup().router.activeScope()).toBe('global')
  })

  it('the topmost claim decides the active scope and a claim is visible immediately', () => {
    const { router } = setup()
    router.claim({ id: 'pane', scope: 'pane' })
    expect(router.activeScope()).toBe('pane')
    const release = router.claim({ id: 'dlg', scope: 'dialog' })
    expect(router.activeScope()).toBe('dialog')
    release()
    expect(router.activeScope()).toBe('pane')
  })

  it('only entries of the active scope receive the key', () => {
    const { router } = setup()
    const pane = vi.fn()
    const dialog = vi.fn()
    router.claim({ id: 'pane', scope: 'pane', handler: pane })
    router.claim({ id: 'dlg', scope: 'dialog', handler: dialog })
    router.dispatch('x', {})
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(pane).not.toHaveBeenCalled()
  })

  it('a released entry never fires, and releasing twice is harmless', () => {
    const { router } = setup()
    const h = vi.fn()
    const release = router.claim({ id: 'a', scope: 'pane', handler: h })
    release()
    release()
    router.dispatch('x', {})
    expect(h).not.toHaveBeenCalled()
  })

  it('scope-less listeners follow their own isActive gate', () => {
    const { router } = setup()
    const h = vi.fn()
    let on = false
    router.claim({ id: 'l', scope: null, handler: h, isActive: () => on })
    router.dispatch('a', {})
    on = true
    router.dispatch('b', {})
    expect(h.mock.calls.map(c => c[0])).toEqual(['b'])
  })

  it('delivers to peers at the active scope in claim order', () => {
    const { router } = setup()
    const order = []
    router.claim({ id: 'first', scope: 'view', handler: () => order.push('first') })
    router.claim({ id: 'second', scope: 'view', handler: () => order.push('second') })
    expect(router.dispatch('x', {}).delivered).toEqual(['first', 'second'])
    expect(order).toEqual(['first', 'second'])
  })

  it('notifies subscribers when the stack changes', () => {
    const { router } = setup()
    const l = vi.fn()
    const off = router.subscribe(l)
    const release = router.claim({ id: 'a', scope: 'pane' })
    release()
    expect(l).toHaveBeenCalledTimes(2)
    off()
    router.claim({ id: 'b', scope: 'pane' })
    expect(l).toHaveBeenCalledTimes(2)
  })
})

describe('focus router: captures and globals', () => {
  it('a capturing entry is the only receiver, and the globals are skipped', () => {
    const { router } = setup()
    const peer = vi.fn()
    const cap = vi.fn()
    const globals = vi.fn()
    router.setGlobals(globals)
    router.claim({ id: 'peer', scope: 'input', handler: peer })
    router.claim({ id: 'cap', scope: 'input', handler: cap, captures: true })
    const res = router.dispatch('q', {})
    expect(res).toEqual({ delivered: ['cap'], captured: true })
    expect(peer).not.toHaveBeenCalled()
    expect(globals).not.toHaveBeenCalled()
  })

  it('with several captures the most recent claim wins', () => {
    const { router } = setup()
    const a = vi.fn()
    const b = vi.fn()
    router.claim({ id: 'a', scope: 'input', handler: a, captures: true })
    router.claim({ id: 'b', scope: 'input', handler: b, captures: true })
    router.dispatch('x', {})
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it('a capture outside the active scope does not capture', () => {
    const { router } = setup()
    const globals = vi.fn()
    router.setGlobals(globals)
    router.claim({ id: 'cap', scope: 'input', handler: vi.fn(), captures: true })
    router.claim({ id: 'pane', scope: 'pane', handler: vi.fn() })
    router.dispatch('x', {})
    expect(globals).toHaveBeenCalledTimes(1)
  })

  it('globals run after the entries when nothing captured', () => {
    const { router } = setup()
    const order = []
    router.setGlobals(() => order.push('globals'))
    router.claim({ id: 'p', scope: 'pane', handler: () => order.push('pane') })
    router.dispatch('x', {})
    expect(order).toEqual(['pane', 'globals'])
  })

  it('an inactive handler-less claim still owns the scope', () => {
    const { router } = setup()
    const h = vi.fn()
    router.claim({ id: 'pane', scope: 'pane', handler: h })
    router.claim({ id: 'overlay', scope: 'overlay' })
    router.dispatch('x', {})
    expect(h).not.toHaveBeenCalled()
  })
})

describe('focus router: prefix chords', () => {
  it('arms, consumes continuations and Esc, and disarms', () => {
    const { router } = setup()
    expect(router.prefixConsumes('p', {})).toBe(false)
    router.armPrefix('g', ['p', 'i'])
    expect(router.getArmedPrefix().prefix).toBe('g')
    expect(router.prefixConsumes('p', {})).toBe(true)
    expect(router.prefixConsumes('z', {})).toBe(false)
    expect(router.prefixConsumes('', { escape: true })).toBe(true)
    router.disarmPrefix()
    expect(router.getArmedPrefix()).toBeNull()
  })

  it('skipOnPrefix entries miss the continuation; other entries still get it', () => {
    const { router } = setup()
    const view = vi.fn()
    const raw = vi.fn()
    router.claim({ id: 'view', scope: null, handler: view, skipOnPrefix: true })
    router.claim({ id: 'raw', scope: null, handler: raw })
    router.armPrefix('g', ['p'])
    router.dispatch('p', {})
    expect(view).not.toHaveBeenCalled()
    expect(raw).toHaveBeenCalledTimes(1)
    router.dispatch('x', {})
    expect(view).toHaveBeenCalledTimes(1)
  })

  it('an armed prefix expires after its ttl', () => {
    let t = 1000
    const { router } = setup({ now: () => t })
    router.armPrefix('g', ['p'], { ttlMs: 1500 })
    t += 1500
    expect(router.getArmedPrefix()).not.toBeNull()
    t += 1
    expect(router.getArmedPrefix()).toBeNull()
    expect(router.prefixConsumes('p', {})).toBe(false)
  })

  it('without a ttl the prefix stays armed until disarmed', () => {
    let t = 0
    const { router } = setup({ now: () => t })
    router.armPrefix('g', ['p'])
    t += 60_000
    expect(router.getArmedPrefix()).not.toBeNull()
  })
})

describe('focus router: handler errors', () => {
  it('a throwing handler is reported and the others still run', () => {
    const { router, onError } = setup()
    const after = vi.fn()
    const globals = vi.fn()
    router.setGlobals(globals)
    router.claim({ id: 'bad', scope: 'pane', handler: () => { throw new Error('boom') } })
    router.claim({ id: 'ok', scope: 'pane', handler: after })
    expect(() => router.dispatch('x', {})).not.toThrow()
    expect(onError).toHaveBeenCalledWith('bad', expect.objectContaining({ message: 'boom' }))
    expect(after).toHaveBeenCalledTimes(1)
    expect(globals).toHaveBeenCalledTimes(1)
  })

  it('a rejected promise is reported', async () => {
    const { router, onError } = setup()
    router.claim({ id: 'async', scope: 'pane', handler: async () => { throw new Error('late') } })
    router.dispatch('x', {})
    await new Promise(r => setTimeout(r, 0))
    expect(onError).toHaveBeenCalledWith('async', expect.objectContaining({ message: 'late' }))
  })

  it('a throwing globals handler is reported', () => {
    const { router, onError } = setup()
    router.setGlobals(() => { throw new Error('g') })
    router.dispatch('x', {})
    expect(onError).toHaveBeenCalledWith('globals', expect.any(Error))
  })

  describe('default reporting (toast + log)', () => {
    beforeEach(() => resetContained())
    afterEach(() => resetContained())

    it('raises the contained toast by default', () => {
      const router = createFocusRouter()
      router.claim({ id: 'pane.list', scope: 'pane', handler: () => { throw new Error('kaput') } })
      router.dispatch('x', {})
      expect(getContainedToast()).toContain('pane.list')
      expect(getContainedToast()).toContain('kaput')
    })
  })
})

describe('focus router: exactly one capturing owner', () => {
  it('a dialog claim on top gives each key to exactly the dialog', () => {
    const { router } = setup()
    const calls = []
    router.claim({ id: 'list', scope: 'pane', handler: () => calls.push('list') })
    router.claim({ id: 'detail', scope: 'view', handler: () => calls.push('detail') })
    router.claim({ id: 'dlg', scope: 'dialog', handler: () => calls.push('dlg'), captures: true })
    for (const k of ['a', 'b', 'c']) router.dispatch(k, {})
    expect(calls).toEqual(['dlg', 'dlg', 'dlg'])
  })
})

describe('focus router: describe', () => {
  it('reports ids, scopes and flags, never key content', () => {
    const { router } = setup()
    router.claim({ id: 'a', scope: 'pane', handler: () => {} })
    router.claim({ id: 'b', scope: 'input', captures: true })
    router.armPrefix('g', ['p'])
    expect(router.describe()).toEqual({
      activeScope: 'input',
      stack: [
        { id: 'a', scope: 'pane', captures: false, hasHandler: true },
        { id: 'b', scope: 'input', captures: true, hasHandler: false },
      ],
      armedPrefix: 'g',
    })
  })
})

describe('chord tokens (#446)', () => {
  it('joined, spaced and named spellings agree', () => {
    expect(chordTokens('gg')).toEqual(['g', 'g'])
    expect(chordTokens('g g')).toEqual(['g', 'g'])
    expect(chordTokens('g l')).toEqual(['g', 'l'])
    expect(chordTokens('gl')).toEqual(['g', 'l'])
    expect(chordTokens('<space><space>')).toEqual(['Space', 'Space'])
    expect(chordTokens('g <Esc>')).toEqual(['g', 'Esc'])
  })

  it('single keys stay single tokens', () => {
    expect(chordTokens('Enter')).toEqual(['Enter'])
    expect(chordTokens('Ctrl+R')).toEqual(['Ctrl+R'])
    expect(chordTokens('<c-r>')).toEqual(['Ctrl+R'])
    expect(chordTokens('PageUp')).toEqual(['PageUp'])
    expect(chordTokens('x')).toEqual(['x'])
    expect(chordTokens('')).toEqual([])
    expect(chordTokens(undefined)).toEqual([])
  })

  it('canonicalChord and chordSpellings give one spelling per sequence', () => {
    expect(canonicalChord('gl')).toBe('g l')
    expect(canonicalChord('g l')).toBe('g l')
    expect(chordSpellings('g', 'l')).toEqual(['g l', 'gl'])
  })
})

describe('chord timing', () => {
  it('returns the previous plain key only inside the window', () => {
    let t = 0
    const tracker = createChordTracker({ windowMs: 400, now: () => t })
    expect(tracker.feed('g', {})).toBeNull()
    t = 300
    expect(tracker.feed('l', {})).toBe('g')
    t = 1000
    expect(tracker.feed('g', {})).toBeNull()
    t = 1500
    expect(tracker.feed('l', {})).toBeNull()
  })

  it('a modified key breaks the chord and reset forgets the first key', () => {
    let t = 0
    const tracker = createChordTracker({ now: () => t })
    tracker.feed('g', {})
    t = 10
    expect(tracker.feed('l', { ctrl: true })).toBeNull()
    t = 20
    expect(tracker.feed('l', {})).toBeNull()
    t = 30
    tracker.feed('g', {})
    tracker.reset()
    t = 40
    expect(tracker.feed('l', {})).toBeNull()
  })
})

describe('focus router: yieldToModal (#485)', () => {
  const press = (router) => router.dispatch('x', {})

  it('a pane listener hears keys until an overlay, dialog or input is on top', () => {
    const router = createFocusRouter()
    const pane = vi.fn()
    router.claim({ id: 'pane', scope: null, yieldToModal: true, handler: pane })
    press(router)
    expect(pane).toHaveBeenCalledTimes(1)
    for (const scope of ['overlay', 'dialog', 'input']) {
      const release = router.claim({ id: scope, scope, handler: null })
      press(router)
      release()
    }
    expect(pane).toHaveBeenCalledTimes(1)
    press(router)
    expect(pane).toHaveBeenCalledTimes(2)
  })

  it('stays audible under pane and view scopes, and without the flag', () => {
    const router = createFocusRouter()
    const flagged = vi.fn()
    const plain = vi.fn()
    router.claim({ id: 'flagged', scope: null, yieldToModal: true, handler: flagged })
    router.claim({ id: 'plain', scope: null, handler: plain })
    router.claim({ id: 'view', scope: 'view', handler: null })
    press(router)
    router.claim({ id: 'dialog', scope: 'dialog', handler: null })
    press(router)
    expect(flagged).toHaveBeenCalledTimes(1)
    expect(plain).toHaveBeenCalledTimes(2)
  })
})
