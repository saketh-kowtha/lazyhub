/**
 * Skeleton.jsx — animated placeholder loaders for every list/detail pane.
 *
 * Each exported component mirrors the exact column layout of its real
 * counterpart so the UI doesn't shift when data arrives.
 *
 * Animation: a single 700ms interval per skeleton component pulses all
 * bars between ░ and ▒ — one setInterval total, not one per bar.
 */

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'

// ─── Pulse hook — one interval per skeleton component ────────────────────────

function usePulse(ms = 700) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => 1 - f), ms)
    return () => clearInterval(id)
  }, [ms])
  return frame
}

// ─── Primitive bar ────────────────────────────────────────────────────────────

function Bar({ width, frame, bold = false }) {
  const { t } = useTheme()
  const ch = frame === 0 ? '░' : '▒'
  return (
    <Text color={t.ui.border} bold={bold}>
      {ch.repeat(Math.max(1, width))}
    </Text>
  )
}

// ─── PR list skeleton ─────────────────────────────────────────────────────────
// Mirrors PRRow: ● ● #nnnnn  [title                ]  @author  time  ci

export function PRListSkeleton({ count = 8 }) {
  const frame = usePulse()
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} paddingX={1} gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={1} frame={frame} />
          <Bar width={6} frame={frame} />
          <Bar width={28 + (i % 3) * 4} frame={frame} />
          <Bar width={10} frame={frame} />
          <Bar width={6} frame={frame} />
          <Bar width={2} frame={frame} />
        </Box>
      ))}
    </>
  )
}

// ─── Issue list skeleton ──────────────────────────────────────────────────────
// Mirrors IssueRow: ● #nnnnn  [title              ]  [label]  @author  time

export function IssueListSkeleton({ count = 8 }) {
  const frame = usePulse()
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} paddingX={1} gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={6} frame={frame} />
          <Bar width={26 + (i % 4) * 5} frame={frame} />
          {i % 3 === 0 && <Bar width={9} frame={frame} />}
          <Bar width={10} frame={frame} />
          <Bar width={5} frame={frame} />
        </Box>
      ))}
    </>
  )
}

// ─── Actions list skeleton ────────────────────────────────────────────────────
// Mirrors ActionRow: ● [workflow name            ]  branch  time

export function ActionListSkeleton({ count = 8 }) {
  const frame = usePulse()
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} paddingX={1} gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={24 + (i % 3) * 6} frame={frame} />
          <Bar width={12} frame={frame} />
          <Bar width={6} frame={frame} />
        </Box>
      ))}
    </>
  )
}

// ─── Branch list skeleton ─────────────────────────────────────────────────────
// Mirrors BranchRow: [name              ]  ↑0 ↓0

export function BranchListSkeleton({ count = 8 }) {
  const frame = usePulse()
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} paddingX={1} gap={1}>
          <Bar width={20 + (i % 4) * 5} frame={frame} />
          <Bar width={6} frame={frame} />
        </Box>
      ))}
    </>
  )
}

// ─── Notification list skeleton ───────────────────────────────────────────────
// Mirrors notification row: icon  repo  [title                ]  reason  time

export function NotificationListSkeleton({ count = 8 }) {
  const frame = usePulse()
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} paddingX={1} gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={12} frame={frame} />
          <Bar width={22 + (i % 4) * 4} frame={frame} />
          <Bar width={8} frame={frame} />
          <Bar width={5} frame={frame} />
        </Box>
      ))}
    </>
  )
}

// ─── Issue detail skeleton ────────────────────────────────────────────────────
// Mirrors IssueDetail: bordered header (state + title + author/time) → labels → body → comments

export function IssueDetailSkeleton() {
  const { t } = useTheme()
  const frame = usePulse()
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header box */}
      <Box marginBottom={1} flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Box gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={40} frame={frame} bold />
        </Box>
        <Box gap={2} marginTop={0}>
          <Bar width={12} frame={frame} />
          <Bar width={8} frame={frame} />
        </Box>
      </Box>

      {/* Labels */}
      <Box gap={1}>
        <Bar width={8} frame={frame} />
        <Bar width={10} frame={frame} />
      </Box>

      {/* Description header */}
      <Box marginTop={1}>
        <Bar width={12} frame={frame} bold />
      </Box>
      {/* Description body lines */}
      {[36, 40, 28, 38, 30].map((w, i) => (
        <Box key={i} marginTop={i === 0 ? 1 : 0}>
          <Bar width={w} frame={frame} />
        </Box>
      ))}

      {/* Comments header */}
      <Box marginTop={1}>
        <Bar width={14} frame={frame} bold />
      </Box>
      {[0, 1].map(j => (
        <Box key={j} flexDirection="column" paddingX={1} marginTop={1}>
          <Box gap={1}>
            <Bar width={12} frame={frame} />
            <Bar width={8} frame={frame} />
          </Box>
          {[34, 28].map((w, i) => (
            <Box key={i}>
              <Bar width={w} frame={frame} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

// ─── PR detail skeleton ───────────────────────────────────────────────────────
// Mirrors the PR detail fixed header + metadata sections

export function PRDetailSkeleton() {
  const { t } = useTheme()
  const frame = usePulse()
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Fixed title header */}
      <Box flexDirection="column" paddingX={1} paddingY={0}
        borderStyle="single" borderColor={t.ui.border}
        borderTop={false} borderLeft={false} borderRight={false} borderBottom={true}>
        <Box gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={5} frame={frame} />
          <Bar width={36} frame={frame} bold />
        </Box>
        <Box gap={1} marginTop={0}>
          <Bar width={10} frame={frame} />
          <Bar width={6} frame={frame} />
          <Bar width={12} frame={frame} />
          <Bar width={8} frame={frame} />
          <Bar width={8} frame={frame} />
        </Box>
      </Box>

      {/* Assignees row */}
      <Box paddingX={1} gap={1} marginTop={1}>
        <Bar width={8} frame={frame} />
        <Bar width={10} frame={frame} />
      </Box>

      {/* Labels row */}
      <Box paddingX={1} gap={1}>
        <Bar width={7} frame={frame} />
        <Bar width={9} frame={frame} />
        <Bar width={11} frame={frame} />
      </Box>

      {/* Reviewers section */}
      <Box paddingX={1} marginTop={1}>
        <Bar width={9} frame={frame} bold />
      </Box>
      {[14, 12].map((w, i) => (
        <Box key={i} paddingX={2} gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={w} frame={frame} />
        </Box>
      ))}

      {/* Checks section */}
      <Box paddingX={1} marginTop={1} gap={2}>
        <Bar width={6} frame={frame} bold />
        <Bar width={4} frame={frame} />
        <Bar width={4} frame={frame} />
      </Box>
      {[22, 18, 20].map((w, i) => (
        <Box key={i} paddingX={2} gap={1}>
          <Bar width={1} frame={frame} />
          <Bar width={w} frame={frame} />
        </Box>
      ))}

      {/* Merge status */}
      <Box paddingX={1} marginTop={1} gap={2}>
        <Bar width={5} frame={frame} bold />
        <Bar width={16} frame={frame} />
      </Box>

      {/* Description */}
      <Box paddingX={1} marginTop={1}>
        <Bar width={11} frame={frame} bold />
      </Box>
      {[38, 32, 40, 28, 35].map((w, i) => (
        <Box key={i} paddingX={1} marginTop={i === 0 ? 1 : 0}>
          <Bar width={w} frame={frame} />
        </Box>
      ))}
    </Box>
  )
}
