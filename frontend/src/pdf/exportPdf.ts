import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  LineCapStyle,
  closePath,
  concatTransformationMatrix,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
} from 'pdf-lib'
import {
  setCharacterSpacing,
  setCharacterSqueeze,
  setTextRenderingMode,
  setTextRise,
  setWordSpacing,
  TextRenderingMode,
} from 'pdf-lib/cjs/api/operators.js'
import type { PdfPoint, PdfRect } from './coordinates.ts'
import { arrowGeometry, boundsFromPoints, type DrawingAnnotation } from './drawings.ts'
import { intersectPdfRects, paintRectsFor, type TextMarkup } from './highlights.ts'
import type { ImageAnnotation } from './images.ts'
import { horizontalFitFactor, resolveStandardFont } from './textAppearance.ts'
import type { TextEdit } from './textEdits.ts'

const TEXT_COLOR = rgb(0, 0, 0)
const COVER_COLOR = rgb(1, 1, 1)

/**
 * Glyph box used when the edit does not store font ascent and descent.
 * These match a typical Latin font, with a little extra so antialiased
 * edges of the original run are covered.
 */
const GLYPH_ASCENT = 0.78
const GLYPH_DESCENT = -0.25

type TextMatrix = [number, number, number, number, number, number]

/**
 * Builds a new PDF from the original bytes, text edits, and text annotations.
 * The input buffer is not modified. With neither edits nor annotations, the
 * result is a copy of those bytes.
 *
 * Highlights and underlines are painted before the original page content, so
 * the glyphs stay above them. Strikethroughs are painted after that content so
 * the line crosses the glyphs. A text edit then covers the original glyphs,
 * paints the annotations for that region again, and draws the replacement on top.
 * Drawings and inserted images are painted above the original page. A text edit
 * then covers its own glyph box and draws the replacement above that, so the
 * new text stays readable.
 *
 * The original text operators are left in the content stream. Removing them
 * would mean rewriting shared content streams, TJ arrays, and form XObjects,
 * which this exporter does not do. The white quadrilateral hides the old
 * glyphs when the page is painted. Text extraction can still return both the
 * original string and the replacement, because both sets of operators remain.
 * The cover is white because the background behind a run is not known.
 */
export async function exportEditedPdf(
  originalBytes: ArrayBuffer,
  edits: readonly TextEdit[],
  highlights: readonly TextMarkup[] = [],
  drawings: readonly DrawingAnnotation[] = [],
  images: readonly ImageAnnotation[] = [],
): Promise<Uint8Array> {
  if (
    edits.length === 0 &&
    highlights.length === 0 &&
    drawings.length === 0 &&
    images.length === 0
  ) {
    return new Uint8Array(originalBytes.slice(0))
  }

  const pdf = await PDFDocument.load(originalBytes.slice(0))
  const pages = pdf.getPages()
  const fonts = new Map<StandardFonts, PDFFont>()

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    if (!page) {
      continue
    }
    const onPage = highlights.filter((markup) => markup.pageNumber === index + 1)
    paintMarkupsBehind(
      page,
      onPage.filter((markup) => markup.kind !== 'strikethrough'),
    )
    drawMarkupShapes(
      page,
      onPage.filter((markup) => markup.kind === 'strikethrough'),
    )
  }

  for (const drawing of drawings) {
    const page = pages[drawing.pageNumber - 1]
    if (!page) {
      throw new Error(
        `A drawing refers to page ${drawing.pageNumber}, which is not in this PDF.`,
      )
    }
    paintDrawing(page, drawing)
  }

  for (const image of images) {
    const page = pages[image.pageNumber - 1]
    if (!page) {
      throw new Error(
        `An image refers to page ${image.pageNumber}, which is not in this PDF.`,
      )
    }
    await paintImage(pdf, page, image)
  }

  for (const edit of edits) {
    const page = pages[edit.pageNumber - 1]
    if (!page) {
      throw new Error(
        `A text edit refers to page ${edit.pageNumber}, which is not in this PDF.`,
      )
    }
    const standard = resolveStandardFont(edit.appearance)
    let font = fonts.get(standard)
    if (!font) {
      font = await pdf.embedFont(standard)
      fonts.set(standard, font)
    }
    applyTextEdit(
      page,
      font,
      edit,
      highlights.filter((markup) => markup.pageNumber === edit.pageNumber),
    )
  }

  for (const markup of highlights) {
    if (!pages[markup.pageNumber - 1]) {
      throw new Error(
        `An annotation refers to page ${markup.pageNumber}, which is not in this PDF.`,
      )
    }
  }

  return pdf.save()
}

