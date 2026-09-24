import type { PdfPoint, PdfRect } from './coordinates.ts'

export type DrawingKind = 'freehand' | 'line' | 'arrow' | 'rectangle' | 'ellipse'

/**
 * A vector drawing in PDF user space.
 *
 * `points` are the persistent geometry. Screen position is derived from the
 * current viewport. Rectangles and ellipses store the normalized bounding
 * corners, so width and height are never negative.
 */
export type DrawingAnnotation = {
  id: string
  pageNumber: number
  kind: DrawingKind
  points: PdfPoint[]
  color: string
  opacity: number
  thickness: number
}

export type DrawingDraft = {
  pageNumber: number
  kind: DrawingKind
  points: PdfPoint[]
}

export const DRAWING_COLOR = '#000000'
export const DRAWING_OPACITY = 1
export const DRAWING_THICKNESS = 2

/** Minimum distance between stored freehand samples, in PDF points. */
const FREEHAND_SPACING = 1.5
const FREEHAND_SIMPLIFY = 0.75

export function appendDrawingPoint(
  points: readonly PdfPoint[],
  point: PdfPoint,
  kind: DrawingKind,
): PdfPoint[] {
  if (kind !== 'freehand') {
    const start = points[0] ?? point
    return [start, point]
  }
  const last = points[points.length - 1]
  if (!last) {
    return [point]
  }
  const dx = point.x - last.x
  const dy = point.y - last.y
  if (dx * dx + dy * dy < FREEHAND_SPACING * FREEHAND_SPACING) {
    return points as PdfPoint[]
  }
  return [...points, point]
}

export function finalizeDrawing(draft: DrawingDraft): DrawingAnnotation | null {
  const points = normalizedPoints(draft.kind, draft.points)
  if (!isUsableDrawing(draft.kind, points)) {
    return null
  }
  return {
    id: crypto.randomUUID(),
    pageNumber: draft.pageNumber,
    kind: draft.kind,
    points,
    color: DRAWING_COLOR,
    opacity: DRAWING_OPACITY,
    thickness: DRAWING_THICKNESS,
  }
}

export function boundsFromPoints(points: readonly PdfPoint[]): PdfRect | null {
  if (points.length === 0) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Bounding box used to select a drawing, padded so a thin stroke is clickable. */
export function drawingBounds(drawing: DrawingAnnotation): PdfRect | null {
  const bounds = boundsFromPoints(drawing.points)
  if (!bounds) {
    return null
  }
  const pad = drawing.thickness / 2 + 3
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  }
}

export function arrowGeometry(
  start: PdfPoint,
  end: PdfPoint,
  thickness: number,
): { shaftEnd: PdfPoint; head: [PdfPoint, PdfPoint, PdfPoint] } | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.5) {
    return null
  }
  const headLength = Math.min(length * 0.45, Math.max(thickness * 4, 8))
  const headWidth = headLength * 0.7
  const ux = dx / length
  const uy = dy / length
  const base = { x: end.x - ux * headLength, y: end.y - uy * headLength }
  const px = -uy * (headWidth / 2)
  const py = ux * (headWidth / 2)
  return {
    shaftEnd: base,
    head: [
      end,
      { x: base.x + px, y: base.y + py },
      { x: base.x - px, y: base.y - py },
    ],
  }
}

export function drawingSnapshot(drawings: readonly DrawingAnnotation[]): string {
  return drawings
    .map(
      (drawing) =>
        `${drawing.id}:${drawing.kind}:${drawing.pageNumber}:${drawing.points.length}:${drawing.color}`,
    )
    .join('\n')
}

function normalizedPoints(kind: DrawingKind, points: readonly PdfPoint[]): PdfPoint[] {
  if (kind === 'rectangle' || kind === 'ellipse') {
    const bounds = boundsFromPoints(points)
    if (!bounds) {
      return []
    }
    return [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ]
  }
  if (kind === 'freehand') {
    return simplifyStroke([...points])
  }
  return [...points]
}

function isUsableDrawing(kind: DrawingKind, points: readonly PdfPoint[]): boolean {
  if (kind === 'freehand') {
    return points.length >= 2
  }
  if (points.length < 2) {
    return false
  }
  const start = points[0]
  const end = points[1]
  if (!start || !end) {
    return false
  }
  if (kind === 'line' || kind === 'arrow') {
    return Math.hypot(end.x - start.x, end.y - start.y) >= 1
  }
  const bounds = boundsFromPoints(points)
  return bounds !== null && (bounds.width >= 1 || bounds.height >= 1)
}

function simplifyStroke(points: PdfPoint[], epsilon = FREEHAND_SIMPLIFY): PdfPoint[] {
  if (points.length <= 2) {
    return points
  }
  const start = points[0]
  const end = points[points.length - 1]
  if (!start || !end) {
    return points
  }
  let maxDistance = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]
    if (!point) {
      continue
    }
    const distance = perpendicularDistance(point, start, end)
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }
  if (maxDistance <= epsilon || index === 0) {
    return [start, end]
  }
  const left = simplifyStroke(points.slice(0, index + 1), epsilon)
  const right = simplifyStroke(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

function perpendicularDistance(point: PdfPoint, start: PdfPoint, end: PdfPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
}
