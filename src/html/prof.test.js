import { it } from 'vitest'
import { parseSegment } from './parse.js'
import { layout } from './layout.js'
import { linesToRows } from './rows.jsx'
import { getMarkdownRows } from '../utils.js'
import { newBudget, LIMITS } from './types.js'
const theme = { ui: { selected: 'cyan', muted: 'grey', dim: 'grey', headerBg: 'blue', border: 'grey' }, ci: { pending: 'yellow' } }
const run = (name, unit) => {
  const body = unit.repeat(Math.ceil(LIMITS.MAX_BYTES / unit.length)).slice(0, LIMITS.MAX_BYTES)
  for (let k = 0; k < 4; k++) {
    const t1 = performance.now()
    const tree = parseSegment(body, { budget: newBudget() })
    const t2 = performance.now()
    const lines = layout(tree.children, { width: 76, base: 'https://github.com/', md: false, st0: {} })
    const t3 = performance.now()
    const rows = linesToRows(lines, theme, 'k')
    const t4 = performance.now()
    getMarkdownRows(body, 76, theme)
    const t5 = performance.now()
    if (k === 3) console.log('PROF', name, 'parse', (t2 - t1).toFixed(1), 'layout', (t3 - t2).toFixed(1), 'rows', (t4 - t3).toFixed(1), 'total', (t5 - t4).toFixed(1), lines.length, rows.length)
  }
}
it('prof', () => {
  run('links', '<a href="https://a.com/x">t</a> text ')
  run('bold', '<b>x</b> text ')
  run('plain', 'word word word word ')
  run('ent', '&#9999999999; ')
  run('mix', '<b>x</b>&#9999999999;<!-- c --><a href="https://a.com/x">t</a> text ')
})
