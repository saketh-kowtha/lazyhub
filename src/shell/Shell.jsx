/**
 * Shell.jsx — the one frame every app view renders inside (#488).
 *
 * It owns the AppContext provider, the full-height column, the optional sidebar, the status bar,
 * the footer keys, the leader hint and the toaster. A view supplies only its body and the few
 * facts that differ (status text, footer keys, sidebar select handler), so the layout is defined
 * here once instead of per view branch in app-views.jsx.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { AppContext } from '../context.js'
import { Sidebar } from '../components/Sidebar.jsx'
import { StatusBar } from '../components/StatusBar.jsx'
import { FooterKeys } from '../components/FooterKeys.jsx'
import { Toaster } from '../components/Toaster.jsx'
import { ErrorBoundary } from '../components/ErrorBoundary.jsx'
import { useTheme } from '../theme.js'

/**
 * @param {object} props
 * @param {object} props.appCtx value for AppContext
 * @param {number} props.rows terminal rows
 * @param {'hidden' | 'visible'} [props.overflow] overflow of the outer column
 * @param {object | null} [props.sidebar] Sidebar props (without height); null for no sidebar
 * @param {boolean} [props.sidebarBoundary] wrap the sidebar in its own error boundary
 * @param {boolean} props.compactFooter whether the footer is the one-row compact form
 * @param {object} [props.bodyProps] extra props for the body Box (flexDirection, overflow, alignment); null renders the children with no body box
 * @param {React.ReactNode} [props.header] rendered above the body (compact tab strip)
 * @param {object | null} [props.status] StatusBar props; null renders no status bar
 * @param {Array<{key: string, label: string}> | null} [props.footer] footer keys; null renders no footer
 * @param {React.ReactNode} [props.leaderHint] row shown between the body and the status bar
 * @param {Array<object>} [props.toasts] toasts to draw; omit to draw none
 * @param {React.ReactNode} props.children the view body, drawn right of the sidebar
 * @returns {React.ReactElement} the framed view
 */
export function Shell({
  appCtx, rows, overflow, sidebar = null, sidebarBoundary = false, compactFooter, bodyProps = {},
  header = null, status = null, footer = null, leaderHint = null, toasts, children,
}) {
  const sidebarEl = sidebar && (
    <Sidebar {...sidebar} height={rows - (compactFooter ? 2 : 3)} />
  )
  return (
    <AppContext.Provider value={appCtx}>
      <Box flexDirection="column" height={rows} overflow={overflow}>
        {header}
        {bodyProps === null ? children : (
          <Box flexDirection="row" flexGrow={1} {...bodyProps}>
            {sidebarBoundary && sidebarEl ? <ErrorBoundary section="Sidebar">{sidebarEl}</ErrorBoundary> : sidebarEl}
            {children}
          </Box>
        )}
        {leaderHint}
        {status && <StatusBar {...status} />}
        {footer && <FooterKeys hidden={compactFooter} keys={footer} />}
        {toasts && toasts.length > 0 && <Toaster toasts={toasts} />}
      </Box>
    </AppContext.Provider>
  )
}

/**
 * The which-key style hint shown while the <Space> leader is armed.
 * @param {{ text: string }} props hint text
 * @returns {React.ReactElement} the hint row
 */
export function LeaderHint({ text }) {
  const { t } = useTheme()
  return (
    <Box paddingX={2} paddingY={0}>
      <Text color={t.ui.selected} bold>{'<Space> '}</Text>
      <Text color={t.ui.dim}>{text}  (1.5s)</Text>
    </Box>
  )
}
