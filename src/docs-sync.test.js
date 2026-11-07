/**
 * docs-sync.test.js — docs that restate the runtime fail CI when they drift (#516, #489).
 * Only machine-checkable facts live here: the MCP tool tables in docs/CONTRACT.md against
 * the adapter, and the invariant wording shared by AGENTS.md and ARCHITECT_DECISIONS.md.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MUTATING_TOOLS, TOOLS, TOOL_ALIASES } from './daemon/mcp-adapter.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/**
 * Backticked names in the first `columns` cells of each row of the markdown table that follows `heading`.
 * @param {string} text
 * @param {string} heading line that introduces the table
 * @param {number} columns how many leading cells to read
 */
function tableNames(text, heading, columns) {
  const start = text.indexOf(heading)
  if (start < 0) throw new Error(`missing "${heading}" in CONTRACT.md`)
  const rows = []
  for (const line of text.slice(start + heading.length).split('\n').slice(1)) {
    if (!line.startsWith('|')) { if (rows.length) break; continue }
    if (/^\|\s*-/.test(line) || /^\|\s*Tool\s*\|/.test(line)) continue
    rows.push(line.split('|').slice(1, 1 + columns).join(' '))
  }
  return new Set(rows.flatMap(cell => [...cell.matchAll(/`([a-z_]+)`/g)].map(m => m[1])))
}

describe('docs/CONTRACT.md MCP tables match the adapter (#516)', () => {
  const contract = read('docs/CONTRACT.md')

  it('the advertised table lists exactly the advertised read-only tools', () => {
    expect(tableNames(contract, 'Advertised tools (all read-only):', 1)).toEqual(new Set(TOOLS.map(t => t.name)))
  })

  it('no advertised tool is a mutating one', () => {
    for (const tool of TOOLS) expect(MUTATING_TOOLS.has(TOOL_ALIASES[tool.name] || tool.name), tool.name).toBe(false)
  })

  it('the refused table lists every mutating tool and alias, and nothing else', () => {
    const refused = new Set([...MUTATING_TOOLS, ...Object.entries(TOOL_ALIASES).filter(([, to]) => MUTATING_TOOLS.has(to)).map(([from]) => from)])
    expect(tableNames(contract, 'Names that are recognised but always refused', 2)).toEqual(refused)
  })
})

describe('invariant wording agrees across the authority docs (#516)', () => {
  it('AGENTS.md invariant 4 curates the env for AI subprocesses only and says gh inherits its environment', () => {
    const agents = read('AGENTS.md')
    const decisions = read('docs/ARCHITECT_DECISIONS.md')
    expect(decisions).toMatch(/Curated env for AI subprocesses/)
    expect(agents).toMatch(/Curated env for AI subprocesses/)
    expect(agents).not.toMatch(/Curated env for AI\/gh subprocesses/)
    expect(agents).toMatch(/inherits the user's `gh` environment/)
  })

  it('SECURITY.md does not claim AI is off by default', () => {
    expect(read('SECURITY.md')).not.toMatch(/AI features are off by default/)
  })
})
