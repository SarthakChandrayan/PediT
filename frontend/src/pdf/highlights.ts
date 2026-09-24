import type { PdfRect } from './coordinates.ts'

/**
 * A highlight over existing PDF text.
 *
 * `pdfRects` are axis-aligned rectangles in PDF user space (origin at the
 * bottom-left of the page). Screen position is derived from the viewport
 * when the highlight is drawn. One highlight can cover several lines.
 */
export type TextMarkupKind = 'highlight' | 'underline' | 'strikethrough'

/**
 * A text annotation in PDF user space.
 *
 * `pdfRects` are the selected text bounds, the same rectangles highlights use.
 * Underlines and strikethroughs keep those bounds and derive a line from them
 * with `thickness`. Screen position comes from the current viewport.
 */
export type TextMarkup = {
  id: string
  kind: TextMarkupKind
  pageNumber: number
  text: string
  pdfRects: PdfRect[]
  color: string
  opacity: number
  thickness: number
}

export type TextHighlight = TextMarkup

export const HIGHLIGHT_COLORS = {
  yellow: '#ffe14a',
  green: '#7ddea0',
  blue: '#8eb6ff',
  pink: '#ffb0d0',
} as const

export type HighlightColorName = keyof typeof HIGHLIGHT_COLORS

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorName = 'yellow'
export const DEFAULT_HIGHLIGHT_OPACITY = 0.45
export const LINE_MARKUP_COLOR = '#000000'
export const LINE_MARKUP_OPACITY = 1

export type HighlightRunRecord = {
  id: string
  pageNumber: number
  text: string
  hasEOL: boolean
  pdfRect: PdfRect
  /** Horizontal, left-to-right PDF text whose viewport box is axis-aligned. */
  subdivide: boolean
}

export type SelectedTextPiece = {
  pageNumber: number
  text: string
  hasEOL: boolean
  pdfRect: PdfRect
}

export function runAllowsPartialSelection(run: {
  vertical: boolean
  axisAligned: boolean
  transform: readonly number[]
}): boolean {
  const a = run.transform[0]
  const b = run.transform[1]
  const c = run.transform[2]
  return (
    run.axisAligned &&
    !run.vertical &&
    typeof a === 'number' &&
    a > 0 &&
    typeof b === 'number' &&
    Math.abs(b) < 1e-3 &&
    typeof c === 'number' &&
    Math.abs(c) < 1e-3
  )
}

export function highlightsFromPieces(
  pieces: readonly SelectedTextPiece[],
  color: string,
): TextHighlight[] {
  const groups = groupPieces(pieces)
  const highlights: TextHighlight[] = []
  for (const [pageNumber, group] of groups) {
    const pdfRects = rectsOf(group)
    if (pdfRects.length === 0) {
      continue
    }
    highlights.push({
      id: crypto.randomUUID(),
      kind: 'highlight',
      pageNumber,
      text: joinPieceText(group),
      pdfRects,
      color,
      opacity: DEFAULT_HIGHLIGHT_OPACITY,
      thickness: 0,
    })
  }
  return highlights
}

export function lineMarkupsFromPieces(
  pieces: readonly SelectedTextPiece[],
  kind: 'underline' | 'strikethrough',
): TextMarkup[] {
  const groups = groupPieces(pieces)
  const markups: TextMarkup[] = []
  for (const [pageNumber, group] of groups) {
    const pdfRects = rectsOf(group)
    if (pdfRects.length === 0) {
      continue
    }
    markups.push({
      id: crypto.randomUUID(),
      kind,
      pageNumber,
      text: joinPieceText(group),
      pdfRects,
      color: LINE_MARKUP_COLOR,
      opacity: LINE_MARKUP_OPACITY,
      thickness: lineThicknessFor(pdfRects),
    })
  }
  return markups
}

export function lineThicknessFor(rects: readonly PdfRect[]): number {
  const height = rects.reduce((max, rect) => Math.max(max, rect.height), 0)
  if (!Number.isFinite(height) || height <= 0) {
    return 0.8
  }
  return Math.min(1.5, Math.max(0.6, height * 0.06))
}

/** A thin PDF rectangle for an underline or a strikethrough inside a text box. */
export function lineRect(
  rect: PdfRect,
  kind: 'underline' | 'strikethrough',
  thickness: number,
): PdfRect {
  const weight = Math.min(Math.max(thickness, 0.4), rect.height)
  if (kind === 'strikethrough') {
    return {
      x: rect.x,
      y: rect.y + (rect.height - weight) / 2,
      width: rect.width,
      height: weight,
    }
  }
  const lift = Math.min(rect.height * 0.12, Math.max(0, rect.height - weight))
  return {
    x: rect.x,
    y: rect.y + lift,
    width: rect.width,
    height: weight,
  }
}

export function paintRectsFor(markup: TextMarkup): PdfRect[] {
  const kind = markup.kind
  if (kind === 'underline' || kind === 'strikethrough') {
    const thickness = markup.thickness > 0 ? markup.thickness : lineThicknessFor(markup.pdfRects)
    return markup.pdfRects.map((rect) => lineRect(rect, kind, thickness))
  }
  return markup.pdfRects
}

export function clipPdfRect(rect: PdfRect, left: number, width: number): PdfRect {
  const start = clamp01(left)
  const span = Math.min(clamp01(width), 1 - start)
  if (span < 0.01) {
    return rect
  }
  return {
    x: rect.x + start * rect.width,
    y: rect.y,
    width: span * rect.width,
    height: rect.height,
  }
}

export function intersectPdfRects(a: PdfRect, b: PdfRect): PdfRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const top = Math.min(a.y + a.height, b.y + b.height)
  const width = right - x
  const height = top - y
  if (width < 0.4 || height < 0.4) {
    return null
  }
  return { x, y, width, height }
}

