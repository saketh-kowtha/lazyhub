/**
 * Monogram.jsx — [XX] author initial badge with hash-based color.
 * Props: login (string)
 */

import React from 'react'
import { Text } from 'ink'
import { authorColor } from '../utils.js'

export function Monogram({ login }) {
  if (!login) return <Text>[??]</Text>
  const initials = login.slice(0, 2).toUpperCase()
  const color = authorColor(login)
  return <Text color={color} bold>[{initials}]</Text>
}
