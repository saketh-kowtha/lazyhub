import { describe, it, expect } from 'vitest'
import { generateConfigReferenceMarkdown, getConfigDocumentationModel } from './docs.js'
import { DEFAULT_CONFIG } from './schema.js'

describe('config docs metadata', () => {
  it('builds a structured model from TOML metadata', () => {
    const model = getConfigDocumentationModel(DEFAULT_CONFIG)
    expect(model.panes.find(p => p.id === 'prs')).toMatchObject({
      label: 'Pull Requests',
      description: 'Review and manage pull requests',
    })
    expect(model.actions.find(a => a.id === 'pr.merge')).toMatchObject({
      keys: ['m'],
      label: 'merge',
      scope: 'pr-list',
    })
  })

  it('generates markdown from runtime metadata', () => {
    const markdown = generateConfigReferenceMarkdown(DEFAULT_CONFIG)
    expect(markdown).toContain('# lazyhub TOML Configuration Reference')
    expect(markdown).toContain('| prs | ⎇ | Pull Requests | Review and manage pull requests |')
    expect(markdown).toContain('| pr.merge | m | merge | pr-list | Merge selected PR |')
  })
})
