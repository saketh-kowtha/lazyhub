import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('child_process', () => ({ spawnSync: vi.fn() }))

import { execa } from 'execa'
import { spawnSync } from 'child_process'
import { copyToClipboard, editTextInEditor, isOpenableUrl, openUrl, runConfiguredCommand } from './platform.js'
import { createBranch, currentBranch, pushHead } from './git.js'

const savedEditor = process.env.EDITOR
beforeEach(() => { vi.clearAllMocks(); execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) })
afterEach(() => { if (savedEditor === undefined) delete process.env.EDITOR; else process.env.EDITOR = savedEditor })

describe('openUrl', () => {
  it('accepts only absolute http(s) URLs', () => {
    for (const ok of ['https://github.com/o/r', 'http://ghe.example.com/o/r/pull/1']) expect(isOpenableUrl(ok)).toBe(true)
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', '-a Calculator', '/tmp/x', '', null, undefined, 'https://x\n--help']) {
      expect(isOpenableUrl(bad), String(bad)).toBe(false)
    }
  })

  it('launches the platform opener with the URL as one argument', async () => {
    expect(await openUrl('https://github.com/o/r')).toBe(true)
    const [cmd, args] = execa.mock.calls[0]
    expect(['open', 'xdg-open', 'explorer']).toContain(cmd)
    expect(args).toEqual(['https://github.com/o/r'])
  })

  it('refuses a non-http URL without spawning anything', async () => {
    expect(await openUrl('file:///etc/passwd')).toBe(false)
    expect(execa).not.toHaveBeenCalled()
  })

  it('reports false when the opener fails', async () => {
    execa.mockRejectedValue(new Error('ENOENT'))
    expect(await openUrl('https://github.com/o/r')).toBe(false)
  })
})

describe('copyToClipboard', () => {
  it('pipes the text on stdin and reports success', async () => {
    expect(await copyToClipboard('hello')).toBe(true)
    expect(execa.mock.calls[0][2]).toEqual({ input: 'hello' })
  })

  it('falls through to the next tool and reports false when none work', async () => {
    execa.mockRejectedValue(new Error('missing'))
    expect(await copyToClipboard('x')).toBe(false)
    expect(execa.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('runConfiguredCommand', () => {
  it('runs argv without a shell and without throwing on non-zero exit', async () => {
    await runConfiguredCommand(['tool', '--json'])
    expect(execa).toHaveBeenCalledWith('tool', ['--json'], { reject: false })
  })
})

describe('editTextInEditor', () => {
  it('returns the edited text and brackets the editor with alternate-screen switches', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    process.env.EDITOR = 'my-editor --wait'
    spawnSync.mockImplementation((bin, args) => {
      expect(bin).toBe('my-editor')
      expect(args[0]).toBe('--wait')
      return { status: 0 }
    })
    const result = editTextInEditor('draft')
    expect(result.ok).toBe(true)
    expect(write).toHaveBeenCalledWith('\x1b[?1049l')
    write.mockRestore()
  })

  it('keeps the original text when the editor exits non-zero or $EDITOR is hostile', () => {
    spawnSync.mockReturnValue({ status: 1 })
    process.env.EDITOR = 'ed'
    expect(editTextInEditor('keep', { altScreen: false })).toEqual({ ok: false, text: 'keep' })
    process.env.EDITOR = 'ed\nrm -rf'
    spawnSync.mockClear()
    expect(editTextInEditor('keep')).toEqual({ ok: false, text: 'keep' })
    expect(spawnSync).not.toHaveBeenCalled()
  })
})

describe('git service', () => {
  it('runs every command in the given checkout with array args', async () => {
    execa.mockResolvedValue({ stdout: 'main\n' })
    expect(await currentBranch('/work/repo')).toBe('main')
    await createBranch('/work/repo', 'feature/x')
    await pushHead('/work/repo', 'origin')
    expect(execa.mock.calls.map(c => [c[0], c[1], c[2].cwd])).toEqual([
      ['git', ['branch', '--show-current'], '/work/repo'],
      ['git', ['checkout', '-b', 'feature/x'], '/work/repo'],
      ['git', ['push', 'origin', 'HEAD'], '/work/repo'],
    ])
  })

  it('rejects names that could be parsed as options', async () => {
    await expect(createBranch('/w', '--detach')).rejects.toThrow(/Invalid/)
    await expect(pushHead('/w', '-f')).rejects.toThrow(/Invalid/)
    expect(execa).not.toHaveBeenCalled()
  })
})
