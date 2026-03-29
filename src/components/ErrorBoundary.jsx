/**
 * src/components/ErrorBoundary.jsx — catches render crashes, logs them, shows a minimal error box.
 */

import React from 'react'
import { Box, Text, useInput } from 'ink'
import { logger } from '../utils.js'

function ErrorDisplay({ title, onDismiss }) {
  useInput((input, key) => {
    if (key.escape || key.return || input === 'q') onDismiss()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#f85149" paddingX={2} paddingY={1}>
      <Text color="#f85149" bold>⚠ Something went wrong</Text>
      <Text color="#8b949e">{title}</Text>
      <Box marginTop={1}>
        <Text color="#484f58">[Enter / Esc] dismiss</Text>
      </Box>
    </Box>
  )
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorTitle: '' }
    this.handleDismiss = this.handleDismiss.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorTitle: error?.message || 'Unknown error' }
  }

  componentDidCatch(error, info) {
    logger.error('Component crash caught by ErrorBoundary', error, {
      component: 'ErrorBoundary',
      componentStack: info?.componentStack?.split('\n').slice(0, 3).join(' '),
    })
  }

  handleDismiss() {
    this.setState({ hasError: false, errorTitle: '' })
  }

  render() {
    if (this.state.hasError) {
      return <ErrorDisplay title={this.state.errorTitle} onDismiss={this.handleDismiss} />
    }
    return this.props.children
  }
}
