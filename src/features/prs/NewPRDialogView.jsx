// @ts-nocheck
/**
 * New PR form rendering, validation indicators, and push confirmation screens.
 */
import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useKeymapInput } from '../../config/keymap.js'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'

// ─── Screen components ────────────────────────────────────────────────────────

function PushRequiredScreen({ branch, onPush, onBack }) {
  const { t } = useTheme()
  useKeymapInput((input, key) => {
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

function UnpushedCommitsScreen({ commits, onPush, onSkip, onBack }) {
  const { t } = useTheme()
  useKeymapInput((input, key) => {
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
  const { t } = useTheme()
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={t.ci.pending}>⟳ Pushing '{branch}' to origin…</Text>
    </Box>
  )
}

function NoDiffScreen({ head, base, onBack }) {
  const { t } = useTheme()
  useKeymapInput((input, key) => {
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
  const { t } = useTheme()
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
  const { t } = useTheme()
  if (validating) return <Text color={t.ci.pending}> ⟳ checking…</Text>
  if (!status) return null
  if (status === 'exists')    return <Text color={t.ci.pass}> ✓ exists</Text>
  if (status === 'not-found') return <Text color={t.ci.fail}> ✗ branch not found</Text>
  return null
}

export function NewPRDialogView({ repo, state }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  const {
    form, activeField, currentBranch, showBranchHint,
    headValidating, headStatus, headInfo, baseValidating, baseStatus,
    screen, submitError, changeField, goNext, doPush, returnToForm, skipPush,
  } = state

  // ── Sub-screen renders ───────────────────────────────────────────────────────

  if (screen === 'push-required') {
    return (
      <PushRequiredScreen
        branch={form.head}
        onPush={doPush}
        onBack={returnToForm}
      />
    )
  }

  if (screen === 'unpushed-commits') {
    return (
      <UnpushedCommitsScreen
        commits={headInfo?.unpushed || []}
        onPush={doPush}
        onSkip={skipPush}
        onBack={returnToForm}
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
        onBack={returnToForm}
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
  const isHeadField   = activeField === 'head'
  const isBaseField   = activeField === 'base'
  // Disable all text inputs while head branch needs pushing — prevents 'p' from
  // being typed into a field and the push shortcut corrupting form.head
  const inputsBlocked = headStatus === 'not-in-remote' || headStatus === 'unpushed'
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
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Text color={activeField === 'title' ? t.ui.selected : t.ui.muted} bold={activeField === 'title'}>Title:</Text>
        <Box borderStyle={activeField === 'title' ? 'round' : 'single'}
          borderColor={activeField === 'title' ? t.ui.selected : t.ui.border}
          paddingX={1} width={maxWidth}>
          <TextInput
            value={form.title}
            onChange={(v) => changeField('title', v)}
            focus={activeField === 'title' && !inputsBlocked}
            onEnter={goNext}
          />
        </Box>
      </Box>

      {/* Head branch field */}
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Box gap={1}>
          <Text color={activeField === 'head' ? t.ui.selected : t.ui.muted}
            bold={activeField === 'head'}>
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
          <TextInput
            value={form.head}
            onChange={(v) => changeField('head', v)}
            focus={isHeadField && !inputsBlocked}
            onEnter={goNext}
          />
        </Box>
      </Box>

      {/* Base branch field */}
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Box gap={1}>
          <Text color={activeField === 'base' ? t.ui.selected : t.ui.muted}
            bold={activeField === 'base'}>
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
          <TextInput
            value={form.base}
            onChange={(v) => changeField('base', v)}
            focus={isBaseField && !inputsBlocked}
            onEnter={goNext}
          />
        </Box>
        {baseStatus === 'not-found' && (
          <Text color={t.ci.fail} paddingX={1}>
            ✗ Branch '{form.base}' not found on GitHub
          </Text>
        )}
      </Box>

      {/* Body field */}
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Text color={activeField === 'body' ? t.ui.selected : t.ui.muted}
          bold={activeField === 'body'}>
          Body: {activeField === 'body' && <Text color={t.ui.dim}>[Ctrl+E] open $EDITOR</Text>}
        </Text>
        <Box borderStyle={activeField === 'body' ? 'round' : 'single'}
          borderColor={activeField === 'body' ? t.ui.selected : t.ui.border}
          paddingX={1} width={maxWidth}>
          {form.body ? (
            <Box flexDirection="column">
              {form.body.split('\n').slice(0, 3).map((line, i) => (
                <Text key={i} wrap="truncate">{line || ' '}</Text>
              ))}
              {form.body.split('\n').length > 3 && (
                <Text color={t.ui.dim}>… {form.body.split('\n').length - 3} more lines</Text>
              )}
              {activeField === 'body' && <Text color={t.ui.dim}>|</Text>}
            </Box>
          ) : (
            <Text color={t.ui.dim}>optional — press [Ctrl+E] to open editor</Text>
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
