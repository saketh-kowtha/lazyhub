/**
 * src/components/AIAssistant.jsx — AI assistant overlay
 *
 * Full-screen content-area overlay triggered by Ctrl+A.
 * Shows conversation history, a single-line prompt, and handles
 * action confirmation + navigation prompts inline.
 */

import React, { useState, useEffect, useRef, useCallback, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../theme.js'
import { AppContext } from '../context.js'
import { Spinner } from './Spinner.jsx'
import { TextInput, sanitize } from '../utils.js'
import { ConfirmDialog } from './dialogs/ConfirmDialog.jsx'
import { runAssistantTurn, executeMutatingTool, buildToolResultMessage } from '../ai-assistant.js'

const PHASE = Object.freeze({
  IDLE:      'idle',
  THINKING:  'thinking',
  CONFIRM:   'confirm',
  EXECUTING: 'executing',
})

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ─── Single message row ───────────────────────────────────────────────────────

function MessageRow({ msg, maxWidth }) {
  const { t } = useTheme()

  const roleLabel  = msg.role === 'user' ? ' You' : msg.role === 'system' ? ' Lzy' : '  AI'
  const roleColor  = msg.role === 'user'   ? t.ui.selected
                   : msg.role === 'system' ? t.ui.muted
                   : '#3fb950'
  const timeStr    = fmtTime(msg.timestamp)

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text color={t.ui.dim}>{timeStr} </Text>
        <Text color={roleColor} bold>{roleLabel}  </Text>
        <Box flexGrow={1}>
          <Text color={msg.role === 'system' ? t.ui.muted : undefined} wrap="wrap">
            {sanitize(msg.text || '')}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AIAssistant({ repo, pane, selectedItem, onClose, onNavigate, aiConfig, rows }) {
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)

  const [messages,        setMessages]        = useState([])
  const [inputText,       setInputText]       = useState('')
  const [phase,           setPhase]           = useState(PHASE.IDLE)
  const [pendingAction,   setPendingAction]   = useState(null)
  const [navPrompt,       setNavPrompt]       = useState(null)
  const [scrollOffset,    setScrollOffset]    = useState(0)
  const [thinkingStatus,  setThinkingStatus]  = useState('thinking…')

  // Raw Claude API message array — kept in ref to avoid triggering re-renders
  const conversationRef = useRef([])

  // Block all background key handlers while AI overlay is open
  useEffect(() => {
    notifyDialog(true)
    return () => notifyDialog(false)
  }, [notifyDialog])

  // Rows available for the message area (header=1, input=3, margins)
  const msgAreaRows = Math.max(2, rows - 5)
  const maxOffset   = Math.max(0, messages.length - msgAreaRows)

  // Auto-scroll to bottom on new message
  useEffect(() => {
    setScrollOffset(Math.max(0, messages.length - msgAreaRows))
  }, [messages.length, msgAreaRows])

  // ─── Key handler ─────────────────────────────────────────────────────────
  useInput((input, key) => {
    if (phase === PHASE.THINKING || phase === PHASE.EXECUTING) return
    if (phase === PHASE.CONFIRM) return  // ConfirmDialog owns keys in confirm phase

    // Navigation prompt takes priority
    if (navPrompt) {
      if (input === 'y' || key.return) {
        const nav = navPrompt
        setNavPrompt(null)
        onNavigate(nav)
        return
      }
      if (input === 'n' || key.escape) { setNavPrompt(null); return }
      return
    }

    if (key.escape) { onClose(); return }

    if (key.downArrow || input === 'j') { setScrollOffset(s => Math.min(s + 1, maxOffset)); return }
    if (key.upArrow   || input === 'k') { setScrollOffset(s => Math.max(0, s - 1));         return }
    if (input === 'G') { setScrollOffset(maxOffset); return }
    if (input === 'g') { setScrollOffset(0); return }
  })

  // ─── Submit message ───────────────────────────────────────────────────────
  const submitMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || phase !== PHASE.IDLE) return

    const userMsg = { role: 'user', text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInputText('')
    setThinkingStatus('thinking…')
    setPhase(PHASE.THINKING)

    let result
    try {
      result = await runAssistantTurn({
        messages:    conversationRef.current,
        userMessage: text,
        repo,
        ctx:         { repo, pane, selectedItem },
        aiConfig,
        onStatus:    (msg) => setThinkingStatus(msg),
      })
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', text: `Error: ${err.message}`, timestamp: new Date() }])
      setPhase(PHASE.IDLE)
      return
    }

    conversationRef.current = result.messages || conversationRef.current

    switch (result.type) {
      case 'error':
        setMessages(prev => [...prev, { role: 'system', text: result.text, timestamp: new Date() }])
        setPhase(PHASE.IDLE)
        break

      case 'pending_action':
        if (result.text) {
          setMessages(prev => [...prev, { role: 'assistant', text: result.text, timestamp: new Date() }])
        }
        setPendingAction({
          toolName:       result.toolName,
          toolInput:      result.toolInput,
          toolUseId:      result.toolUseId,
          confirmMessage: result.confirmMessage,
          isDestructive:  result.isDestructive,
        })
        setPhase(PHASE.CONFIRM)
        break

      case 'navigate':
        if (result.text) {
          setMessages(prev => [...prev, { role: 'assistant', text: result.text, timestamp: new Date() }])
        }
        setNavPrompt(result.navigate)
        setPhase(PHASE.IDLE)
        break

      default: // 'answer'
        setMessages(prev => [...prev, { role: 'assistant', text: result.text, timestamp: new Date() }])
        setPhase(PHASE.IDLE)
        break
    }
  }, [inputText, phase, repo, pane, selectedItem, aiConfig])

  // ─── Confirm / cancel action ──────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return
    setPhase(PHASE.EXECUTING)

    const provider = aiConfig?.provider || 'anthropic'
    try {
      await executeMutatingTool(pendingAction.toolName, pendingAction.toolInput, repo)
      conversationRef.current.push(
        buildToolResultMessage(provider, pendingAction.toolUseId, JSON.stringify({ success: true }))
      )
      setMessages(prev => [...prev, { role: 'system', text: `✓ Done: ${pendingAction.confirmMessage}`, timestamp: new Date() }])
    } catch (err) {
      conversationRef.current.push(
        buildToolResultMessage(provider, pendingAction.toolUseId, JSON.stringify({ error: err.message }), true)
      )
      setMessages(prev => [...prev, { role: 'system', text: `✗ Failed: ${err.message}`, timestamp: new Date() }])
    }

    setPendingAction(null)
    setPhase(PHASE.IDLE)
  }, [pendingAction, repo])

  const handleCancel = useCallback(() => {
    if (!pendingAction) return
    const provider = aiConfig?.provider || 'anthropic'
    conversationRef.current.push(
      buildToolResultMessage(provider, pendingAction.toolUseId, JSON.stringify({ cancelled: true }))
    )
    setMessages(prev => [...prev, { role: 'system', text: 'Action cancelled', timestamp: new Date() }])
    setPendingAction(null)
    setPhase(PHASE.IDLE)
  }, [pendingAction])

  // ─── Render ───────────────────────────────────────────────────────────────
  const provider  = aiConfig?.provider || 'anthropic'
  const hasApiKey = provider === 'ollama'
    // Ollama is always keyless
    ? true
    : provider === 'openai'
      // Only block if using default OpenAI endpoint with no key; custom URLs are fine keyless
      ? !!(aiConfig?.openaiApiKey) || (aiConfig?.openaiBaseUrl || 'https://api.openai.com/v1') !== 'https://api.openai.com/v1'
      : !!(aiConfig?.anthropicApiKey)

  const startIdx = Math.min(scrollOffset, Math.max(0, messages.length - msgAreaRows))
  const visibleMessages = messages.slice(startIdx, startIdx + msgAreaRows)
  const inputFocused = phase === PHASE.IDLE && !navPrompt && hasApiKey

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.ui.selected}>

      {/* ── Header ── */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>AI Assistant</Text>
        <Text color={t.ui.dim}>
          {repo ? `${repo}  ·  ` : ''}{pane}{selectedItem ? ` #${selectedItem.number}` : ''}
          {'  [Esc] close'}
        </Text>
      </Box>

      {/* ── Message history ── */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {messages.length === 0 ? (
          <Box flexDirection="column" gap={0}>
            <Text color={t.ui.dim}>Ask anything about this repo. Examples:</Text>
            <Text color={t.ui.dim}>  · how many open PRs does @alice have?</Text>
            <Text color={t.ui.dim}>  · show me failing CI checks on PR 42</Text>
            <Text color={t.ui.dim}>  · merge this PR</Text>
            <Text color={t.ui.dim}>  · take me to the actions pane</Text>
          </Box>
        ) : (
          visibleMessages.map((msg, i) => (
            <MessageRow key={`${msg.timestamp.getTime()}-${i}`} msg={msg} />
          ))
        )}
      </Box>

      {/* ── Nav prompt ── */}
      {navPrompt && (
        <Box
          paddingX={2} paddingY={0}
          borderStyle="single"
          borderColor={t.ui.selected}
          borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}
        >
          <Text color={t.ui.selected}>
            Navigate to <Text bold>{navPrompt.pane}</Text>
            {navPrompt.itemNumber ? <Text bold> #{navPrompt.itemNumber}</Text> : null}
            {'?  '}
          </Text>
          <Text color={t.ui.dim}>[y/Enter] go  [n/Esc] cancel</Text>
        </Box>
      )}

      {/* ── Confirm dialog ── */}
      {phase === PHASE.CONFIRM && pendingAction && (
        <Box paddingX={1}>
          <ConfirmDialog
            message={pendingAction.confirmMessage}
            destructive={pendingAction.isDestructive}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        </Box>
      )}

      {/* ── Input / status bar ── */}
      <Box
        paddingX={1}
        borderStyle="single"
        borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}
        borderColor={t.ui.border}
      >
        {(phase === PHASE.THINKING || phase === PHASE.EXECUTING) ? (
          <Spinner label={phase === PHASE.EXECUTING ? 'Executing…' : thinkingStatus} />
        ) : !hasApiKey ? (
          <Text color={t.ci?.fail || '#f85149'}>
            No API key — press [S] to open Settings → AI Provider
          </Text>
        ) : (
          <Box flexGrow={1}>
            <Text color={t.ui.muted}>&gt; </Text>
            <TextInput
              value={inputText}
              onChange={setInputText}
              placeholder="Ask a question or give a command…"
              focus={inputFocused}
              onEnter={submitMessage}
            />
          </Box>
        )}
      </Box>

    </Box>
  )
}
