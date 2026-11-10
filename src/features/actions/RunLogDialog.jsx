/**
 * src/features/actions/RunLogDialog.jsx — a workflow run's log, on the derived render mode (V4b, #597).
 *
 * Reads the log (and, for a failed run, its failure excerpt, #463) through two queries keyed by run id
 * + attempt (run-log.js). Opened from the cache it draws at once with no gh call. The body is chosen by
 * the mode, never by a loading flag: nothing new for the first 150 ms, then the spinner, then the viewer.
 */

import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { useGh } from '../../hooks/useGh.js'
import { useInput } from '../../hooks/useSafeInput.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { deriveRenderMode } from '../../data/renderMode.js'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { matchesAction } from '../../config/actions.js'
import { toLogLines, logTitle } from './log-lines.js'
import { getRunLogsAt, loadRunFailureExcerpt, runLogKey, runLogFreshness, ExcerptUnavailable } from './run-log.js'

/**
 * @param {object} props
 * @param {string} props.repo
 * @param {object} props.run     the run as it was when the dialog opened
 * @param {boolean} props.failed open on the failure excerpt
 * @param {() => void} props.onClose
 */
export function RunLogDialog({ repo, run, failed, onClose }) {
  const key = runLogKey(run)
  const opts = runLogFreshness(run)
  const log = useGh(getRunLogsAt, [repo, ...key], opts)
  const excerpt = useGh(loadRunFailureExcerpt, [repo, ...key], { ...opts, enabled: failed })

  const settled = (q) => q.data != null || Boolean(q.error)
  const ready = settled(log) && (!failed || settled(excerpt))
  const mode = deriveRenderMode({
    data: ready ? true : null, error: null, isLoading: true,
    skeletonDue: Boolean(log.skeletonDue || excerpt.skeletonDue),
  })

  const lines = useMemo(
    () => (log.data != null ? toLogLines(log.data) : log.error ? [`Error loading logs: ${log.error.message}`] : []),
    [log.data, log.error],
  )
  const excerptState = useMemo(() => {
    if (!failed) return null
    if (excerpt.data != null) return excerpt.data
    if (!excerpt.error) return null
    const result = excerpt.error instanceof ExcerptUnavailable ? excerpt.error.result : null
    return { state: result?.state || 'unavailable', detail: result?.detail || 'Could not fetch the failed-step log', excerpt: null }
  }, [failed, excerpt.data, excerpt.error])

  if (mode === 'data') {
    return <LogViewer title={logTitle(run)} lines={lines} excerpt={excerptState} onClose={onClose} />
  }
  return <RunLogWaiting skeleton={mode === 'skeleton'} onClose={onClose} />
}

// Esc leaves while the log is still on its way (the viewer owns its own keys once it shows).
function RunLogWaiting({ skeleton, onClose }) {
  const { t } = useTheme()
  useKeyScope('dialog')
  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) onClose()
  })
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {skeleton ? <Box gap={1}><Spinner /><Text color={t.ui.muted}>Loading logs…</Text></Box> : null}
    </Box>
  )
}
