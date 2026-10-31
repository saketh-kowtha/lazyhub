// @ts-nocheck
/**
 * src/features/prs/diff/render.jsx — diff rows, dialogs, and overlays; actions come from state.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { firstActionKey } from '../../../config/actions.js'
import { OptionPicker } from '../../../components/dialogs/OptionPicker.jsx'
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../../components/dialogs/FuzzySearch.jsx'
import { FormCompose } from '../../../components/dialogs/FormCompose.jsx'
import { FooterKeys } from '../../../components/FooterKeys.jsx'
import { AIReviewPane } from '../../../components/AIReviewPane.jsx'
import { useTheme } from '../../../theme.js'
import { TextInput, colorChalk, applyThemeStyle, sanitize } from '../../../utils.js'
import { CommentThread } from '../../../components/CommentThread.jsx'
import { DiffSkeleton } from '../../../components/Skeleton.jsx'
import { FailureNotice } from '../../../components/FailureNotice.jsx'
import { classifyGhFailure } from '../../../executor.js'
import { syntaxHighlight, expandTabs } from './highlight.js'
import { openEditorSync } from './editor.js'

const stripAnsi = s => (s || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

const MERGE_OPTIONS_BASE = [
  { value: 'merge',  label: '--merge',  description: 'Create a merge commit' },
  { value: 'squash', label: '--squash', description: 'Squash all commits into one' },
  { value: 'rebase', label: '--rebase', description: 'Rebase onto base branch' },
]
const MERGE_OPTION_ADMIN = { value: 'admin', label: '--admin', description: 'Bypass branch protection (admin only)' }

// ─── Diff line renderer ───────────────────────────────────────────────────────
// Gutter: cursor(1) oldLn(4) newLn(4) sign(2) code

const DiffLine = React.memo(({ row, isSelected, lang, isMatch, t }) => {
  let cur
  if (isSelected) {
    cur = applyThemeStyle('▶', '#ffffff', t.diff.cursorBg)
  } else if (isMatch) {
    cur = colorChalk('#e3b341')('◆')
  } else {
    cur = ' '
  }

  // Gutter: oldLn(4) │ newLn(4) sign(2) code
  // · · · ·  — blank slots use spaces so columns stay aligned
  const gutterOld = row.oldLine != null ? String(row.oldLine).padStart(4) : '    '
  const gutterNew = row.newLine != null ? String(row.newLine).padStart(4) : '    '

  if (row.type === 'file-header') {
    const line =
      colorChalk(t.ui.selected).bold(`━━ ${row.filename} `) +
      colorChalk(t.ci.pass)(`+${row.addCount}`) +
      colorChalk(t.syntax.default)(' / ') +
      colorChalk(t.ci.fail)(`-${row.delCount}`)
    return <Text wrap="truncate">{cur + line}</Text>
  }

  if (row.type === 'hunk') {
    return (
      <Text wrap="truncate">
        {cur + applyThemeStyle(`${gutterOld}│${gutterNew}   ${expandTabs(row.text)}`, t.diff.hunkFg, t.diff.hunkBg)}
      </Text>
    )
  }

  if (row.type === 'add') {
    const signFg = isSelected ? '#ffffff' : t.diff.addSign
    const sign   = isSelected ? '▶' : '+'
    const gutter = applyThemeStyle(`${gutterOld}│${gutterNew} ${sign} `, signFg, t.diff.addBg)
    return <Text wrap="truncate">{cur + gutter + syntaxHighlight(row.text, lang, t.diff.addBg, t)}</Text>
  }

  if (row.type === 'del') {
    const signFg = isSelected ? '#ffffff' : t.diff.delSign
    const sign   = isSelected ? '▶' : '-'
    const gutter = applyThemeStyle(`${gutterOld}│${gutterNew} ${sign} `, signFg, t.diff.delBg)
    return <Text wrap="truncate">{cur + gutter + syntaxHighlight(row.text, lang, t.diff.delBg, t)}</Text>
  }

  // ctx — both old and new line numbers visible with │ separator between them
  const bgGutter = isSelected
    ? applyThemeStyle(`${gutterOld}│${gutterNew}   `, t.ui.selected, t.diff.cursorBg)
    : colorChalk(t.ui.dim)(`${gutterOld}│${gutterNew}   `)
  const code = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : null, t)
  return <Text wrap="truncate">{cur + bgGutter + code}</Text>
})

// ─── Split view renderer ──────────────────────────────────────────────────────

function renderSplitView(rows, scrollOffset, visibleHeight, cursor, langCache, colWidth, t) {
  const result = []
  const slice = rows.slice(scrollOffset, scrollOffset + visibleHeight)

  let i = 0
  while (i < slice.length) {
    const row = slice[i]
    const idx = scrollOffset + i
    // del+add pairs: del highlights when cursor is on either side
    const nextIsPairedAdd = row.type === 'del' && slice[i + 1]?.type === 'add'
    const isSelected = idx === cursor || (nextIsPairedAdd && (scrollOffset + i + 1) === cursor)

    // Full-width rows (file-header, hunk)
    if (row.type === 'file-header' || row.type === 'hunk') {
      const lang = langCache.get(row.filename)
      result.push(
        <Box key={idx}>
          <DiffLine row={row} isSelected={isSelected} lang={lang} t={t} />
        </Box>
      )
      i++
      continue
    }

    if (row.type === 'ctx') {
      const lang = langCache.get(row.filename)
      const code = syntaxHighlight(row.text, lang, null, t)
      const gutter = colorChalk(t.ui.dim)(`${String(row.oldLine ?? '').padStart(4)}│${String(row.newLine ?? '').padStart(4)}   `)
      const line = isSelected ? applyThemeStyle(gutter + code, null, t.diff.cursorBg) : gutter + code
      result.push(
        <Box key={idx}>
          <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{line}</Text></Box>
          <Text color={t.ui.dim}>│</Text>
          <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{line}</Text></Box>
        </Box>
      )
      i++
      continue
    }

    // del/add: try to pair them
    if (row.type === 'del') {
      const nextRow = slice[i + 1]
      const lang = langCache.get(row.filename)

      const delCur    = isSelected ? applyThemeStyle('▶', '#ffffff', t.diff.cursorBg) : ' '
      const delGutter = applyThemeStyle(`${String(row.oldLine ?? '').padStart(4)}│     - `, isSelected ? '#ffffff' : t.diff.delSign, isSelected ? t.diff.cursorBg : t.diff.delBg)
      const delCode   = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : t.diff.delBg, t)
      const delLine   = delCur + delGutter + delCode

      if (nextRow && nextRow.type === 'add') {
        const addSelected = idx === cursor || (scrollOffset + i + 1) === cursor
        const addCur    = addSelected ? applyThemeStyle('▶', '#ffffff', t.diff.cursorBg) : ' '
        const addGutter = applyThemeStyle(`    │${String(nextRow.newLine ?? '').padStart(4)} + `, addSelected ? '#ffffff' : t.diff.addSign, addSelected ? t.diff.cursorBg : t.diff.addBg)
        const addCode   = syntaxHighlight(nextRow.text, langCache.get(nextRow.filename), addSelected ? t.diff.cursorBg : t.diff.addBg, t)
        const addLine   = addCur + addGutter + addCode

        result.push(
          <Box key={idx}>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{delLine}</Text></Box>
            <Text color={t.ui.dim}>│</Text>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{addLine}</Text></Box>
          </Box>
        )
        i += 2
      } else {
        result.push(
          <Box key={idx}>
            <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{delLine}</Text></Box>
            <Text color={t.ui.dim}>│</Text>
            <Box width={colWidth} overflow="hidden"><Text> </Text></Box>
          </Box>
        )
        i++
      }
      continue
    }

    if (row.type === 'add') {
      // Unpaired add
      const lang    = langCache.get(row.filename)
      const addCur  = isSelected ? applyThemeStyle('▶', '#ffffff', t.diff.cursorBg) : ' '
      const addGutter = applyThemeStyle(`    │${String(row.newLine ?? '').padStart(4)} + `, isSelected ? '#ffffff' : t.diff.addSign, isSelected ? t.diff.cursorBg : t.diff.addBg)
      const addCode   = syntaxHighlight(row.text, lang, isSelected ? t.diff.cursorBg : t.diff.addBg, t)
      const addLine   = addCur + addGutter + addCode

      result.push(
        <Box key={idx}>
          <Box width={colWidth} overflow="hidden"><Text> </Text></Box>
          <Text color={t.ui.dim}>│</Text>
          <Box width={colWidth} overflow="hidden"><Text wrap="truncate">{addLine}</Text></Box>
        </Box>
      )
      i++
      continue
    }

    i++
  }

  return result
}

/** Render the current diff session without fetching or mutating GitHub data.
 * @param {object} props
 * @param {number} props.prNumber
 * @param {object} props.state
 */
