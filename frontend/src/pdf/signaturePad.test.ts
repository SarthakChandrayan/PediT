import { describe, expect, it } from 'vitest'
import {
  captureSignatureImage,
  clearSignaturePad,
  emptySignaturePad,
  isSignaturePadEmpty,
  paintSignatureStrokes,
  SIGNATURE_EXPORT_SCALE,
  SIGNATURE_INK,
  signatureInkBounds,
  signaturePointerDown,
  signaturePointerMove,
  signaturePointerUp,
  type SignatureCaptureCanvas,
  type SignatureCaptureContext,
  type SignaturePad,
} from './signaturePad.ts'

const SIZE = { width: 400, height: 200 }

describe('signature pad drawing', () => {
  it('starts empty and gains ink on a press inside the area', () => {
    const pad = emptySignaturePad()
    expect(isSignaturePadEmpty(pad)).toBe(true)

    const drawing = down(pad, 1, 10, 20)
    expect(isSignaturePadEmpty(drawing)).toBe(false)
    expect(drawing.pointerId).toBe(1)
    expect(drawing.strokes).toEqual([[{ x: 10, y: 20 }]])
  })

  it('records a stroke while the pointer is pressed and moving', () => {
    let pad = down(emptySignaturePad(), 1, 10, 20)
    pad = move(pad, 1, 20, 25)
    pad = move(pad, 1, 30, 30)
    pad = signaturePointerUp(pad, 1)
    expect(pad.pointerId).toBeNull()
    expect(pad.strokes).toEqual([
      [
        { x: 10, y: 20 },
        { x: 20, y: 25 },
        { x: 30, y: 30 },
      ],
    ])

    pad = down(pad, 2, 50, 60)
    pad = move(pad, 2, 55, 65)
    expect(pad.strokes).toHaveLength(2)
  })

  it('does not draw when the pointer is not pressed', () => {
    const pad = emptySignaturePad()
    expect(move(pad, 1, 20, 20)).toBe(pad)

    let drawing = down(pad, 1, 10, 10)
    drawing = move(drawing, 1, 20, 20, false)
    expect(drawing.pointerId).toBeNull()
    const lifted = drawing
    expect(move(lifted, 1, 30, 30)).toBe(lifted)
    expect(lifted.strokes[0]).toHaveLength(1)
  })

  it('does not start or continue ink outside the area', () => {
    const pad = emptySignaturePad()
    expect(down(pad, 1, -1, 10)).toBe(pad)
    expect(down(pad, 1, 10, SIZE.height + 1)).toBe(pad)

    let drawing = down(pad, 1, 10, 10)
    drawing = move(drawing, 1, 20, 20)
    drawing = move(drawing, 1, SIZE.width + 5, 20)
    expect(drawing.pointerId).toBeNull()
    expect(drawing.strokes[0]).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ])

    const reentered = move(drawing, 1, 30, 30)
    expect(reentered).toBe(drawing)
  })

  it('lifts the pen on leave or cancel from the drawing pointer only', () => {
    const drawing = down(emptySignaturePad(), 1, 10, 10)
    expect(signaturePointerUp(drawing, 2)).toBe(drawing)
    expect(signaturePointerUp(drawing, 1).pointerId).toBeNull()
  })

  it('ignores other pointers and non-primary buttons', () => {
    const pad = emptySignaturePad()
    expect(signaturePointerDown(pad, { pointerId: 1, button: 2, x: 5, y: 5, ...SIZE })).toBe(pad)

    const drawing = down(pad, 1, 10, 10)
    expect(down(drawing, 2, 40, 40)).toBe(drawing)
    expect(move(drawing, 2, 40, 40)).toBe(drawing)
  })

  it('skips sub-pixel jitter', () => {
    const drawing = down(emptySignaturePad(), 1, 10, 10)
    expect(move(drawing, 1, 10.2, 10.2)).toBe(drawing)
  })

  it('clears every stroke and lifts the pen', () => {
    let pad = down(emptySignaturePad(), 1, 10, 10)
    pad = move(pad, 1, 40, 40)
    const cleared = clearSignaturePad(pad)
    expect(isSignaturePadEmpty(cleared)).toBe(true)
    expect(cleared.pointerId).toBeNull()
    expect(move(cleared, 1, 50, 50)).toBe(cleared)
    expect(clearSignaturePad(cleared)).toBe(cleared)
  })
})

