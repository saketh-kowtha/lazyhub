import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderWithProviders, waitForExpectation, waitForInputReady } from '../../test/test-helpers.jsx'
import { FormCompose } from './FormCompose.jsx'

afterEach(cleanup)

describe('FormCompose Enter on the last text field (#468)', () => {
  it('submits instead of doing nothing', async () => {
    const onSubmit = vi.fn()
    const view = renderWithProviders(<FormCompose title="Approve PR #1" fields={[{ name: 'body', label: 'Comment (optional)', type: 'text' }]} onSubmit={onSubmit} onCancel={() => {}} />)
    await waitForInputReady(view)
    expect(view.lastFrame()).toContain('[Enter] submit')
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onSubmit).toHaveBeenCalledWith({ body: '' }))
  })

  it('still moves to the next field before the last one', async () => {
    const onSubmit = vi.fn()
    const fields = [{ name: 'a', label: 'A', type: 'text' }, { name: 'b', label: 'B', type: 'text' }]
    const view = renderWithProviders(<FormCompose fields={fields} onSubmit={onSubmit} onCancel={() => {}} />)
    await waitForInputReady(view)
    view.stdin.write('\r')
    await waitForInputReady(view)
    expect(onSubmit).not.toHaveBeenCalled()
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  })
})