export function DiffView({ prNumber, state }) {
  const { t } = useTheme()
  const {
    stdout, visibleHeight, diffStats, isLargeDiff, diffTooLarge, diffRefreshError, diffWarningAck,
    prMeta, repoInfo, loading, error, cursor, scrollOffset, dialog, setDialog,
    adminMergeMsg, compose, setCompose, COMMENT_TYPES, commentStatus, splitView,
    footerKeys, showTree, treeCursor, findQuery, setFindQuery, findActive,
    findMatches, gotoActive, gotoInput, setGotoInput, fileJumpActive, setFileJumpActive,
    aiReview, setAiReview, aiReviewLoading, aiReviewError, setAiReviewError,
    aiPostStatus, setAiPostStatus, files, rows, langCache, fileStartIndices,
    treeRows, commentsByLine, jumpTo, handleAiJumpTo, handleAiPost,
    submitMerge, selectAdminMethod, confirmAdminMerge, submitApproval, submitChanges
  } = state

  if (diffTooLarge) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text color={t.ci.pending} bold>⚠ Large diff: GitHub would not return it here</Text>
        <Text color={t.ui.muted}>The diff is too large to load in the terminal.</Text>
        <Box marginTop={1} gap={3}>
          <Text color={t.ui.muted}>[{firstActionKey('pr.open-browser', 'o')}] Open in browser</Text>
          <Text color={t.ui.dim}>[Esc] Back</Text>
        </Box>
      </Box>
    )
  }

  if (isLargeDiff && !diffWarningAck) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text color={t.ci.pending} bold>⚠ Large diff: +{diffStats.additions} -{diffStats.deletions} across {diffStats.changedFiles} files</Text>
        <Text color={t.ui.muted}>This may take a moment to render.</Text>
        <Box marginTop={1} gap={3}>
          <Text color={t.ui.selected}>[Enter] Load anyway</Text>
          <Text color={t.ui.muted}>[o] Open in browser</Text>
          <Text color={t.ui.dim}>[Esc] Back</Text>
        </Box>
      </Box>
    )
  }

  if (dialog === 'merge') {
    const mergeOpts = !repoInfo || repoInfo.viewerPermission === 'ADMIN'
      ? [...MERGE_OPTIONS_BASE, MERGE_OPTION_ADMIN]
      : MERGE_OPTIONS_BASE
    return (
      <OptionPicker
        title={`Merge PR #${prNumber}: ${sanitize(prMeta?.title || '')}`}
        options={mergeOpts}
        promptText="Commit message (optional)"
        onSubmit={submitMerge}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'merge-admin') {
    return (
      <OptionPicker
        title={`Merge method (admin bypass) — PR #${prNumber}`}
        options={MERGE_OPTIONS_BASE}
        onSubmit={selectAdminMethod}
        onCancel={() => setDialog('merge')}
      />
    )
  }

  if (dialog === 'merge-admin-confirm') {
    const pending = typeof adminMergeMsg === 'object' ? adminMergeMsg : { strategy: 'admin-merge', msg: adminMergeMsg }
    return (
      <ConfirmDialog
        message={`⚠ ADMIN BYPASS: merge PR #${prNumber} via --${pending.strategy.replace('admin-', '')} bypassing branch protection?`}
        destructive={true}
        onConfirm={confirmAdminMerge}
        onCancel={() => setDialog('merge-admin')}
      />
    )
  }

  if (dialog === 'approve-body') {
    return (
      <FormCompose
        title={`Approve PR #${prNumber}`}
        fields={[{ name: 'body', label: 'Comment (optional)', type: 'text' }]}
        onSubmit={submitApproval}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'reqchanges-body') {
    return (
      <FormCompose
        title={`Request changes on PR #${prNumber}`}
        fields={[{ name: 'body', label: 'Describe the changes needed', type: 'text' }]}
        onSubmit={submitChanges}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (loading) return (
    <Box flexDirection="column" flexGrow={1}>
      <DiffSkeleton prNumber={prNumber} />
      <FooterKeys keys={footerKeys} />
    </Box>
  )
  if (error) return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <FailureNotice failure={classifyGhFailure(error)} />
      <Text color={t.ui.dim}>[{firstActionKey('list.refresh', 'r')}] retry</Text>
    </Box>
  )

  const colWidth = Math.floor(((stdout?.columns || 80) - 2) / 2)
  // Always reserve COMPOSE_HEIGHT rows so the diff never jumps when compose opens/closes
  const COMPOSE_HEIGHT  = 6
  const effectiveHeight = Math.max(3, visibleHeight - COMPOSE_HEIGHT)
  // No row cap — virtual slice keeps rendering O(visibleHeight) regardless of diff size
  const visibleRows = rows.slice(scrollOffset, scrollOffset + effectiveHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Diff</Text>
        {diffRefreshError && <Text color={t.ci.pending}>⚠ showing cached diff, refresh failed [{firstActionKey('list.refresh', 'r')}] retry</Text>}
        {commentStatus && <Text color={t.ci.pass}>{commentStatus}</Text>}
        {splitView && <Text color={t.ui.muted}>[split]</Text>}
        <Text color={t.ui.dim}>{cursor + 1} / {rows.length}</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {/* File tree side pane — 24 cols, persistent when showTree */}
        {showTree && (
          <Box width={24} flexDirection="column" borderStyle="single" borderColor={t.ui.border} overflow="hidden">
            <Box paddingX={1}>
              <Text color={t.ui.selected} bold>Files </Text>
              <Text color={t.ui.dim}>{files.length}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              {treeRows.map((treeRow, i) => {
                const isTreeSelected = i === treeCursor
                const fileGlyph = treeRow.type === 'dir' ? '▸' : '●'
                return (
                  <Box key={i} backgroundColor={isTreeSelected ? t.ui.headerBg : undefined} paddingX={1}>
                    <Text color={isTreeSelected ? t.ui.selected : (treeRow.type === 'dir' ? t.ui.muted : t.diff.ctxFg)} wrap="truncate">
                      {treeRow.prefix.replace(/[─└├│]/g, c => ({ '─': '─', '└': '└', '├': '├', '│': '│' }[c] || c))}{fileGlyph} {treeRow.name}
                    </Text>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
        {/* Diff content */}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {splitView
            ? renderSplitView(rows, scrollOffset, effectiveHeight, cursor, langCache, colWidth, t)
            : visibleRows.map((row, i) => {
                const idx = scrollOffset + i
                const isSelected = idx === cursor
                const isMatch = findQuery ? findMatches.includes(idx) : false
                const lang = langCache.get(row.filename)
                const lineNum = row.newLine ?? row.oldLine
                const lineKey = `${row.filename}:${lineNum}`
                const hasComment = row.filename && lineNum != null &&
                  commentsByLine.has(lineKey)
                return (
                  <Box key={idx} flexDirection="column">
                    <DiffLine row={row} isSelected={isSelected} lang={lang} isMatch={isMatch} t={t} />
                    {hasComment && (
                      <Box paddingX={1} flexDirection="column" borderStyle="single" borderColor={t.diff.threadBorder}>
                        <CommentThread comments={commentsByLine.get(lineKey)} t={t} />
                      </Box>
                    )}
                  </Box>
                )
              })
          }
        </Box>
      </Box>

      {fileJumpActive && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <FuzzySearch
            items={files.map(f => ({ name: f.filename }))}
            searchFields={['name']}
            onSubmit={(item) => {
              const fileIdx = fileStartIndices[files.findIndex(f => f.filename === item.name)]
              if (fileIdx != null) jumpTo(fileIdx)
              setFileJumpActive(false)
            }}
            onCancel={() => setFileJumpActive(false)}
          />
        </Box>
      )}

      {aiReviewLoading && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={2} marginX={1}>
          <Text color={t.ui.muted}>Analyzing diff with Claude…</Text>
        </Box>
      )}

      {aiReviewError && (
        <Box borderStyle="round" borderColor={t.ci.fail} paddingX={2} marginX={1}>
          <Text color={t.ci.fail}>{aiReviewError}</Text>
        </Box>
      )}

      {aiReview && (
        <AIReviewPane
          suggestions={aiReview.suggestions}
          summary={aiReview.summary}
          provenance={aiReview.secondOpinion}
          onJumpTo={handleAiJumpTo}
          onPost={handleAiPost}
          onClose={() => { setAiReview(null); setAiReviewError(null); setAiPostStatus(null) }}
          postStatus={aiPostStatus}
          onOpenEditor={openEditorSync}
        />
      )}

      {findActive && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <Text color={t.ui.dim}>/</Text>
          <TextInput
            value={findQuery}
            onChange={setFindQuery}
            focus={true}
          />
          <Text color={t.ui.dim}>  {findMatches.length > 0 ? `${findMatches.indexOf(cursor) + 1 || '?'}/${findMatches.length}` : 'no matches'}  [n/N] jump  [Enter] done  [Esc] clear</Text>
        </Box>
      )}
      {!findActive && findQuery && (
        <Box paddingX={2}>
          <Text color={t.ui.dim}>/ {findQuery}  ({findMatches.length} matches)  [n/N] jump  [/] edit  [Esc] clear</Text>
        </Box>
      )}

      {gotoActive && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
          <Text color={t.ui.dim}>:</Text>
          <TextInput
            value={gotoInput}
            onChange={setGotoInput}
            focus={true}
          />
          <Text color={t.ui.dim}>  go to line — [Enter] jump  [Esc] cancel</Text>
        </Box>
      )}

      {compose && (() => {
        const row = rows[cursor]
        if (compose.mode === 'delete') {
          return (
            <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.ci.fail} paddingX={1}>
              <Text color={t.ci.fail} bold>Delete comment?</Text>
              <Text color={t.ui.dim} wrap="truncate">  "{stripAnsi(compose.commentBody || '').slice(0, 70)}"</Text>
              <Text color={t.ui.dim}>[y] confirm  [n / Esc] cancel</Text>
            </Box>
          )
        }
        if (compose.mode === 'reply') {
          return (
            <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.diff.threadBorder} paddingX={1}>
              <Text color={t.ui.muted} bold>Reply to thread</Text>
              <Box>
                <TextInput
                  value={compose.body}
                  onChange={(v) => setCompose(c => ({ ...c, body: v }))}
                  focus={true}
                  placeholder="Type your reply…"
                />
              </Box>
              <Text color={t.ui.dim}>[Ctrl+G] send  [Ctrl+E] editor  [Esc] cancel</Text>
            </Box>
          )
        }
        if (compose.mode === 'edit') {
          return (
            <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.diff.threadBorder} paddingX={1}>
              <Text color={t.ui.muted} bold>Edit comment</Text>
              <TextInput value={compose.body} onChange={(v) => setCompose(c => ({ ...c, body: v }))} focus={true} />
              <Text color={t.ui.dim}>[Ctrl+G] save  [Ctrl+E] editor  [Esc] cancel</Text>
            </Box>
          )
        }
        // mode === 'new'
        return (
          <Box flexDirection="column"
            borderStyle="round" borderColor={t.diff.threadBorder}
            paddingX={1} marginX={1} marginBottom={0}>
            <Box gap={1}>
              <Text color={t.ui.dim}>❯ Line {row?.newLine ?? row?.oldLine}</Text>
              <Text color={t.diff.ctxFg} wrap="truncate">{expandTabs(row?.text || '').slice(0, 60)}</Text>
            </Box>
            <Box gap={3}>
              {COMMENT_TYPES.map(type => {
                const isActive = compose.commentType === type
                return (
                  <Text key={type} color={isActive ? t.ui.selected : t.ui.dim} bold={isActive}>
                    {isActive ? '[' : ' '}{type}{isActive ? ']' : ' '}
                  </Text>
                )
              })}
            </Box>
            <Box>
              {!compose.body && <Text color={t.ui.dim} italic>Type your comment. Ctrl+E for $EDITOR.</Text>}
              <TextInput value={compose.body} onChange={(v) => setCompose(c => ({ ...c, body: v }))} focus={true} />
              {!compose.body && <Text color={t.ui.selected}>▍</Text>}
            </Box>
            <Text color={t.ui.dim}>[Tab] type  [Ctrl+G] submit  [Ctrl+E] editor  [Esc] cancel</Text>
          </Box>
        )
      })()}
      <FooterKeys keys={footerKeys} />
    </Box>
  )
}
