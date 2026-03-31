/**
 * Spinner.jsx — animated braille spinner for loading states
 */

import React, { useState, useEffect } from 'react'
import { Text } from 'ink'
import { useTheme } from '../theme.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function Spinner({ label = '' }) {
  const { t } = useTheme()
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 100)
    return () => clearInterval(id)
  }, [])

  return (
    <Text color={t.ui.muted}>
      {FRAMES[frame]}{label ? ` ${label}` : ''}
    </Text>
  )
}
