/**
 * Toaster.jsx — transient notification stack, max 3, bottom-right.
 * Variants: success (2.5s), info (3s), warning (4s), error (sticky).
 * Usage: call useToast() hook to get { toast } function.
 *   toast({ message, variant: 'success'|'info'|'warning'|'error' })
 */

import React, { useContext, useCallback } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { AppContext } from '../context.js'

const VARIANT_GLYPH = {
  success: '✓',
  info:    'ℹ',
  warning: '⚠',
  error:   '✗',
}

function variantColor(variant, t) {
  switch (variant) {
    case 'success': return t.ci.pass
    case 'info':    return t.ui.selected
    case 'warning': return t.ci.pending
    case 'error':   return t.ci.fail
    default:        return t.ui.muted
  }
}

export function Toaster({ toasts = [] }) {
  const { t } = useTheme()
  if (toasts.length === 0) return null

  return (
    <Box flexDirection="column" alignItems="flex-end">
      {toasts.slice(-3).map(toast => {
        const clr   = variantColor(toast.variant, t)
        const glyph = VARIANT_GLYPH[toast.variant] || 'ℹ'
        return (
          <Box
            key={toast.id}
            borderStyle="single"
            borderColor={clr}
            paddingX={1}
            marginTop={0}
          >
            <Text color={clr} bold>{glyph} </Text>
            <Text color={t.ui.muted}>{toast.message}</Text>
            {toast.variant === 'error' && (
              <Text color={t.ui.dim}> (any key)</Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// Hook for consuming toasts from context
export function useToast() {
  const ctx = useContext(AppContext)
  const toast = useCallback((opts) => {
    if (ctx.addToast) ctx.addToast(opts)
  }, [ctx])
  return { toast }
}
