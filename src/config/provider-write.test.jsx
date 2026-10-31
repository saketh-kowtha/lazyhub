/**
 * ConfigProvider.write never throws into its caller when the config file cannot be written (#435).
 * The writer is mocked, so nothing touches the real ~/.config/lazyhub.
 */

import React, { useContext } from 'react'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

const w = vi.hoisted(() => ({ writeConfig: vi.fn() }))
vi.mock('./writer.js', async () => {
  const actual = await vi.importActual('./writer.js')
  return { ...actual, writeConfig: w.writeConfig }
})

import { ConfigProvider, ConfigContext } from './index.js'
import { setConfigWriteNotifier } from './writer.js'
import { DEFAULT_CONFIG } from './schema.js'

let write
function Probe() {
  write = useContext(ConfigContext).write
  return <Text>ok</Text>
}

afterEach(() => setConfigWriteNotifier(null))

describe('ConfigProvider.write', () => {
  it('reports a failed write through the notifier instead of throwing', () => {
    const seen = []
    setConfigWriteNotifier(m => seen.push(m))
    w.writeConfig.mockImplementation(() => { throw new Error('not valid TOML') })
    const view = render(<ConfigProvider initialConfig={DEFAULT_CONFIG}><Probe /></ConfigProvider>)
    expect(() => write({ theme: { name: 'x' } })).not.toThrow()
    expect(seen).toEqual(['Could not save settings: not valid TOML'])
    view.unmount()
  })
})
