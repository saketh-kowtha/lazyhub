/**
 * ActivityIndicator.jsx — the one place background work is shown (#597, lazy-update model 2.1).
 *
 * A fixed-width cell for the header/status line. It ALWAYS renders `width` columns (blank when
 * idle), so turning it on or off can never shift the layout around it. It is a leaf: its tick
 * state lives in the shared animation slot, so animating never re-renders the view that hosts it.
 *
 * API:
 *   <ActivityIndicator active={query.isFetching} />                  // 2 columns: glyph + padding
 *   <ActivityIndicator active={busy} width={12} label="syncing" />   // glyph + label, clipped to width
 *
 * Props:
 *   active  boolean  background activity is in flight (revalidate, refetch, page load)
 *   width   number   total columns reserved, default 2
 *   label   string   optional text after the glyph; clipped to fit `width`, never wider
 *
 * Views pass `isFetching` here instead of rendering "refreshing..." rows. Only one animated
 * element is on screen: if a Spinner already animates, this draws a static dot.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { useAnimationFrame } from '../ui/animation.js'
import { SPINNER_FRAMES } from './Spinner.jsx'
import { fitCell } from '../ui/row-layout.js'

export const ACTIVITY_DEFAULT_WIDTH = 2
const STATIC_GLYPH = '·'

/** @param {{ active: boolean, width?: number, label?: string }} props */
export function ActivityIndicator({ active, width = ACTIVITY_DEFAULT_WIDTH, label = '' }) {
  const { t } = useTheme()
  const w = Math.max(1, Math.floor(width))
  const frame = useAnimationFrame(SPINNER_FRAMES.length, !!active)
  const glyph = frame < 0 ? STATIC_GLYPH : SPINNER_FRAMES[frame]
  const text = active ? fitCell(label ? `${glyph} ${label}` : glyph, w) : ' '.repeat(w)
  return (
    <Box width={w} flexShrink={0}>
      <Text color={t.ui.muted}>{text}</Text>
    </Box>
  )
}