export function markupCoveringRect(
  markups: readonly TextMarkup[],
  pageNumber: number,
  rect: PdfRect,
): TextMarkup | null {
  return highlightCoveringRect(markups, pageNumber, rect)
}

export function highlightCoveringRect(
  highlights: readonly TextMarkup[],
  pageNumber: number,
  rect: PdfRect,
): TextMarkup | null {
  for (let index = highlights.length - 1; index >= 0; index -= 1) {
    const highlight = highlights[index]
    if (!highlight || highlight.pageNumber !== pageNumber) {
      continue
    }
    if (highlight.pdfRects.some((item) => intersectPdfRects(item, rect))) {
      return highlight
    }
  }
  return null
}

export type HighlightUnderlay = {
  key: string
  color: string
  opacity: number
  left: number
  top: number
  width: number
  height: number
}

/**
 * Thin bands for underlines and strikethroughs inside a text run.
 * Axis-aligned runs use the line's PDF rectangle. Rotated runs use a band
 * along the run's own box, which the run's CSS transform then rotates.
 */
export function lineBands(
  markups: readonly TextMarkup[],
  pageNumber: number,
  runRect: PdfRect,
  axisAligned: boolean,
): HighlightUnderlay[] {
  const bands: HighlightUnderlay[] = []
  for (const markup of markups) {
    if (markup.kind !== 'underline' && markup.kind !== 'strikethrough') {
      continue
    }
    if (markup.pageNumber !== pageNumber) {
      continue
    }
    const thickness = markup.thickness > 0 ? markup.thickness : lineThicknessFor(markup.pdfRects)
    if (!axisAligned) {
      const hits = markup.pdfRects.some((rect) => intersectPdfRects(rect, runRect))
      if (!hits || runRect.height <= 0) {
        continue
      }
      const band = clamp01(thickness / runRect.height)
      bands.push({
        key: markup.id,
        color: markup.color,
        opacity: markup.opacity,
        left: 0,
        top: markup.kind === 'underline' ? 1 - band : (1 - band) / 2,
        width: 1,
        height: band,
      })
      continue
    }
    paintRectsFor(markup).forEach((rect, index) => {
      const overlap = intersectPdfRects(rect, runRect)
      if (!overlap || runRect.width <= 0 || runRect.height <= 0) {
        return
      }
      bands.push({
        key: `${markup.id}:${index}`,
        color: markup.color,
        opacity: markup.opacity,
        left: clamp01((overlap.x - runRect.x) / runRect.width),
        top: clamp01(
          (runRect.y + runRect.height - (overlap.y + overlap.height)) / runRect.height,
        ),
        width: clamp01(overlap.width / runRect.width),
        height: clamp01(overlap.height / runRect.height),
      })
    })
  }
  return bands
}

export function highlightUnderlays(
  highlights: readonly TextHighlight[],
  pageNumber: number,
  runRect: PdfRect,
  axisAligned: boolean,
): HighlightUnderlay[] {
  const underlays: HighlightUnderlay[] = []
  for (const highlight of highlights) {
    if (highlight.kind === 'underline' || highlight.kind === 'strikethrough') {
      continue
    }
    if (highlight.pageNumber !== pageNumber) {
      continue
    }
    if (!axisAligned) {
      const hits = highlight.pdfRects.some((rect) => intersectPdfRects(rect, runRect))
      if (hits) {
        underlays.push({
          key: highlight.id,
          color: highlight.color,
          opacity: highlight.opacity,
          left: 0,
          top: 0,
          width: 1,
          height: 1,
        })
      }
      continue
    }
    highlight.pdfRects.forEach((rect, index) => {
      const overlap = intersectPdfRects(rect, runRect)
      if (!overlap || runRect.width <= 0 || runRect.height <= 0) {
        return
      }
      underlays.push({
        key: `${highlight.id}:${index}`,
        color: highlight.color,
        opacity: highlight.opacity,
        left: clamp01((overlap.x - runRect.x) / runRect.width),
        top: clamp01(
          (runRect.y + runRect.height - (overlap.y + overlap.height)) / runRect.height,
        ),
        width: clamp01(overlap.width / runRect.width),
        height: clamp01(overlap.height / runRect.height),
      })
    })
  }
  return underlays
}

export function highlightSnapshot(highlights: readonly TextMarkup[]): string {
  return highlights
    .map(
      (markup) =>
        `${markup.id}:${markup.kind}:${markup.pageNumber}:${markup.color}:${markup.text}`,
    )
    .join('\n')
}

function groupPieces(
  pieces: readonly SelectedTextPiece[],
): Map<number, SelectedTextPiece[]> {
  const groups = new Map<number, SelectedTextPiece[]>()
  for (const piece of pieces) {
    const group = groups.get(piece.pageNumber)
    if (group) {
      group.push(piece)
    } else {
      groups.set(piece.pageNumber, [piece])
    }
  }
  return groups
}

function rectsOf(group: readonly SelectedTextPiece[]): PdfRect[] {
  return group
    .map((piece) => piece.pdfRect)
    .filter((rect) => rect.width > 0 && rect.height > 0 && Number.isFinite(rect.x))
}

function joinPieceText(pieces: readonly SelectedTextPiece[]): string {
  let text = ''
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]
    if (!piece) {
      continue
    }
    if (text.length > 0) {
      const previous = pieces[index - 1]
      if (previous?.hasEOL) {
        if (!text.endsWith('\n')) {
          text += '\n'
        }
      } else if (!/\s$/.test(text) && !/^\s/.test(piece.text)) {
        text += ' '
      }
    }
    text += piece.text
  }
  return text
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}
