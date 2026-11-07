import { describe, expect, it } from 'vitest'
import { cellWidth, fitCell, planRow } from './row-layout.js'
import { displayWidth, inkSafe, sanitize } from '../utils.js'

describe('planRow', () => {
  it('keeps every optional cell while the title has room', () => {
    const { titleWidth, show } = planRow(100, { fixed: 10, optional: [{ key: 'a', width: 20 }, { key: 'b', width: 10 }] })
    expect(show).toEqual({ a: true, b: true })
    expect(titleWidth).toBe(60)
  })

  it('drops optional cells in order instead of squeezing the title', () => {
    const { titleWidth, show } = planRow(40, { fixed: 10, optional: [{ key: 'a', width: 20 }, { key: 'b', width: 10 }] })
    expect(show).toEqual({ a: false, b: true })
    expect(titleWidth).toBe(20)
  })
})

describe('fitCell', () => {
  it('is exactly the requested width for ASCII, CJK and emoji', () => {
    for (const text of ['short', 'x'.repeat(80), '修复宽字符截断问题：这是一个非常长的标题', 'Ship \u{1F680} the \u{1F389} release \u{2705} checklist \u{1F469}\u{200D}\u{1F4BB}']) {
      for (const width of [6, 17, 30]) expect(displayWidth(fitCell(text, width)), `${text} @${width}`).toBe(width)
    }
  })

  it('marks a cut with an ellipsis and keeps short text whole', () => {
    expect(fitCell('abcdefghij', 6)).toBe('abcde…')
    expect(fitCell('abc', 6)).toBe('abc   ')
  })
})

describe('Ink-safe text', () => {
  it('follows BMP emoji with a zero-width space so Ink reserves both columns', () => {
    expect(inkSafe('done \u{2705}')).toBe('done \u{2705}​')
    expect(inkSafe('done \u{2705}​')).toBe('done \u{2705}​')
    expect(cellWidth('done \u{2705}')).toBe(7)
  })

  it('cleaning a title does not change how wide it is next to an emoji', () => {
    const dirty = 'fix\u200b \x1b[31m\u2705\u202e done\x07'
    const clean = sanitize(dirty)
    expect(clean).toBe('fix \u2705 done')
    expect(cellWidth(clean)).toBe(displayWidth(inkSafe('fix \u2705 done')))
    expect(fitCell(clean, 20)).toBe(fitCell('fix \u2705 done', 20))
    expect(displayWidth(fitCell(clean, 20))).toBe(20)
  })

  it('removes joiners and variation selectors that Ink and terminals measure differently', () => {
    expect(inkSafe('\u{1F469}\u{200D}\u{1F4BB}')).toBe('\u{1F469}\u{1F4BB}')
  })
})
