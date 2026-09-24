import type { PageViewport } from 'pdfjs-dist'

/** PDF user space: points, origin at the bottom-left of the page. */
export type PdfPoint = {
  x: number
  y: number
}

/** Axis-aligned rectangle in PDF user space. */
export type PdfRect = {
  x: number
  y: number
  width: number
  height: number
}

/** Viewport space: CSS pixels, origin at the top-left of the rendered page. */
export type ViewportPoint = {
  x: number
  y: number
}

/**
 * Layout of one rendered page.
 *
 * `scale` is the viewer zoom, where 1 means 100% (96 CSS pixels per PDF inch).
 * `viewport.scale` also includes PDF.js's point-to-CSS-pixel factor, so convert
 * positions with `viewport` rather than multiplying by `scale`.
 * `pixelRatioX` and `pixelRatioY` apply only to the canvas backing store.
 */
export type PageGeometry = {
  pageNumber: number
  scale: number
  cssWidth: number
  cssHeight: number
  pixelRatioX: number
  pixelRatioY: number
  viewport: PageViewport
  element: HTMLDivElement
  overlayElement: HTMLDivElement
}

export function pdfPointToViewport(
  viewport: PageViewport,
  point: PdfPoint,
): ViewportPoint {
  return readPoint(viewport.convertToViewportPoint(point.x, point.y))
}

export function viewportPointToPdf(
  viewport: PageViewport,
  point: ViewportPoint,
): PdfPoint {
  return readPoint(viewport.convertToPdfPoint(point.x, point.y))
}

/** Page size in PDF user space from the current viewport. Independent of CSS zoom. */
export function pageSizeFromViewport(viewport: PageViewport): { width: number; height: number } {
  const origin = viewportPointToPdf(viewport, { x: 0, y: viewport.height })
  const far = viewportPointToPdf(viewport, { x: viewport.width, y: 0 })
  return {
    width: Math.abs(far.x - origin.x),
    height: Math.abs(far.y - origin.y),
  }
}

/** Maps a PDF-space rectangle into the current viewport, including zoom and rotation. */
export function pdfRectToViewportBox(
  viewport: PageViewport,
  rect: PdfRect,
): { left: number; top: number; width: number; height: number } {
  const origin = pdfPointToViewport(viewport, { x: rect.x, y: rect.y })
  const opposite = pdfPointToViewport(viewport, {
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  })
  const left = Math.min(origin.x, opposite.x)
  const top = Math.min(origin.y, opposite.y)
  return {
    left,
    top,
    width: Math.abs(opposite.x - origin.x),
    height: Math.abs(opposite.y - origin.y),
  }
}

function readPoint(value: unknown): ViewportPoint {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('PDF.js returned an invalid point.')
  }

  const x = value[0]
  const y = value[1]
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('PDF.js returned an invalid point.')
  }

  return { x, y }
}

export type TextOverlayBox = {
  left: number
  top: number
  width: number
  height: number
  /** Clockwise angle of the baseline, in degrees. */
  angle: number
  /**
   * Maps the element's local box onto the text run.
   * Omitted when the run is already axis-aligned.
   */
  cssTransform: string | null
}

/**
 * A PDF.js text run placed in viewport CSS pixels.
 * `pdfOrigin` is the text matrix origin (baseline start for horizontal text).
 */
export type LaidOutTextItem = {
  str: string
  dir: string
  hasEOL: boolean
  transform: [number, number, number, number, number, number]
  fontName: string
  fontFamily: string
  ascent: number
  descent: number
  vertical: boolean
  pdfOrigin: PdfPoint
  pdfWidth: number
  pdfHeight: number
  viewportOrigin: ViewportPoint
  /** Em size in CSS pixels at this viewport. Derived, not stored on an edit. */
  fontSize: number
  box: TextOverlayBox
}

type TextMatrix = [number, number, number, number, number, number]

