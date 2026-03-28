import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { getMarkdownRows, TextInput } from './utils.js'

describe('getMarkdownRows', () => {
  it('should render headers correctly', () => {
    const rows = getMarkdownRows('# Header 1\n## Header 2')
    expect(rows).toHaveLength(2)
    // Header 1 is uppercase
    expect(rows[0].props.children.props.children).toBe('HEADER 1')
    expect(rows[1].props.children.props.children).toBe('Header 2')
  })

  it('should render list items', () => {
    const rows = getMarkdownRows('* item 1\n- item 2')
    expect(rows).toHaveLength(2)
    expect(rows[0].props.children[0].props.children).toBe('• ')
  })
})

describe('TextInput', () => {
  it('should render value and placeholder', () => {
    const { lastFrame } = render(
      React.createElement(TextInput, { value: 'hello', focus: true })
    )
    expect(lastFrame()).toContain('hello')
  })

  it('should render placeholder when empty and not focused', () => {
    const { lastFrame } = render(
      React.createElement(TextInput, { value: '', placeholder: 'type here', focus: false })
    )
    expect(lastFrame()).toContain('type here')
  })
})
