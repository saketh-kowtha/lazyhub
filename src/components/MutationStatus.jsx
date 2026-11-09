/**
 * src/components/MutationStatus.jsx — the one-line write status from useMutation (R8, #486).
 * Pending and success show in the pass colour, a failure in the fail colour with "[any key]".
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { sanitizeRaw } from '../utils.js'

/** @param {{ status: { msg: string, isError: boolean, persist: boolean } | null }} props */
export function MutationStatus({ status }) {
  const { t } = useTheme()
  if (!status) return null
  return (
    <Box paddingX={1}>
      <Text color={status.isError ? t.ci.fail : t.ci.pass}>{sanitizeRaw(status.msg)}{status.persist ? ' [any key]' : ''}</Text>
    </Box>
  )
}
