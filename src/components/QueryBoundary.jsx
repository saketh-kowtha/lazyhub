/**
 * src/components/QueryBoundary.jsx — one loading / empty / failure rendering for a query (R8, #486).
 *
 *   <QueryBoundary query={q} skeleton={<Skeleton/>} empty="No notifications.">
 *     {(data) => rows}
 *   </QueryBoundary>
 *
 * Rules: a failure is never rendered as empty (#444: the cause comes from classifyGhFailure);
 * the skeleton shows only while there is nothing to show; stale rows stay visible under a
 * failure notice so a refetch error does not blank the list. `footer` (optional) draws below
 * the rows, before the failure notice.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { classifyGhFailure } from '../executor.js'
import { firstActionKey } from '../config/actions.js'
import { FailureNotice } from './FailureNotice.jsx'

function defaultIsEmpty(data) { return Array.isArray(data) && data.length === 0 }

/**
 * @param {object} props
 * @param {{ data: any, loading: boolean, error: any }} props.query
 * @param {React.ReactNode} [props.skeleton]
 * @param {React.ReactNode} [props.empty]  node or string; a string gets the refresh hint appended
 * @param {(data: any) => boolean} [props.isEmpty]
 * @param {React.ReactNode} [props.footer]
 * @param {(data: any) => React.ReactNode} props.children
 */
export function QueryBoundary({ query, skeleton = null, empty = 'Nothing here.', isEmpty = defaultIsEmpty, footer = null, children }) {
  const { t } = useTheme()
  const { data, loading, error } = query
  const hasData = data != null && !isEmpty(data)
  const retry = firstActionKey('list.refresh', 'r')
  return (
    <>
      {loading && !hasData && skeleton}
      {hasData && children(data)}
      {hasData && !error && footer}
      {error && (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <FailureNotice failure={classifyGhFailure(error)} />
          <Text color={t.ui.dim}>[{retry}] retry</Text>
        </Box>
      )}
      {!loading && !error && !hasData && (
        typeof empty === 'string'
          ? <Box paddingX={2} paddingY={1}><Text color={t.ui.muted}>{empty} [{retry}] refresh</Text></Box>
          : empty
      )}
    </>
  )
}
