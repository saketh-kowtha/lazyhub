/**
 * src/components/QueryBoundary.jsx — one loading / empty / failure rendering for a query (R8, #486).
 *
 *   <QueryBoundary query={q} skeleton={<Skeleton/>} empty="No notifications.">
 *     {(data) => rows}
 *   </QueryBoundary>
 *
 * The body is chosen by the derived render mode (src/data/renderMode.js), never by `loading`:
 *   skeleton  no data and the request has been pending >= 150 ms (`query.skeletonDue`)
 *   pending   no data yet, still inside the delay: nothing new is drawn
 *   data      rows, whatever is fetching or failing; a failure under rows is ONE line
 *   empty     a settled, successful, empty result
 *   error     a failure and no rows to keep
 * A failure is never rendered as empty (#444: the cause comes from classifyGhFailure). `footer`
 * (optional) draws below the rows. A `query` without `skeletonDue` (a plain object) shows the
 * skeleton at once. Background activity is not drawn here: it belongs in the header cell.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { classifyGhFailure } from '../executor.js'
import { firstActionKey } from '../config/actions.js'
import { FailureNotice } from './FailureNotice.jsx'
import { deriveRenderMode, defaultIsEmpty } from '../data/renderMode.js'

/**
 * @param {object} props
 * @param {{ data: any, loading?: boolean, isLoading?: boolean, skeletonDue?: boolean, error: any }} props.query
 * @param {React.ReactNode} [props.skeleton]
 * @param {React.ReactNode} [props.empty]  node or string; a string gets the refresh hint appended
 * @param {(data: any) => boolean} [props.isEmpty]
 * @param {React.ReactNode} [props.footer]
 * @param {(data: any) => React.ReactNode} props.children
 */
export function QueryBoundary({ query, skeleton = null, empty = 'Nothing here.', isEmpty = defaultIsEmpty, footer = null, children }) {
  const { t } = useTheme()
  const { data, error } = query
  const isLoading = query.isLoading ?? query.loading
  const mode = deriveRenderMode({ data, error, isLoading: Boolean(isLoading), skeletonDue: query.skeletonDue }, isEmpty)
  const retry = firstActionKey('list.refresh', 'r')
  if (mode === 'skeleton') return <>{skeleton}</>
  if (mode === 'pending') return null
  if (mode === 'data') {
    return (
      <>
        {children(data)}
        {error
          ? <Box><FailureNotice failure={classifyGhFailure(error)} compact /><Text color={t.ui.dim}>  [{retry}] retry</Text></Box>
          : footer}
      </>
    )
  }
  if (mode === 'error') {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column">
        <FailureNotice failure={classifyGhFailure(error)} />
        <Text color={t.ui.dim}>[{retry}] retry</Text>
      </Box>
    )
  }
  return typeof empty === 'string'
    ? <Box paddingX={2} paddingY={1}><Text color={t.ui.muted}>{empty} [{retry}] refresh</Text></Box>
    : empty
}
