/**
 * Spinner.jsx — animated braille spinner for loading states.
 *
 * A leaf: the frame state lives in the shared animation slot (src/ui/animation.js), so a tick
 * re-renders only this component, never its parent or any list row. Only one animated element
 * is on screen at a time; a second spinner draws a static frame.
 */

import React from 'react'
import { Text } from 'ink'
import { useTheme } from '../theme.js'
import { useAnimationFrame } from '../ui/animation.js'

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function Spinner({ label = '' }) {
  const { t } = useTheme()
  const frame = useAnimationFrame(SPINNER_FRAMES.length)

  return (
    <Text color={t.ui.muted}>
      {SPINNER_FRAMES[frame < 0 ? 0 : frame]}{label ? ` ${label}` : ''}
    </Text>
  )
}
