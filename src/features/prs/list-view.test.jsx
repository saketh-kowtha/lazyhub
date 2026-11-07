import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { Box } from 'ink'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders } from '../../test/test-helpers.jsx'
import { PRListView } from './list-view.jsx'
import { PRRow } from './list-row.jsx'
import { resolveTheme } from '../../theme.js'

afterEach(cleanup)

const t = resolveTheme('github-dark')
const filler = 'x'.repeat(44)
const pr = (number, marker, login = 'maria-lopez') => ({
  number,
  title: `${marker}${filler}`,
  state: 'OPEN',
  updatedAt: new Date().toISOString(),
  author: { login },
  body: 'body',
})

function renderList(cols, items, cursor, extra = {}) {
  const { lastFrame } = renderWithProviders(
    <Box height={24} width={cols}><PRListView
      items={items} loading={false} error={null}
      filterStates={new Set(['open'])} scope="all" sortMode="newest" authorFilter={null}
      statusMsg={null} config={{ pageSize: 30 }}
      filterKeys={{ filterOpen: 'O', filterClosed: 'C', filterMerged: 'M' }}
      t={t} height={20} effectiveHeight={20}
      visiblePRs={items} scrollOffset={0} cursor={cursor}
      innerWidth={cols - 4} termCols={cols} termRows={40}
      selectedPR={items[cursor]} dialog={null}
      popoverDismissed={false} setPopoverDismissed={() => {}}
      expansionEnabled={false}
      {...extra}
    /></Box>,
  )
  return lastFrame()
}

const six = () => [
  pr(1, 'AAAAAA'), pr(2, 'SELECTED'), pr(3, 'BBBBBB'),
  pr(4, 'CCCCCC'), pr(5, 'DDDDDD'), pr(6, 'EEEEEE'),
]
const MARKERS = ['AAAAAA', 'SELECTED', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE']

describe('PR list preview panel (#461)', () => {
  it('sits beside the list on a wide terminal and never covers a row', () => {
    const frame = renderList(170, six(), 1)
    expect(frame).toContain('unresolved') // panel rendered
    for (const marker of MARKERS) expect(frame).toContain(marker)
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(170)
  })

  for (const cols of [80, 100]) {
    it(`keeps every row fully visible at ${cols} cols, where the panel does not fit beside the list`, () => {
      const frame = renderList(cols, six(), 1)
      expect(frame).not.toContain('unresolved')
      for (const marker of MARKERS) expect(frame).toContain(marker)
    })
  }

  it('stays hidden once dismissed', () => {
    const frame = renderList(170, six(), 3, { popoverDismissed: true })
    expect(frame).not.toContain('unresolved')
    for (const marker of MARKERS) expect(frame).toContain(marker)
  })
})

describe('PR list preview details (#461, #508)', () => {
  it('shows the focused PR full title in the status line while the panel is hidden', () => {
    const items = six()
    items[1].title = 'A very descriptive title that the narrow row would cut off'
    const frame = renderList(170, items, 1, { popoverDismissed: true })
    expect(frame).toContain('#2 A very descriptive title that the narrow row would cut off')
  })

  it('says "preview unavailable" instead of loading forever when the preview fetch failed', () => {
    const items = six()
    const frame = renderList(170, items, 1, { selectedPR: { ...items[1], body: undefined, previewError: true } })
    expect(frame).toContain('preview unavailable')
    expect(frame).not.toContain('loading…')
  })

  it('shows loading… only while the preview is on its way', () => {
    const items = six()
    expect(renderList(170, items, 1, { selectedPR: { ...items[1], body: undefined } })).toContain('loading…')
  })

  it('honours [layout].preview_width for the panel', () => {
    const narrow = renderList(170, six(), 1, { previewWidth: 40 })
    const wide = renderList(170, six(), 1, { previewWidth: 70 })
    const top = (frame) => frame.split('\n').map(l => (l.match(/╭─+╮/) || [''])[0].length).find(n => n > 0)
    expect(top(narrow)).toBe(40)
    expect(top(wide)).toBe(70)
  })
})

describe('PR list paging footer (#508)', () => {
  const paging = (over) => ({ hasMore: true, total: 4321, loadingMore: false, error: null, cap: 1000, ...over })

  it('shows N of M while more pages exist', () => {
    expect(renderList(100, six(), 0, { paging: paging(), popoverDismissed: true })).toContain('6 of 4321')
  })

  it('says so when GitHub search stops at its cap', () => {
    const frame = renderList(120, six(), 0, { paging: paging({ hasMore: false, total: 4321, capped: true }), popoverDismissed: true })
    expect(frame).toContain('6 of 4321')
    expect(frame).toContain('at most 1000')
  })

  it('never claims the end of the list when the 1,000-result cap was reached with an unknown total', () => {
    const frame = renderList(120, six(), 0, { paging: paging({ hasMore: false, total: null, capped: true }), popoverDismissed: true })
    expect(frame).toContain('6 loaded (GitHub search returns at most 1000')
    expect(frame).not.toContain('end of list')
  })

  it('names the retry key when a page failed, and keeps the rows', () => {
    const frame = renderList(100, six(), 0, { paging: paging({ error: new Error('x') }), popoverDismissed: true })
    expect(frame).toContain('Could not load more PRs; showing 6 of 4321')
    expect(frame).toContain('retry')
  })
})

describe('PRRow author column', () => {
  const render = (login) => renderWithProviders(
    <PRRow pr={pr(7, 'T', login)} isSelected={false} t={t} titleWidth={20} expanded={false} />,
  ).lastFrame()

  it('drops the [bot] suffix instead of cutting it mid-bracket', () => {
    const frame = render('dev-agent[bot]')
    expect(frame).toContain('@dev-agent')
    expect(frame).not.toMatch(/\[b/)
    expect(render('dependabot[bot]')).not.toContain('dependabot[')
  })

  it('ends an over-long login with an ellipsis', () => {
    expect(render('a-very-long-login-name')).toContain('@a-very-lon…')
  })
})