describe('signature ink bounds', () => {
  it('is null without ink', () => {
    expect(signatureInkBounds([], SIZE)).toBeNull()
  })

  it('pads the ink and clips it to the area', () => {
    const bounds = signatureInkBounds(
      [
        [
          { x: 100, y: 50 },
          { x: 300, y: 150 },
        ],
      ],
      SIZE,
    )
    expect(bounds).not.toBeNull()
    expect(bounds?.x).toBeLessThan(100)
    expect(bounds?.y).toBeLessThan(50)
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeGreaterThan(300)
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeGreaterThan(150)

    const edge = signatureInkBounds([[{ x: 0, y: 0 }, { x: 400, y: 200 }]], SIZE)
    expect(edge).toEqual({ x: 0, y: 0, width: 400, height: 200 })
  })
})

describe('signature painting', () => {
  it('uses a round black stroke and smooths through midpoints', () => {
    const { context, calls } = fakeCanvas()
    paintSignatureStrokes(context, [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 10 },
      ],
    ])
    expect(context.lineCap).toBe('round')
    expect(context.lineJoin).toBe('round')
    expect(context.strokeStyle).toBe(SIGNATURE_INK)
    expect(context.lineWidth).toBeGreaterThan(0)
    expect(calls).toEqual(['beginPath', 'moveTo 0 0', 'quadraticCurveTo 10 0 15 5', 'lineTo 20 10', 'stroke'])
  })

  it('paints a tap as a dot', () => {
    const { context, calls } = fakeCanvas()
    paintSignatureStrokes(context, [[{ x: 5, y: 6 }]])
    expect(calls[0]).toBe('beginPath')
    expect(calls[1]).toMatch(/^arc 5 6 /)
    expect(calls[2]).toBe('fill')
  })
})

describe('signature capture', () => {
  it('captures nothing from an empty pad', () => {
    const { canvas } = fakeCanvas()
    expect(captureSignatureImage(emptySignaturePad(), SIZE, () => canvas)).toBeNull()
  })

  it('crops a transparent PNG to the ink at the export scale', () => {
    let pad = down(emptySignaturePad(), 1, 100, 50)
    pad = move(pad, 1, 200, 100)
    pad = signaturePointerUp(pad, 1)
    const { canvas, transforms } = fakeCanvas()
    const image = captureSignatureImage(pad, SIZE, () => canvas)
    const bounds = signatureInkBounds(pad.strokes, SIZE)
    if (!image || !bounds) {
      throw new Error('expected a captured signature')
    }
    expect(image.dataUrl).toBe('data:image/png;base64,FAKE')
    expect(image.width).toBe(bounds.width)
    expect(image.height).toBe(bounds.height)
    expect(canvas.width).toBe(Math.ceil(bounds.width * SIGNATURE_EXPORT_SCALE))
    expect(canvas.height).toBe(Math.ceil(bounds.height * SIGNATURE_EXPORT_SCALE))
    expect(transforms).toEqual([
      [
        SIGNATURE_EXPORT_SCALE,
        0,
        0,
        SIGNATURE_EXPORT_SCALE,
        -bounds.x * SIGNATURE_EXPORT_SCALE,
        -bounds.y * SIGNATURE_EXPORT_SCALE,
      ],
    ])
  })
})

function down(pad: SignaturePad, pointerId: number, x: number, y: number): SignaturePad {
  return signaturePointerDown(pad, { pointerId, button: 0, x, y, ...SIZE })
}

function move(
  pad: SignaturePad,
  pointerId: number,
  x: number,
  y: number,
  pressed = true,
): SignaturePad {
  return signaturePointerMove(pad, { pointerId, pressed, x, y, ...SIZE })
}

function fakeCanvas(): {
  canvas: SignatureCaptureCanvas
  context: SignatureCaptureContext
  calls: string[]
  transforms: number[][]
} {
  const calls: string[] = []
  const transforms: number[][] = []
  const context: SignatureCaptureContext = {
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '',
    fillStyle: '',
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
    quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) =>
      calls.push(`quadraticCurveTo ${cpx} ${cpy} ${x} ${y}`),
    arc: (x: number, y: number, radius: number) => calls.push(`arc ${x} ${y} ${radius}`),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    setTransform: (...values: unknown[]) => {
      transforms.push(values.filter((value): value is number => typeof value === 'number'))
    },
  }
  const canvas: SignatureCaptureCanvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: (type) => `data:${type};base64,FAKE`,
  }
  return { canvas, context, calls, transforms }
}
