import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { sendInput } from '../../test/input-bus.js'
import { getClaimsContext } from '../../executor.js'
import { openInEditor } from '../../editor.js'
import { ClaimsView } from './ClaimsView.jsx'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../executor.js', async () => ({ ...await vi.importActual('../../executor.js'), getClaimsContext: vi.fn() }))
vi.mock('../../editor.js', () => ({ openInEditor: vi.fn(async () => {}), editorLabel: () => 'editor' }))

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const frame = v => v.lastFrame() ?? ''

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

const ctx = {
  files: [{ path: 'src/a.js', patch: '@@ -1,1 +1,1 @@\n-export function f(a) {\n+export function f(a, b) {', patchTruncated: false }],
  filesTruncated: false, closing: [], issues: {},
}

describe('ClaimsView', () => {
  it('shows each claim with a status word, evidence and the summary, and no AI', async () => {
    getClaimsContext.mockResolvedValue(ctx)
    const pr = { number: 5, title: 'T', body: 'No breaking changes\nAdds tests\nImproves performance' }
    const view = renderWithProviders(<ClaimsView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('claims verified'))
    const f = frame(view)
    expect(f).toContain('0 of 3 claims verified, 2 contradicted, 1 unverifiable')
    expect(f).toContain('src/a.js:1')
    expect(f).toContain('No AI was used')
    expect(getClaimsContext).toHaveBeenCalledWith('o/r', 5, [])
  })

  it('opens the diff and the editor, and closes', async () => {
    getClaimsContext.mockResolvedValue(ctx)
    const onClose = vi.fn(); const onOpenDiff = vi.fn()
    const pr = { number: 5, title: 'T', body: 'No breaking changes\nAdds tests' }
    const view = renderWithProviders(<ClaimsView pr={pr} repo="o/r" onClose={onClose} onOpenDiff={onOpenDiff} />)
    await waitForExpectation(() => expect(frame(view)).toContain('claims verified'))
    await flush(20)
    sendInput('E')
    await flush(20)
    expect(openInEditor).toHaveBeenCalledWith('src/a.js', 1, expect.anything())
    sendInput('d')
    await flush(20)
    expect(onOpenDiff).toHaveBeenCalledWith(pr)
    sendInput('', { escape: true })
    await flush(20)
    expect(onClose).toHaveBeenCalled()
  })

  it('draws no control, escape or bidi character from the description', async () => {
    getClaimsContext.mockResolvedValue(ctx)
    const evil = `${ESC}]0;pwn${BEL}${ESC}[31m${String.fromCharCode(0x202e, 0x200b)}`
    const pr = { number: 5, title: `Fixes #3${evil}`, body: `No breaking changes${evil}\nOnly touches ${evil}src` }
    const view = renderWithProviders(<ClaimsView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('claims'))
    await flush(20)
    const bad = new RegExp(`[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]`)
    expect(bad.test(frame(view).replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), ''))).toBe(false)
  })

  it('does not show a summary when the read fails', async () => {
    getClaimsContext.mockRejectedValue(new Error('network down'))
    const view = renderWithProviders(<ClaimsView pr={{ number: 1, title: '', body: 'Adds tests' }} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).not.toContain('Reading the changed files'))
    expect(frame(view)).not.toContain('claims verified')
  })

  it('says so when nothing is claimed', async () => {
    getClaimsContext.mockResolvedValue(ctx)
    const view = renderWithProviders(<ClaimsView pr={{ number: 1, title: 'x', body: 'hello' }} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('No checkable claims'))
  })
})