function applyTextEdit(
  page: PDFPage,
  font: PDFFont,
  edit: TextEdit,
  highlights: readonly TextMarkup[],
): void {
  const placed = placeEdit(edit)
  coverOriginalText(page, placed)
  paintMarkupsOver(page, highlights, boundsOf(placed.corners))
  const text = textForStandardFont(font, edit.editedText)
  if (text.length === 0 || !(placed.fontSize > 0)) {
    return
  }

  const [a, b, c, d, e, f] = placed.matrix
  const fontSize = placed.fontSize
  const fit = exportHorizontalFit(font, text, fontSize, placed.scaleX, edit.width, placed.vertical)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix((a / fontSize) * fit, (b / fontSize) * fit, c / fontSize, d / fontSize, e, f),
    // The page's previous text state is still in effect inside this save.
    // Fill-and-stroke mode, leftover character spacing, or a non-100% Tz
    // would draw the same standard font heavier or wider than the original.
    setTextRenderingMode(TextRenderingMode.Fill),
    setCharacterSpacing(0),
    setWordSpacing(0),
    setCharacterSqueeze(100),
    setTextRise(0),
  )
  page.drawText(text, {
    x: 0,
    y: 0,
    size: fontSize,
    font,
    color: editColor(edit),
  })
  page.pushOperators(popGraphicsState())
}

/**
 * Shrinks a longer replacement along its baseline so it stays inside the
 * original run. Shorter replacements keep their natural width. Vertical
 * writing mode is not condensed; the text matrix still places it.
 */
function exportHorizontalFit(
  font: PDFFont,
  text: string,
  fontSize: number,
  scaleX: number,
  originalWidth: number,
  vertical: boolean,
): number {
  if (vertical || !(originalWidth > 0) || !(fontSize > 0) || !(scaleX > 0)) {
    return 1
  }
  const natural = font.widthOfTextAtSize(text, fontSize) * (scaleX / fontSize)
  return horizontalFitFactor(natural, originalWidth, vertical)
}

function editColor(edit: TextEdit) {
  const color = edit.appearance?.color
  if (!color) {
    return TEXT_COLOR
  }
  const channel = (value: number) =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  return rgb(channel(color.r), channel(color.g), channel(color.b))
}

function paintMarkupsBehind(page: PDFPage, markups: readonly TextMarkup[]): void {
  if (!drawMarkupShapes(page, markups)) {
    return
  }
  moveLastContentStreamToFront(page)
  releaseContentStream(page)
}

function paintMarkupsOver(
  page: PDFPage,
  markups: readonly TextMarkup[],
  cover: PdfRect,
): void {
  const ordered = [...markups].sort((left, right) => kindOrder(left.kind) - kindOrder(right.kind))
  for (const markup of ordered) {
    const clipped = paintRectsFor(markup).flatMap((rect) => {
      const overlap = intersectPdfRects(rect, cover)
      return overlap ? [overlap] : []
    })
    drawRects(page, markup.color, markup.opacity, clipped)
  }
}

function drawMarkupShapes(page: PDFPage, markups: readonly TextMarkup[]): boolean {
  let drawn = false
  const ordered = [...markups].sort((left, right) => kindOrder(left.kind) - kindOrder(right.kind))
  for (const markup of ordered) {
    if (drawRects(page, markup.color, markup.opacity, paintRectsFor(markup))) {
      drawn = true
    }
  }
  return drawn
}

function drawRects(
  page: PDFPage,
  color: string,
  opacity: number,
  rects: readonly PdfRect[],
): boolean {
  const fillColor = colorOf(color)
  const alpha = Math.min(1, Math.max(0, opacity))
  let drawn = false
  for (const rect of rects) {
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      continue
    }
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      color: fillColor,
      opacity: alpha < 1 ? alpha : undefined,
      borderWidth: 0,
    })
    drawn = true
  }
  return drawn
}

async function paintImage(
  pdf: PDFDocument,
  page: PDFPage,
  image: ImageAnnotation,
): Promise<void> {
  if (image.width <= 0 || image.height <= 0) {
    return
  }
  const bytes = image.bytes.slice()
  const embedded =
    image.format === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  page.drawImage(embedded, {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
  })
}

