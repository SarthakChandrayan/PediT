import { describe, expect, it } from 'vitest'
import { planReflow } from './reflow.ts'

const page = { bottom: 0, top: 792 }

describe('planReflow', () => {
  it('keeps everything on the page when the moved lines still fit', () => {
    const plan = planReflow(
      { cutY: 600, shift: 30, below: [{ top: 590, bottom: 580 }], pageTextTop: 742 },
      page,
    )
    expect(plan.spill).toBe(false)
  })

  it('moves the lines that would enter the bottom margin to a new page, cut between lines', () => {
    // Top margin is 50pt, so the bottom margin is taken to be 50pt too.
    const below = [
      { top: 120, bottom: 110 },
      { top: 100, bottom: 90 },
      { top: 70, bottom: 60 },
    ]
    const plan = planReflow({ cutY: 130, shift: 30, below, pageTextTop: 742 }, page)
    expect(plan.spill).toBe(true)
    // 100/90 lands at 60 (fits above 50); 70/60 would land at 30: spills.
    expect(plan.splitY).toBe(80)
    // The spilled line's top arrives at the top margin on the new page.
    expect(70 + 2 + plan.spillOffset).toBeCloseTo(742)
  })

  it('spills everything below the paragraph when even the first line does not fit', () => {
    const plan = planReflow(
      { cutY: 80, shift: 40, below: [{ top: 70, bottom: 60 }], pageTextTop: 742 },
      page,
    )
    expect(plan.spill).toBe(true)
    expect(plan.splitY).toBe(80)
  })
})