export type PdfTextRunInput = {
  str: string
  dir: string
  transform: readonly unknown[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

export type PdfTextStyleInput = {
  ascent?: number
  descent?: number
  vertical?: boolean
  fontFamily?: string
}

/**
 * Places one `getTextContent()` item on the page overlay.
 *
 * The text matrix is in PDF user space. Glyph-space corners of the em box are
 * converted with `pdfPointToViewport`, which applies the viewport scale and
 * flips the Y axis. `item.width` / `item.height` are lengths in that same
 * PDF user space.
 */
export function layoutTextItem(
  viewport: PageViewport,
  item: PdfTextRunInput,
  style: PdfTextStyleInput | undefined,
): LaidOutTextItem | null {
  if (item.str.length === 0) {
    return null
  }

  const matrix = readMatrix(item.transform)
  if (!matrix) {
    return null
  }

  const [a, b, c, d, e, f] = matrix
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  const vertical = style?.vertical === true
  const ascent = finiteNumber(style?.ascent, 1)
  const descent = finiteNumber(style?.descent, 0)
  const { x0, x1, y0, y1 } = glyphBounds(
    vertical,
    scaleX,
    scaleY,
    item.width,
    item.height,
    ascent,
    descent,
  )

  const glyphToPdf = (glyphX: number, glyphY: number): PdfPoint => ({
    x: a * glyphX + c * glyphY + e,
    y: b * glyphX + d * glyphY + f,
  })

  const anchor = pdfPointToViewport(viewport, glyphToPdf(x0, y1))
  const widthEnd = pdfPointToViewport(viewport, glyphToPdf(x1, y1))
  const heightEnd = pdfPointToViewport(viewport, glyphToPdf(x0, y0))
  const pdfOrigin = { x: e, y: f }
  const viewportOrigin = pdfPointToViewport(viewport, pdfOrigin)

  const vx = widthEnd.x - anchor.x
  const vy = widthEnd.y - anchor.y
  const hx = heightEnd.x - anchor.x
  const hy = heightEnd.y - anchor.y
  const width = Math.hypot(vx, vy)
  const height = Math.hypot(hx, hy)
  if (width === 0 || height === 0) {
    return null
  }

  const matrixA = vx / width
  const matrixB = vy / width
  const matrixC = hx / height
  const matrixD = hy / height
  const axisAligned =
    Math.abs(matrixA - 1) < 1e-3 &&
    Math.abs(matrixB) < 1e-3 &&
    Math.abs(matrixC) < 1e-3 &&
    Math.abs(matrixD - 1) < 1e-3

  return {
    str: item.str,
    dir: item.dir,
    hasEOL: item.hasEOL,
    transform: matrix,
    fontName: item.fontName,
    fontFamily: style?.fontFamily ?? '',
    ascent,
    descent,
    vertical,
    pdfOrigin,
    pdfWidth: item.width,
    pdfHeight: item.height,
    viewportOrigin,
    fontSize: (vertical ? item.width : item.height) * viewport.scale,
    box: {
      left: anchor.x,
      top: anchor.y,
      width,
      height,
      angle: (Math.atan2(vy, vx) * 180) / Math.PI,
      cssTransform: axisAligned
        ? null
        : `matrix(${matrixA}, ${matrixB}, ${matrixC}, ${matrixD}, 0, 0)`,
    },
  }
}

function glyphBounds(
  vertical: boolean,
  scaleX: number,
  scaleY: number,
  pdfWidth: number,
  pdfHeight: number,
  ascent: number,
  descent: number,
): { x0: number; x1: number; y0: number; y1: number } {
  if (vertical) {
    const advance = scaleY === 0 ? 0 : pdfHeight / scaleY
    const emWidth = scaleX === 0 ? 0 : pdfWidth / scaleX
    return { x0: 0, x1: emWidth, y0: -advance, y1: 0 }
  }

  const advance = scaleX === 0 ? 0 : pdfWidth / scaleX
  return {
    x0: Math.min(0, advance),
    x1: Math.max(0, advance),
    y0: descent,
    y1: ascent,
  }
}

/** Glyph-box bounds of a laid-out run, in PDF user space. */
export function pdfRectForRun(run: LaidOutTextItem): PdfRect {
  const [a, b, c, d, e, f] = run.transform
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  const { x0, x1, y0, y1 } = glyphBounds(
    run.vertical,
    scaleX,
    scaleY,
    run.pdfWidth,
    run.pdfHeight,
    run.ascent,
    run.descent,
  )
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([glyphX, glyphY]) => ({
    x: a * glyphX + c * glyphY + e,
    y: b * glyphX + d * glyphY + f,
  }))
  return axisAlignedBounds(corners)
}

/**
 * PDF-space bounds for a fraction of a run's advance.
 *
 * Fractions are 0–1 along the glyph advance (x for horizontal text, y for
 * vertical text). Character widths are treated as equal shares of that advance.
 * The result is the axis-aligned box of those glyph corners, in PDF user space.
 * Returns null when the span has no area.
 */
export function pdfRectForRunSpan(
  run: LaidOutTextItem,
  startFraction: number,
  endFraction: number,
): PdfRect | null {
  const start = clampUnit(startFraction)
  const end = clampUnit(endFraction)
  if (end - start <= 1e-6) {
    return null
  }
  if (start <= 1e-6 && end >= 1 - 1e-6) {
    return pdfRectForRun(run)
  }

  const [a, b, c, d, e, f] = run.transform
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  const bounds = glyphBounds(
    run.vertical,
    scaleX,
    scaleY,
    run.pdfWidth,
    run.pdfHeight,
    run.ascent,
    run.descent,
  )
  const span = run.vertical
    ? {
        x0: bounds.x0,
        x1: bounds.x1,
        y1: bounds.y1 + (bounds.y0 - bounds.y1) * start,
        y0: bounds.y1 + (bounds.y0 - bounds.y1) * end,
      }
    : {
        y0: bounds.y0,
        y1: bounds.y1,
        x0: bounds.x0 + (bounds.x1 - bounds.x0) * start,
        x1: bounds.x0 + (bounds.x1 - bounds.x0) * end,
      }
  const corners = [
    [span.x0, span.y0],
    [span.x1, span.y0],
    [span.x1, span.y1],
    [span.x0, span.y1],
  ].map(([glyphX, glyphY]) => ({
    x: a * glyphX + c * glyphY + e,
    y: b * glyphX + d * glyphY + f,
  }))
  const rect = axisAlignedBounds(corners)
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }
  return rect
}

function axisAlignedBounds(corners: readonly PdfPoint[]): PdfRect {
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function readMatrix(transform: readonly unknown[]): TextMatrix | null {
  if (transform.length < 6) {
    return null
  }

  const matrix = transform.slice(0, 6)
  if (
    !matrix.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return null
  }

  return matrix as TextMatrix
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
