import { describe, expect, it } from 'vitest'
import { sectionBudget } from './view.jsx'

describe('Focus dashboard height budget (#279, #431)', () => {
  it('shares a tall terminal equally between sections', () => {
    expect(sectionBudget(30, 3)).toEqual({ perSection: 10, single: false })
  })

  it('shows one section at a time (with the whole budget) when three cannot each show a row', () => {
    const { perSection, single } = sectionBudget(10, 3)
    expect(single).toBe(true)
    expect(perSection).toBeGreaterThanOrEqual(5)
  })

  it('never goes single for a lone section', () => {
    expect(sectionBudget(6, 1).single).toBe(false)
  })
})
