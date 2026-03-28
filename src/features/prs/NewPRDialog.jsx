/**
 * src/features/prs/NewPRDialog.jsx — Smart New PR creation dialog.
 *
 * Features:
 *  - Auto-detects current branch and offers to use it as head
 *  - Validates head branch against remote (not pushed / has unpushed commits / no diff)
 *  - Validates base branch exists on GitHub
 *  - Offers to push branch to origin if needed
 *  - Shift+Tab for backward field navigation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getRemoteBranch, compareBranches, getUnpushedCommits,
  getCurrentBranch, pushBranch, getRepoInfo, createPR,
} from '../../executor.js'
import { t } from '../../theme.js'

const FIELDS = ['title', 'head', 'base', 'body']

// ─── Screen components ────────────────────────────────────────────────────────

function PushRequiredScreen({ branch, onPush, onBack }) {
  useInput((input, key) => {
    if (key.escape || input === 'n') { onBack(); return }
    if (input === 'p' || input === 'y' || key.return) { onPush(); return }
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ci.fail}
      paddingX={2} paddingY={1}>
      <Box marginBottom={1} gap={1}>
        <Text color={t.ci.fail} bold>⚠ Branch not on GitHub</Text>
      </Box>
      <Text color={t.ui.muted}>
        <Text color={t.ui.selected}>'{branch}'</Text> has not been pushed to origin.
      </Text>
      <Text color={t.ui.muted}>You cannot create a PR until the branch exists on GitHub.</Text>
      <Box marginTop={1} gap={3}>
        <Text color={t.ui.selected}>[p / Enter] Push to origin now</Text>
        <Text color={t.ui.dim}>[n / Esc] Back</Text>
      </Box>
    </Box>
  )
}

function UnpushedCommitsScreen({ branch, commits, onPush, onSkip, onBack }) {
  useInput((input, key) => {
    if (key.escape) { onBack(); return }
    if (input === 'p' || input === 'y') { onPush(); return }
    if (input === 'n') { onSkip(); return }
  })
  const shown = commits.slice(0, 8)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ci.pending}
      paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={t.ci.pending} bold>● {commits.length} local commit{commits.length > 1 ? 's' : ''} not yet pushed</Text>
      </Box>
      {shown.map(c => (
        <Box key={c.sha} gap={1}>
          <Text color={t.ui.dim}>{c.sha}</Text>
          <Text color={t.ui.muted} wrap="truncate">{c.message}</Text>
        </Box>
      ))}
      {commits.length > 8 && (
        <Text color={t.ui.dim}>  … and {commits.length - 8} more</Text>
      )}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>
          The PR will only include commits already on GitHub unless you push first.
        </Text>
      </Box>
      <Box marginTop={1} gap={3}>
        <Text color={t.ui.selected}>[p] Push {commits.length} commit{commits.length > 1 ? 's' : ''}</Text>
        <Text color={t.ui.muted}>[n] Continue without pushing</Text>
        <Text color={t.ui.dim}>[Esc] Back</Text>
      </Box>
    </Box>
  )
}

function PushingScreen({ branch }) {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={t.ci.pending}>⟳ Pushing '{branch}' to origin…</Text>
    </Box>
  )
}

function NoDiffScreen({ head, base, onBack }) {
  useInput((input, key) => {
    if (key.escape || input === 'q') onBack()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.border}
      paddingX={2} paddingY={1}>
      <Text color={t.ui.muted} bold>No commits to PR</Text>
      <Box marginTop={1}>
        <Text color={t.ui.dim}>
          <Text color={t.ui.selected}>'{head}'</Text> has no commits ahead of{' '}
          <Text color={t.ui.selected}>'{base}'</Text>.
        </Text>
      </Box>
      <Text color={t.ui.dim}>There is nothing to merge. Try a different branch pair.</Text>
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Esc] Back</Text>
      </Box>
    </Box>
  )
}

// ─── Field status indicators ──────────────────────────────────────────────────

function HeadStatus({ validating, status, info }) {
  if (validating) return <Text color={t.ci.pending}> ⟳ checking…</Text>
  if (!status) return null
  if (status === 'clean') {
    const ahead = info?.comparison?.ahead_by
    return <Text color={t.ci.pass}> ✓{ahead != null ? ` ${ahead} ahead` : ' in remote'}</Text>
  }
  if (status === 'unpushed') {
    const u = info?.unpushed?.length || 0
    return <Text color={t.ci.pending}> ● {u} unpushed  [p] push</Text>
  }
  if (status === 'not-in-remote') return <Text color={t.ci.fail}> ✗ not pushed  [p] push to proceed</Text>
  if (status === 'no-diff')       return <Text color={t.ui.muted}> ○ no new commits vs base</Text>
  if (status === 'error')         return <Text color={t.ci.fail}> ✗ could not verify</Text>
  return null
}

function BaseStatus({ validating, status }) {
  if (validating) return <Text color={t.ci.pending}> ⟳ checking…</Text>
  if (!status) return null
  if (status === 'exists')    return <Text color={t.ci.pass}> ✓ exists</Text>
  if (status === 'not-found') return <Text color={t.ci.fail}> ✗ branch not found</Text>
  return null
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function NewPRDialog({ repo, onClose, onCreated }) {
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80

  const [form, setForm]         = useState({ title: '', head: '', base: '', body: '' })
  const [activeField, setActive] = useState(0)   // index into FIELDS

  // Current-branch suggestion
  const [currentBranch, setCurrentBranch] = useState(null)
  const [showBranchHint, setShowBranchHint] = useState(false)

  // Head validation
  const [headValidating, setHeadValidating] = useState(false)
  const [headStatus, setHeadStatus]         = useState(null)
  const [headInfo, setHeadInfo]             = useState(null)
  const lastValidatedHead = useRef('')

  // Base validation
  const [baseValidating, setBaseValidating] = useState(false)
  const [baseStatus, setBaseStatus]         = useState(null)
  const lastValidatedBase = useRef('')

  // Sub-screens
  const [screen, setScreen] = useState('form')
  // 'form' | 'push-required' | 'unpushed-commits' | 'pushing' | 'no-diff' | 'submitting'

  const [statusMsg, setStatusMsg] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  // ── On mount: detect current branch + default base ──────────────────────────
  useEffect(() => {
    getCurrentBranch().then(branch => {
      setCurrentBranch(branch)
      if (branch) setShowBranchHint(true)
    }).catch(() => {})

    getRepoInfo(repo).then(info => {
      const defBranch = info?.defaultBranchRef?.name
      if (defBranch) {
        setForm(f => ({ ...f, base: f.base || defBranch }))
        validateBase(defBranch)
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Validation helpers ───────────────────────────────────────────────────────

  const validateHead = useCallback(async (branch, base) => {
    if (!branch || branch === lastValidatedHead.current) return
    lastValidatedHead.current = branch
    setHeadValidating(true)
    setHeadStatus(null)
    setHeadInfo(null)
    try {
      const remote = await getRemoteBranch(repo, branch)
      if (!remote) {
        setHeadStatus('not-in-remote')
      } else {
        const [unpushed, comparison] = await Promise.all([
          getUnpushedCommits(branch),
          base ? compareBranches(repo, base, branch) : Promise.resolve(null),
        ])
        if (comparison && comparison.ahead_by === 0 && !unpushed?.length) {
          setHeadStatus('no-diff')
          setHeadInfo({ comparison })
        } else if (unpushed?.length > 0) {
          setHeadStatus('unpushed')
          setHeadInfo({ unpushed, comparison })
        } else {
          setHeadStatus('clean')
          setHeadInfo({ comparison })
        }
      }
    } catch {
      setHeadStatus('error')
    } finally {
      setHeadValidating(false)
    }
  }, [repo])

  const validateBase = useCallback(async (branch) => {
    if (!branch || branch === lastValidatedBase.current) return
    lastValidatedBase.current = branch
    setBaseValidating(true)
    setBaseStatus(null)
    try {
      const remote = await getRemoteBranch(repo, branch)
      setBaseStatus(remote ? 'exists' : 'not-found')
    } catch {
      setBaseStatus('not-found')
    } finally {
      setBaseValidating(false)
    }
  }, [repo])

  // ── Field navigation ─────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setActive(f => {
      const next = Math.min(FIELDS.length - 1, f + 1)
      // Trigger validation when leaving head or base
      if (FIELDS[f] === 'head' && form.head) validateHead(form.head, form.base)
      if (FIELDS[f] === 'base' && form.base) validateBase(form.base)
      return next
    })
  }, [form.head, form.base, validateHead, validateBase])

  const goPrev = useCallback(() => {
    setActive(f => Math.max(0, f - 1))
  }, [])

  // ── Push helpers ─────────────────────────────────────────────────────────────

  const doPush = useCallback(async () => {
    setScreen('pushing')
    try {
      await pushBranch(form.head)
      // Re-validate after push
      lastValidatedHead.current = ''
      setScreen('form')
      validateHead(form.head, form.base)
    } catch (err) {
      setScreen('form')
      setSubmitError(`Push failed: ${err.message}`)
      setTimeout(() => setSubmitError(null), 5000)
    }
  }, [form.head, form.base, validateHead])

  // ── Submit ───────────────────────────────────────────────────────────────────

  const doSubmit = useCallback(async () => {
    if (!form.title.trim()) { setSubmitError('Title is required'); return }
    if (!form.head.trim())  { setSubmitError('Head branch is required'); setActive(1); return }
    if (!form.base.trim())  { setSubmitError('Base branch is required'); setActive(2); return }
    if (headStatus === 'not-in-remote') {
      setScreen('push-required')
      return
    }
    if (baseStatus === 'not-found') {
      setSubmitError(`Base branch '${form.base}' does not exist on GitHub`)
      setActive(2)
      return
    }
    setScreen('submitting')
    try {
      await createPR(repo, {
        title: form.title.trim(),
        head:  form.head.trim(),
        base:  form.base.trim(),
        body:  form.body.trim() || undefined,
      })
      if (onCreated) onCreated()
      onClose()
    } catch (err) {
      setScreen('form')
      setSubmitError(err.message)
      setTimeout(() => setSubmitError(null), 6000)
    }
  }, [form, repo, headStatus, baseStatus, onClose, onCreated])

  // ── Open editor ──────────────────────────────────────────────────────────────

  const openEditor = useCallback(() => {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
    if (!editor || /[\0\n\r]/.test(editor)) return
    let tmpDir
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
      const tmp = join(tmpDir, 'pr-body.md')
      writeFileSync(tmp, form.body || '', { mode: 0o600 })
      spawnSync(editor, [tmp], { stdio: 'inherit' })
      const content = readFileSync(tmp, 'utf8')
      setForm(f => ({ ...f, body: content }))
      unlinkSync(tmp)
    } catch { /* ignore */ }
    finally { try { if (tmpDir) rmdirSync(tmpDir) } catch {} }
  }, [form.body])

  // ── Keyboard ──────────────────────────────────────────────────────────────────

  useInput((input, key) => {
    // Sub-screens handled by their own components — only handle form screen here
    if (screen !== 'form' && screen !== 'submitting') return

    if (key.escape) { onClose(); return }

    // Current-branch hint: [y] to accept, [n] to skip
    if (showBranchHint && FIELDS[activeField] === 'head' && !form.head) {
      if (input === 'y') {
        setForm(f => ({ ...f, head: currentBranch }))
        setShowBranchHint(false)
        validateHead(currentBranch, form.base)
        return
      }
      if (input === 'n') {
        setShowBranchHint(false)
        return
      }
    }

    if (key.tab && key.shift) { goPrev(); return }
    if (key.tab)               { goNext(); return }

    // Ctrl+Enter OR Ctrl+S — Ctrl+Enter is indistinguishable from Enter on macOS terminals
    if ((key.return && key.ctrl) || (key.ctrl && input === 'g')) { doSubmit(); return }

    // [p] trigger push from form when head has issues
    if (input === 'p' && FIELDS[activeField] === 'head') {
      if (headStatus === 'not-in-remote') { setScreen('push-required'); return }
      if (headStatus === 'unpushed')      { setScreen('unpushed-commits'); return }
    }

    // Field-level editing
    const fieldName = FIELDS[activeField]
    if (fieldName === 'body' && input === 'e') { openEditor(); return }

    if (key.return && fieldName !== 'body') { goNext(); return }

    if (key.backspace || key.delete) {
      setForm(f => ({ ...f, [fieldName]: (f[fieldName] || '').slice(0, -1) }))
      // Reset head/base status if user is editing the field
      if (fieldName === 'head') { setHeadStatus(null); lastValidatedHead.current = '' }
      if (fieldName === 'base') { setBaseStatus(null); lastValidatedBase.current = '' }
      return
    }

    if (input && !key.ctrl && !key.meta) {
      setForm(f => ({ ...f, [fieldName]: (f[fieldName] || '') + input }))
      if (fieldName === 'head') { setHeadStatus(null); lastValidatedHead.current = '' }
      if (fieldName === 'base') { setBaseStatus(null); lastValidatedBase.current = '' }
    }
  })

  // ── Sub-screen renders ───────────────────────────────────────────────────────

  if (screen === 'push-required') {
    return (
      <PushRequiredScreen
        branch={form.head}
        onPush={doPush}
        onBack={() => setScreen('form')}
      />
    )
  }

  if (screen === 'unpushed-commits') {
    return (
      <UnpushedCommitsScreen
        branch={form.head}
        commits={headInfo?.unpushed || []}
        onPush={doPush}
        onSkip={() => { setHeadStatus('clean'); setScreen('form') }}
        onBack={() => setScreen('form')}
      />
    )
  }

  if (screen === 'pushing') {
    return <PushingScreen branch={form.head} />
  }

  if (screen === 'no-diff') {
    return (
      <NoDiffScreen
        head={form.head}
        base={form.base}
        onBack={() => setScreen('form')}
      />
    )
  }

  if (screen === 'submitting') {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={t.ci.pending}>⟳ Creating PR…</Text>
      </Box>
    )
  }

  // ── Main form ────────────────────────────────────────────────────────────────

  const maxWidth = Math.min(cols - 6, 72)
  const isHeadField   = FIELDS[activeField] === 'head'
  const isBaseField   = FIELDS[activeField] === 'base'
  const canSubmit     = form.title && form.head && form.base
    && headStatus !== 'not-in-remote'
    && baseStatus !== 'not-found'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected}
      paddingX={1} paddingY={0} width={Math.min(cols - 2, 76)}>

      {/* Title */}
      <Box marginBottom={0} marginTop={0} paddingX={1}>
        <Text color={t.ui.selected} bold>⎇  New Pull Request</Text>
        <Text color={t.ui.dim}>  {repo}</Text>
      </Box>

      <Box borderStyle="single" borderColor={t.ui.border}
        borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} />

      {/* Title field */}
      {renderField({
        label: 'Title',
        name: 'title',
        value: form.title,
        isActive: FIELDS[activeField] === 'title',
        maxWidth,
      })}

      {/* Head branch field */}
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Box gap={1}>
          <Text color={FIELDS[activeField] === 'head' ? t.ui.selected : t.ui.muted}
            bold={FIELDS[activeField] === 'head'}>
            Head branch:
          </Text>
          <HeadStatus validating={headValidating} status={headStatus} info={headInfo} />
        </Box>

        {/* "Use current branch?" hint */}
        {showBranchHint && isHeadField && !form.head && currentBranch && (
          <Box paddingX={1} marginBottom={0}>
            <Text color={t.ci.pending}>Use </Text>
            <Text color={t.ui.selected}>'{currentBranch}'</Text>
            <Text color={t.ci.pending}> as head branch?  </Text>
            <Text color={t.ui.selected}>[y] Yes</Text>
            <Text color={t.ui.dim}>  [n] No  (or just type a branch name)</Text>
          </Box>
        )}

        <Box borderStyle={isHeadField ? 'round' : 'single'}
          borderColor={
            headStatus === 'not-in-remote' ? t.ci.fail
            : headStatus === 'unpushed'    ? t.ci.pending
            : isHeadField                  ? t.ui.selected
            : t.ui.border
          }
          paddingX={1} width={maxWidth}>
          <Text wrap="truncate">{form.head}</Text>
          {isHeadField && <Text color={t.ui.dim}>|</Text>}
        </Box>
      </Box>

      {/* Base branch field */}
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Box gap={1}>
          <Text color={FIELDS[activeField] === 'base' ? t.ui.selected : t.ui.muted}
            bold={FIELDS[activeField] === 'base'}>
            Base branch:
          </Text>
          <BaseStatus validating={baseValidating} status={baseStatus} />
        </Box>
        <Box borderStyle={isBaseField ? 'round' : 'single'}
          borderColor={
            baseStatus === 'not-found' ? t.ci.fail
            : isBaseField              ? t.ui.selected
            : t.ui.border
          }
          paddingX={1} width={maxWidth}>
          <Text wrap="truncate">{form.base}</Text>
          {isBaseField && <Text color={t.ui.dim}>|</Text>}
        </Box>
        {baseStatus === 'not-found' && (
          <Text color={t.ci.fail} paddingX={1}>
            ✗ Branch '{form.base}' not found on GitHub
          </Text>
        )}
      </Box>

      {/* Body field */}
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Text color={FIELDS[activeField] === 'body' ? t.ui.selected : t.ui.muted}
          bold={FIELDS[activeField] === 'body'}>
          Body: {FIELDS[activeField] === 'body' && <Text color={t.ui.dim}>[e] open $EDITOR</Text>}
        </Text>
        <Box borderStyle={FIELDS[activeField] === 'body' ? 'round' : 'single'}
          borderColor={FIELDS[activeField] === 'body' ? t.ui.selected : t.ui.border}
          paddingX={1} width={maxWidth}>
          {form.body ? (
            <Box flexDirection="column">
              {form.body.split('\n').slice(0, 3).map((line, i) => (
                <Text key={i} wrap="truncate">{line || ' '}</Text>
              ))}
              {form.body.split('\n').length > 3 && (
                <Text color={t.ui.dim}>… {form.body.split('\n').length - 3} more lines</Text>
              )}
            </Box>
          ) : (
            <Text color={t.ui.dim}>optional — press [e] to open editor</Text>
          )}
        </Box>
      </Box>

      {/* Error message */}
      {submitError && (
        <Box paddingX={2} marginBottom={0}>
          <Text color={t.ci.fail}>✗ {submitError}</Text>
        </Box>
      )}

      {/* Footer hints */}
      <Box borderStyle="single" borderColor={t.ui.border}
        borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}
        paddingX={1}>
        <Box justifyContent="space-between" width={maxWidth}>
          <Box gap={2}>
            <Text color={t.ui.dim}>[Tab] next  [Shift+Tab] prev</Text>
            {canSubmit
              ? <Text color={t.ui.selected}>[Ctrl+G] Create PR</Text>
              : <Text color={t.ui.dim}>[Ctrl+G] Create PR</Text>
            }
          </Box>
          <Text color={t.ui.dim}>[Esc] cancel</Text>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Tiny field renderer (used for simple text fields) ────────────────────────

function renderField({ label, name, value, isActive, maxWidth }) {
  return (
    <Box key={name} flexDirection="column" marginBottom={1} paddingX={1}>
      <Text color={isActive ? t.ui.selected : t.ui.muted} bold={isActive}>{label}:</Text>
      <Box borderStyle={isActive ? 'round' : 'single'}
        borderColor={isActive ? t.ui.selected : t.ui.border}
        paddingX={1} width={maxWidth}>
        <Text wrap="truncate">{value}</Text>
        {isActive && <Text color={t.ui.dim}>|</Text>}
      </Box>
    </Box>
  )
}