function paintDrawing(page: PDFPage, drawing: DrawingAnnotation): void {
  const color = colorOf(drawing.color)
  const opacity = Math.min(1, Math.max(0, drawing.opacity))
  const thickness = drawing.thickness > 0 ? drawing.thickness : 2
  if (drawing.kind === 'freehand') {
    paintSvgStroke(page, drawing.points, color, opacity, thickness)
    return
  }
  const start = drawing.points[0]
  const end = drawing.points[1]
  if (!start || !end) {
    return
  }
  if (drawing.kind === 'line') {
    page.drawLine({
      start,
      end,
      thickness,
      color,
      opacity: opacity < 1 ? opacity : undefined,
      lineCap: LineCapStyle.Round,
    })
    return
  }
  if (drawing.kind === 'arrow') {
    const arrow = arrowGeometry(start, end, thickness)
    if (!arrow) {
      return
    }
    page.drawLine({
      start,
      end: arrow.shaftEnd,
      thickness,
      color,
      opacity: opacity < 1 ? opacity : undefined,
      lineCap: LineCapStyle.Round,
    })
    page.drawSvgPath(svgPathFromPdf(arrow.head, true), {
      x: 0,
      y: 0,
      color,
      opacity: opacity < 1 ? opacity : undefined,
    })
    return
  }
  const bounds = boundsFromPoints(drawing.points)
  if (!bounds || (bounds.width < 0.4 && bounds.height < 0.4)) {
    return
  }
  if (drawing.kind === 'ellipse') {
    page.drawEllipse({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      xScale: Math.max(bounds.width / 2, 0.1),
      yScale: Math.max(bounds.height / 2, 0.1),
      borderColor: color,
      borderWidth: thickness,
      borderOpacity: opacity < 1 ? opacity : undefined,
    })
    return
  }
  page.drawRectangle({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    borderColor: color,
    borderWidth: thickness,
    borderOpacity: opacity < 1 ? opacity : undefined,
  })
}

function paintSvgStroke(
  page: PDFPage,
  points: readonly PdfPoint[],
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
): void {
  if (points.length < 2) {
    return
  }
  page.drawSvgPath(svgPathFromPdf(points, false), {
    x: 0,
    y: 0,
    borderColor: color,
    borderWidth: thickness,
    borderOpacity: opacity < 1 ? opacity : undefined,
    borderLineCap: LineCapStyle.Round,
  })
}

/**
 * pdf-lib flips SVG path y. Passing `(x, -y)` with the path origin at (0, 0)
 * lands each point on its PDF user-space coordinate.
 */
function svgPathFromPdf(points: readonly PdfPoint[], close: boolean): string {
  const commands = points.map((point, index) => {
    const command = index === 0 ? 'M' : 'L'
    return `${command} ${point.x} ${-point.y}`
  })
  if (close) {
    commands.push('Z')
  }
  return commands.join(' ')
}

function kindOrder(kind: TextMarkup['kind'] | undefined): number {
  if (kind === 'underline') {
    return 1
  }
  if (kind === 'strikethrough') {
    return 2
  }
  return 0
}

/**
 * pdf-lib appends drawings. Moving that stream to the front paints the
 * highlight before the page's existing text. The page keeps a private pointer
 * at the stream it just filled; clearing it makes the next drawing (the text
 * edit) a new stream at the end, above the original content.
 */
function moveLastContentStreamToFront(page: PDFPage): void {
  const contents = page.node.Contents()
  if (!isContentArray(contents)) {
    return
  }
  const last = contents.size() - 1
  if (last < 1) {
    return
  }
  const stream = contents.get(last)
  contents.remove(last)
  contents.insert(0, stream)
}

function releaseContentStream(page: PDFPage): void {
  const writable = page as unknown as {
    contentStream?: unknown
    contentStreamRef?: unknown
  }
  writable.contentStream = undefined
  writable.contentStreamRef = undefined
}

function isContentArray(value: unknown): value is {
  size: () => number
  get: (index: number) => object
  remove: (index: number) => void
  insert: (index: number, object: object) => void
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'size' in value &&
    'get' in value &&
    'insert' in value &&
    'remove' in value &&
    !('dict' in value)
  )
}

function colorOf(hex: string) {
  const match = /^#([\da-f]{6})$/i.exec(hex)
  const value = match?.[1] ?? 'ffe14a'
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  )
}

function boundsOf(corners: Array<{ x: number; y: number }>): PdfRect {
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  }
}

type PlacedEdit = {
  fontSize: number
  scaleX: number
  vertical: boolean
  matrix: TextMatrix
  corners: Array<{ x: number; y: number }>
}

