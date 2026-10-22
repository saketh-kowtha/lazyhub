import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'path'

const execa = vi.hoisted(() => vi.fn(() => ({ unref: () => {} })))
vi.mock('execa', () => ({ execa }))

import { openInEditor } from './editor.js'

beforeEach(() => { execa.mockClear() })

describe('openInEditor argv', () => {
  it('keeps a path containing spaces as one custom_command argument', async () => {
    await openInEditor('/tmp/my dir/a b.js', 7, { command: 'custom', customCommand: 'myed --at {line} {file}' })
    expect(execa.mock.calls[0].slice(0, 2)).toEqual(['myed', ['--at', '7', '/tmp/my dir/a b.js']])
  })

  it('passes a leading "-" or "+" path as an absolute path', async () => {
    for (const f of ['-evil.js', '+cmd.js']) {
      execa.mockClear()
      await openInEditor(f, 3, { command: 'vim' })
      expect(execa.mock.calls[0][1]).toEqual(['+3', resolve(f)])
    }
  })

  it('applies the same protection to the $EDITOR branch', async () => {
    process.env.VISUAL = 'myvi -n'
    await openInEditor('+cmd', 2, { command: '_raw' })
    delete process.env.VISUAL
    expect(execa.mock.calls[0].slice(0, 2)).toEqual(['myvi', ['-n', '+2', resolve('+cmd')]])
  })

  it('keeps profile argv shape unchanged', async () => {
    await openInEditor('/a/b.js', 9, { command: 'vscode' })
    expect(execa.mock.calls[0].slice(0, 2)).toEqual(['code', ['--goto', '/a/b.js:9']])
  })
})
