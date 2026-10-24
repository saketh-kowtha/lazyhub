import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { execaSync } from 'execa'
import { NewPRDialog } from './NewPRDialog.jsx'
import { useTheme, resolveTheme } from '../../theme.js'
import { createPR, getCurrentBranch, getRemoteBranch, getRepoInfo, pushBranch } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

const { titleColors } = vi.hoisted(() => ({ titleColors: [] }))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return {
    ...actual,
    useInput: (await import('../../test/input-bus.js')).mockUseInput(React),
    Text: (props) => {
      if (props.children === '⎇  New Pull Request') titleColors.push(props.color)
      return React.createElement(actual.Text, props)
    },
  }
})

vi.mock('../../executor.js', () => ({
  getCurrentBranch: vi.fn(), getRepoInfo: vi.fn(), getRemoteBranch: vi.fn(),
  getUnpushedCommits: vi.fn().mockResolvedValue([]),
  compareBranches: vi.fn().mockResolvedValue({ ahead_by: 1 }),
  pushBranch: vi.fn(), createPR: vi.fn(),
}))
vi.mock('execa', () => ({ execaSync: vi.fn() }))

describe('NewPRDialog form flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    titleColors.length = 0
    getCurrentBranch.mockResolvedValue('feature/dialog')
    getRepoInfo.mockResolvedValue({ defaultBranchRef: { name: 'main' } })
    getRemoteBranch.mockResolvedValue({ name: 'main' })
    pushBranch.mockResolvedValue(undefined)
    createPR.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('follows theme changes while the form is open', async () => {
    let changeTheme
    function Dialog() {
      changeTheme = useTheme().setTheme
      return <NewPRDialog repo="owner/repo" onClose={vi.fn()} />
    }
    renderWithProviders(<Dialog />)
    await flush()
    changeTheme('github-light')
    await waitForExpectation(() => {
      expect(titleColors.at(-1)).toBe(resolveTheme('github-light').ui.selected)
    })
  })

  it('runs the body editor with an argument array and uses its saved text', async () => {
    vi.stubEnv('EDITOR', 'test-editor --wait')
    execaSync.mockImplementation((bin, args) => {
      expect(readFileSync(args.at(-1), 'utf8')).toBe('')
      writeFileSync(args.at(-1), 'Edited body')
      return { exitCode: 0 }
    })
    const view = renderWithProviders(<NewPRDialog repo="owner/repo" onClose={vi.fn()} />)
    await flush()
    await sendInput('', { tab: true })
    await sendInput('', { tab: true })
    await sendInput('', { tab: true })
    await sendInput('e', { ctrl: true })
    expect(execaSync).toHaveBeenCalledWith('test-editor', ['--wait', expect.any(String)], { stdio: 'inherit' })
    expect(view.lastFrame()).toContain('Edited body')
  })

  it('keeps field navigation, branch suggestion, and trimmed creation payload', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()
    renderWithProviders(<NewPRDialog repo="owner/repo" onClose={onClose} onCreated={onCreated} />)
    await flush()
    await sendInput('  Review dialog  ')
    await sendInput('', { tab: true })
    await sendInput('y')
    await sendInput('', { tab: true })
    await sendInput('', { tab: true, shift: true })
    await sendInput('', { tab: true })
    await sendInput('', { tab: true })
    await sendInput('  Body text  ')
    await sendInput('g', { ctrl: true })
    expect(createPR).toHaveBeenCalledWith('owner/repo', {
      title: 'Review dialog', head: 'feature/dialog', base: 'main', body: 'Body text',
    })
    expect(onCreated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('requires push confirmation and sends Esc back to the form before closing', async () => {
    getRemoteBranch.mockImplementation(async (repo, branch) => branch === 'main' ? { name: branch } : null)
    const onClose = vi.fn()
    const view = renderWithProviders(<NewPRDialog repo="owner/repo" onClose={onClose} />)
    await flush()
    await sendInput('', { tab: true })
    await sendInput('y')
    await sendInput('p')
    expect(view.lastFrame()).toContain('Branch not on GitHub')
    expect(pushBranch).not.toHaveBeenCalled()
    await sendInput('', { escape: true })
    expect(view.lastFrame()).toContain('New Pull Request')
    expect(onClose).not.toHaveBeenCalled()
    await sendInput('p')
    await sendInput('', { return: true })
    expect(pushBranch).toHaveBeenCalledWith('feature/dialog')
    await sendInput('', { escape: true })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