function placeEdit(edit: TextEdit): PlacedEdit {
  const matrix = readMatrix(edit.transform)
  if (!matrix) {
    return placeAxisAligned(edit)
  }

  const [a, b, c, d, e, f] = matrix
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  const vertical = edit.appearance?.vertical === true
  const fontSize = vertical
    ? positive(scaleX, positive(edit.appearance?.fontSize ?? 0, positive(edit.height, 12)))
    : positive(scaleY, positive(scaleX, positive(edit.appearance?.fontSize ?? 0, positive(edit.height, 12))))
  const advance = scaleX > 0 ? edit.width / scaleX : 0
  const pad = Math.min(0.06, 1.25 / Math.max(fontSize, 1))
  const map = (glyphX: number, glyphY: number) => ({
    x: a * glyphX + c * glyphY + e,
    y: b * glyphX + d * glyphY + f,
  })

  return {
    fontSize,
    scaleX,
    vertical,
    matrix,
    corners: coverCorners(map, advance, pad, edit),
  }
}

function placeAxisAligned(edit: TextEdit): PlacedEdit {
  const fontSize = positive(edit.appearance?.fontSize ?? 0, positive(edit.height, 12))
  const horizontalScale =
    edit.appearance?.horizontalScale && edit.appearance.horizontalScale > 0
      ? edit.appearance.horizontalScale
      : 1
  const advance = fontSize === 0 ? 0 : edit.width / (fontSize * horizontalScale)
  const pad = Math.min(0.06, 1.25 / Math.max(fontSize, 1))
  const matrix: TextMatrix = [
    fontSize * horizontalScale,
    0,
    0,
    fontSize,
    edit.pdfX,
    edit.pdfY,
  ]
  const map = (glyphX: number, glyphY: number) => ({
    x: edit.pdfX + glyphX * fontSize * horizontalScale,
    y: edit.pdfY + glyphY * fontSize,
  })

  return {
    fontSize,
    scaleX: fontSize * horizontalScale,
    vertical: edit.appearance?.vertical === true,
    matrix,
    corners: coverCorners(map, advance, pad, edit),
  }
}

function coverCorners(
  map: (glyphX: number, glyphY: number) => { x: number; y: number },
  advance: number,
  pad: number,
  edit: TextEdit,
): Array<{ x: number; y: number }> {
  const ascent = coverAscent(edit)
  const descent = coverDescent(edit)
  const x0 = Math.min(0, advance) - pad
  const x1 = Math.max(0, advance) + pad
  const y0 = descent - pad
  const y1 = ascent + pad
  return [map(x0, y0), map(x1, y0), map(x1, y1), map(x0, y1)]
}

function coverAscent(edit: TextEdit): number {
  const ascent = edit.appearance?.ascent
  if (typeof ascent === 'number' && ascent >= 0.4 && ascent <= 1.2) {
    return ascent
  }
  return GLYPH_ASCENT
}

function coverDescent(edit: TextEdit): number {
  const descent = edit.appearance?.descent
  if (typeof descent === 'number' && descent < 0 && descent >= -0.6) {
    return descent
  }
  return GLYPH_DESCENT
}

function coverOriginalText(page: PDFPage, placed: PlacedEdit): void {
  const [first, second, third, fourth] = placed.corners
  if (!first || !second || !third || !fourth) {
    return
  }

  page.pushOperators(
    pushGraphicsState(),
    setFillingColor(COVER_COLOR),
    moveTo(first.x, first.y),
    lineTo(second.x, second.y),
    lineTo(third.x, third.y),
    lineTo(fourth.x, fourth.y),
    closePath(),
    fill(),
    popGraphicsState(),
  )
}

/**
 * Standard fonts encode WinAnsi, not Unicode. Latin-1 characters such as "é"
 * are kept. Anything the chosen font cannot encode becomes "?" so the PDF
 * stays valid. Embedded font files are not extracted to widen that set.
 */
function textForStandardFont(font: PDFFont, value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, ' ')
  if (canEncode(font, singleLine)) {
    return singleLine
  }

  let safe = ''
  for (const char of singleLine) {
    safe += canEncode(font, char) ? char : '?'
  }
  return safe
}

function canEncode(font: PDFFont, value: string): boolean {
  try {
    font.encodeText(value)
    return true
  } catch {
    return false
  }
}

function readMatrix(transform: readonly number[]): TextMatrix | null {
  if (transform.length < 6) {
    return null
  }

  const matrix = transform.slice(0, 6)
  if (!matrix.every((value) => Number.isFinite(value))) {
    return null
  }

  return matrix as TextMatrix
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}
