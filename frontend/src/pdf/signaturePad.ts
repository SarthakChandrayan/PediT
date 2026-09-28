/**
 * A handwritten signature pad in canvas CSS pixels.
 *
 * Points are relative to the top-left of the drawing area. The pad only
 * records ink while one pointer is pressed inside the area: leaving the area,
 * releasing, or cancelling lifts the pen, and ink does not resume until the
 * next press. Other pointers are ignored while a stroke is open.
 *
 * This is viewer state. It never touches the PDF or document history.
 */

export type SignaturePoint = {
  x: number
  y: number
}

export type SignatureStroke = readonly SignaturePoint[]

export type SignaturePad = {
  strokes: readonly SignatureStroke[]
  /** Pointer drawing the open stroke, or null when the pen is up. */
  pointerId: number | null
}

export type SignaturePadSize = {
  width: number
  height: number
}

export type SignaturePointerInput = SignaturePoint &
  SignaturePadSize & {
    pointerId: number
  }

export type SignatureBounds = {
  x: number
  y: number
  width: number
  height: number
}

export const SIGNATURE_INK = '#000000'
export const SIGNATURE_STROKE_WIDTH = 2.5
/** Pixel density of the captured image relative to the drawn CSS size. */
export const SIGNATURE_EXPORT_SCALE = 3

const MIN_POINT_DISTANCE = 0.75
const BOUNDS_PADDING = 4

export function emptySignaturePad(): SignaturePad {
  return { strokes: [], pointerId: null }
}

export function isSignaturePadEmpty(pad: SignaturePad): boolean {
  return pad.strokes.length === 0
}

export function clearSignaturePad(pad: SignaturePad): SignaturePad {
  return isSignaturePadEmpty(pad) && pad.pointerId === null ? pad : emptySignaturePad()
}

export function signaturePointerDown(
  pad: SignaturePad,
  input: SignaturePointerInput & { button: number },
): SignaturePad {
  if (pad.pointerId !== null || input.button !== 0 || !insidePad(input)) {
    return pad
  }
  return {
    strokes: [...pad.strokes, [{ x: input.x, y: input.y }]],
    pointerId: input.pointerId,
  }
}

export function signaturePointerMove(
  pad: SignaturePad,
  input: SignaturePointerInput & { pressed: boolean },
): SignaturePad {
  if (pad.pointerId === null || pad.pointerId !== input.pointerId) {
    return pad
  }
  if (!input.pressed || !insidePad(input)) {
    return { ...pad, pointerId: null }
  }
  const stroke = pad.strokes[pad.strokes.length - 1]
  if (!stroke) {
    return { ...pad, pointerId: null }
  }
  const last = stroke[stroke.length - 1]
  if (last && Math.hypot(input.x - last.x, input.y - last.y) < MIN_POINT_DISTANCE) {
    return pad
  }
  return {
    ...pad,
    strokes: [...pad.strokes.slice(0, -1), [...stroke, { x: input.x, y: input.y }]],
  }
}

/** Ends the open stroke for a release, cancel, or leave from that pointer. */
export function signaturePointerUp(pad: SignaturePad, pointerId: number): SignaturePad {
  if (pad.pointerId === null || pad.pointerId !== pointerId) {
    return pad
  }
  return { ...pad, pointerId: null }
}

/**
 * The inked area, padded for the stroke width and clipped to the pad.
 * Returns null when there is no ink.
 */
export function signatureInkBounds(
  strokes: readonly SignatureStroke[],
  size: SignaturePadSize,
): SignatureBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of strokes) {
    for (const point of stroke) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (!Number.isFinite(minX)) {
    return null
  }
  const pad = SIGNATURE_STROKE_WIDTH / 2 + BOUNDS_PADDING
  const left = Math.max(0, minX - pad)
  const top = Math.max(0, minY - pad)
  const right = Math.min(size.width, maxX + pad)
  const bottom = Math.min(size.height, maxY + pad)
  if (right <= left || bottom <= top) {
    return null
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export type SignatureInkContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'strokeStyle'
  | 'fillStyle'
>

/**
 * Paints strokes in the context's current transform. Each stroke is smoothed
 * with quadratic curves through the midpoints of its samples. A single-point
 * stroke paints a dot.
 */
export function paintSignatureStrokes(
  context: SignatureInkContext,
  strokes: readonly SignatureStroke[],
): void {
  context.lineWidth = SIGNATURE_STROKE_WIDTH
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = SIGNATURE_INK
  context.fillStyle = SIGNATURE_INK
  for (const stroke of strokes) {
    const first = stroke[0]
    if (!first) {
      continue
    }
    context.beginPath()
    if (stroke.length === 1) {
      context.arc(first.x, first.y, SIGNATURE_STROKE_WIDTH / 2, 0, Math.PI * 2)
      context.fill()
      continue
    }
    context.moveTo(first.x, first.y)
    for (let index = 1; index < stroke.length - 1; index += 1) {
      const point = stroke[index]
      const next = stroke[index + 1]
      if (!point || !next) {
        continue
      }
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
    }
    const last = stroke[stroke.length - 1]
    if (last) {
      context.lineTo(last.x, last.y)
    }
    context.stroke()
  }
}

export type SignatureCaptureContext = SignatureInkContext &
  Pick<CanvasRenderingContext2D, 'setTransform'>

export type SignatureCaptureCanvas = {
  width: number
  height: number
  getContext(contextId: '2d'): SignatureCaptureContext | null
  toDataURL(type: 'image/png'): string
}

export type CapturedSignatureImage = {
  /** PNG with a transparent background, cropped to the ink. */
  dataUrl: string
  /** Cropped size in CSS pixels as drawn. */
  width: number
  height: number
}

/**
 * Renders the pad's visible ink to a transparent PNG cropped to the ink, at
 * `SIGNATURE_EXPORT_SCALE` times the drawn size. Returns null for an empty pad.
 */
export function captureSignatureImage(
  pad: SignaturePad,
  size: SignaturePadSize,
  createCanvas: () => SignatureCaptureCanvas,
): CapturedSignatureImage | null {
  const bounds = signatureInkBounds(pad.strokes, size)
  if (!bounds) {
    return null
  }
  const canvas = createCanvas()
  canvas.width = Math.max(1, Math.ceil(bounds.width * SIGNATURE_EXPORT_SCALE))
  canvas.height = Math.max(1, Math.ceil(bounds.height * SIGNATURE_EXPORT_SCALE))
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  context.setTransform(
    SIGNATURE_EXPORT_SCALE,
    0,
    0,
    SIGNATURE_EXPORT_SCALE,
    -bounds.x * SIGNATURE_EXPORT_SCALE,
    -bounds.y * SIGNATURE_EXPORT_SCALE,
  )
  paintSignatureStrokes(context, pad.strokes)
  return { dataUrl: canvas.toDataURL('image/png'), width: bounds.width, height: bounds.height }
}

function insidePad(input: SignaturePointerInput): boolean {
  return input.x >= 0 && input.y >= 0 && input.x <= input.width && input.y <= input.height
}
