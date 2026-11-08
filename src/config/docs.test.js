import { describe, it, expect } from 'vitest'
import { generateConfigReferenceMarkdown, table, getConfigDocumentationModel } from './docs.js'
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
      scope: 'pr-list,pr-detail,diff',
    })
  })

  it('generates markdown from runtime metadata', () => {
    const markdown = generateConfigReferenceMarkdown(DEFAULT_CONFIG)
    expect(markdown).toContain('# lazyhub TOML Configuration Reference')
    expect(markdown).toContain('| prs | ⎇ | Pull Requests | Review and manage pull requests |')
    expect(markdown).toContain('| pr.merge | m | merge | pr-list,pr-detail,diff | Merge selected PR |')
  })

  it('escapes backslashes before pipes so a cell cannot break out of its column', () => {
    const out = table(['h'], [['a\\|b'], ['x|y'], ['plain']])
    expect(out.split('\n')[2]).toBe('| a\\\\\\|b |')
    expect(out.split('\n')[3]).toBe('| x\\|y |')
    // every row keeps exactly one unescaped column: no bare pipe inside a cell
    for (const row of out.split('\n').slice(2)) expect(row.slice(2, -2).replace(/\\./g, '')).not.toContain('|')
  })
})
