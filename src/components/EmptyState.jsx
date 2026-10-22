/**
 * EmptyState.jsx — teaching empty state (#313): says why the list is empty and
 * names the next action as a key. Mockup: docs/mockups/day-one-errors.md §9.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { sanitize } from '../utils.js'

/**
 * @param {object} props
 * @param {string} props.title                        - what is empty and why
 * @param {string} [props.checked]                    - what was checked, e.g. "Checked 14 repositories on github.com."
 * @param {{key: string, label: string}[]} [props.actions] - next actions, key first
 */
export function EmptyState({ title, checked, actions = [] }) {
  const { t } = useTheme()
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color={t.ui.muted}>{sanitize(title)}</Text>
      {checked && <Text color={t.ui.dim}>{sanitize(checked)}</Text>}
      {actions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {actions.map(a => (
            <React.Fragment key={a.key}>
              <Text wrap="truncate-end">
                <Text color={t.ui.selected} bold>{a.key.padEnd(8)}</Text>
                <Text color={t.ui.dim}>{a.label}</Text>
              </Text>
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  )
}
