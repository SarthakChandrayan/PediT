import { describe, expect, it } from 'vitest'
import { clampImageBoxToPage, moveImageBox, type ImageBox } from './images.ts'

describe('image page clamping', () => {
  it('keeps a dragged image fully inside the page and preserves its size', () => {
    const page = { width: 300, height: 400 }
    const box = imageBox({ x: 80, y: 90, width: 40, height: 30 })

    const moved = moveImageBox(box, { x: 100, y: 100 }, { x: 130, y: 70 }, page.width, page.height)
    expect(moved).toEqual({ x: 110, y: 60, width: 40, height: 30 })
    expect(insidePage(moved, page)).toBe(true)
  })

  it('clamps a drag past every page edge', () => {
    const page = { width: 300, height: 400 }
    const box = imageBox({ x: 80, y: 90, width: 50, height: 40 })

    const left = moveImageBox(box, { x: 80, y: 90 }, { x: -400, y: 90 }, page.width, page.height)
    expect(left).toEqual({ x: 0, y: 90, width: 50, height: 40 })

    const right = moveImageBox(box, { x: 80, y: 90 }, { x: 900, y: 90 }, page.width, page.height)
    expect(right).toEqual({ x: 250, y: 90, width: 50, height: 40 })

    const bottom = moveImageBox(box, { x: 80, y: 90 }, { x: 80, y: -500 }, page.width, page.height)
    expect(bottom).toEqual({ x: 80, y: 0, width: 50, height: 40 })

    const top = moveImageBox(box, { x: 80, y: 90 }, { x: 80, y: 900 }, page.width, page.height)
    expect(top).toEqual({ x: 80, y: 360, width: 50, height: 40 })

    for (const next of [left, right, bottom, top]) {
      expect(insidePage(next, page)).toBe(true)
    }
  })

  it('uses PDF-space page bounds at every zoom level', () => {
    const page = { width: 612, height: 792 }
    const box = imageBox({ x: 20, y: 30, width: 80, height: 60 })
    for (const scale of [0.5, 1, 1.5, 2.4]) {
      const moved = moveImageBox(
        box,
        { x: 60, y: 60 },
        { x: 60 - 20_000 / scale, y: 60 + 20_000 / scale },
        page.width,
        page.height,
      )
      expect(moved.width).toBe(80)
      expect(moved.height).toBe(60)
      expect(insidePage(moved, page)).toBe(true)
      expect(moved.x).toBe(0)
      expect(moved.y).toBe(732)
    }
  })

  it('does not change width or height when clamping', () => {
    const box = imageBox({ x: -40, y: 500, width: 90, height: 70 })
    const clamped = clampImageBoxToPage(box, 200, 300)
    expect(clamped).toEqual({ x: 0, y: 230, width: 90, height: 70 })
    expect(insidePage(clamped, { width: 200, height: 300 })).toBe(true)
  })
})

function imageBox(box: ImageBox): ImageBox {
  return { ...box }
}

function insidePage(
  box: ImageBox,
  page: { width: number; height: number },
): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= page.width &&
    box.y + box.height <= page.height
  )
}
