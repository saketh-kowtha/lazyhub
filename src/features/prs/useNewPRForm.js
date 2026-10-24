// @ts-nocheck
/**
 * New PR form state, branch validation, editor, and submission lifecycle.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
// Editor only; all GitHub calls below use the typed executor.
// eslint-disable-next-line no-restricted-imports
import { execaSync } from 'execa'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { useKeymapInput } from '../../config/keymap.js'
import {
  getRemoteBranch, compareBranches, getUnpushedCommits,
  getCurrentBranch, pushBranch, getRepoInfo, createPR,
} from '../../executor.js'

const FIELDS = ['title', 'head', 'base', 'body']

/**
 * Manage the new PR form and its existing keyboard-driven workflow.
 * @param {object} root0 dialog callbacks and repository
 * @param {string} root0.repo repository name
 * @param {Function} root0.onClose close the dialog
 * @param {Function} [root0.onCreated] refresh after creation
 */
export function useNewPRForm({ repo, onClose, onCreated }) {
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
    const raw = process.env.EDITOR || process.env.VISUAL || 'vi'
    if (!raw || /[\0\n\r]/.test(raw)) return
    const [editorBin, ...editorArgs] = raw.split(/\s+/).filter(Boolean)
    let tmpDir
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
      const tmp = join(tmpDir, 'pr-body.md')
      writeFileSync(tmp, form.body || '', { mode: 0o600 })
      const result = execaSync(editorBin, [...editorArgs, tmp], { stdio: 'inherit' })
      if (result.exitCode !== 0) return
      const content = readFileSync(tmp, 'utf8')
      setForm(f => ({ ...f, body: content }))
    } catch { /* ignore */ }
    finally { try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
  }, [form.body])

  const changeField = (name, value) => {
    setForm(f => ({ ...f, [name]: value }))
    if (name === 'head') {
      setHeadStatus(null)
      lastValidatedHead.current = ''
    } else if (name === 'base') {
      setBaseStatus(null)
      lastValidatedBase.current = ''
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────────

  useKeymapInput((input, key) => {
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

    // Ctrl+Enter OR Ctrl+G — Ctrl+Enter is indistinguishable from Enter on macOS terminals
    if ((key.return && key.ctrl) || (key.ctrl && input === 'g')) { doSubmit(); return }

    // [p] trigger push whenever head branch has issues — available from any field
    // NOTE: must be checked before field-level text editing so 'p' is not typed into inputs
    if (input === 'p') {
      if (headStatus === 'not-in-remote') { setScreen('push-required'); return }
      if (headStatus === 'unpushed')      { setScreen('unpushed-commits'); return }
    }

    // Field-level editing
    const fieldName = FIELDS[activeField]
    // Use Ctrl+E for editor to avoid 'e' key hijacking
    if (fieldName === 'body' && key.ctrl && input === 'e') {
      openEditor();
      return
    }

    if (key.return && fieldName !== 'body') { goNext(); return }

    // Text editing is now handled by TextInput components for title, head, base
    // For body (multiline), we still do basic appending if not using editor
    if (fieldName === 'body' && headStatus !== 'not-in-remote' && headStatus !== 'unpushed') {
      if (key.backspace || key.delete) {
        setForm(f => ({ ...f, body: (f.body || '').slice(0, -1) }))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setForm(f => ({ ...f, body: (f.body || '') + input }))
      }
    }
  })

  return {
    form, activeField: FIELDS[activeField], currentBranch, showBranchHint,
    headValidating, headStatus, headInfo, baseValidating, baseStatus,
    screen, submitError, changeField, goNext, doPush,
    returnToForm: () => setScreen('form'),
    skipPush: () => { setHeadStatus('clean'); setScreen('form') },
  }
}
