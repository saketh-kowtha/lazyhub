/**
 * src/components/ErrorBoundary.jsx — catches render crashes, logs them, shows a minimal error box.
 */

// @ts-nocheck
// TODO(#197): class component props/state need explicit React typedefs.
import React from 'react'
import { Box, Text } from 'ink'
import { useInput } from '../hooks/useSafeInput.js'
import { logger } from '../utils.js'
import { useTheme } from '../theme.js'

function ErrorDisplay({ title, onDismiss, onReset }) {
  const { t } = useTheme()
  useInput((input, key) => {
    if (input === 'r') onReset()
    else if (key.escape || key.return || input === 'q') onDismiss()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ci.fail} paddingX={2} paddingY={1}>
      <Text color={t.ci.fail} bold>⚠ Something went wrong</Text>
      <Text color={t.ui.muted}>{title}</Text>
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[r] reset this view  [Enter / Esc] dismiss</Text>
      </Box>
    </Box>
  )
}

/** One quiet line for a section (sidebar, header) that crashed on its own; the rest of the screen stays live. */
function SectionFallback({ label }) {
  const { t } = useTheme()
  return <Text color={t.ci.fail}>⚠ {label} unavailable (see the log)</Text>
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorTitle: '', resetKey: 0 }
    this.handleDismiss = this.handleDismiss.bind(this)
    this.handleReset = this.handleReset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorTitle: error?.message || 'Unknown error' }
  }

  componentDidCatch(error, info) {
    logger.error('Component crash caught by ErrorBoundary', error, {
      component: 'ErrorBoundary',
      section: this.props.section,
      componentStack: info?.componentStack?.split('\n').slice(0, 3).join(' '),
    })
  }

  // Dismiss re-renders the same subtree (it may crash again); reset remounts it with fresh state.
  handleDismiss() {
    this.setState({ hasError: false, errorTitle: '' })
  }

  handleReset() {
    this.setState(state => ({ hasError: false, errorTitle: '', resetKey: state.resetKey + 1 }))
  }

  render() {
    if (this.state.hasError && this.props.section) {
      return <SectionFallback label={this.props.section} />
    }
    if (this.state.hasError) {
      return <ErrorDisplay title={this.state.errorTitle} onDismiss={this.handleDismiss} onReset={this.handleReset} />
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>
  }
}
