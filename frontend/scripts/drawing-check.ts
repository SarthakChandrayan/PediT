import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { PageViewport } from 'pdfjs-dist'
import { decodePDFRawStream } from 'pdf-lib/cjs/core/streams/decode.js'
import {
  pdfPointToViewport,
  viewportPointToPdf,
  type PdfPoint,
} from '../src/pdf/coordinates.ts'
import {
  appendDrawingPoint,
  arrowGeometry,
  finalizeDrawing,
  type DrawingAnnotation,
} from '../src/pdf/drawings.ts'
import { exportEditedPdf } from '../src/pdf/exportPdf.ts'
import { reorderPages } from '../src/pdf/pageOperations.ts'
import type { TextEdit } from '../src/pdf/textEdits.ts'

const failures: string[] = []

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message)
    console.error(`FAIL ${message}`)
    return
  }
  console.log(`ok   ${message}`)
}

async function main(): Promise<void> {
  testSampling()
  testRectangleNormalization()
  testArrowScalesWithThickness()
  testZoomRoundTrip()
  const original = await makePage()
  const untouched = original.slice()
  await testLine(original)
  await testArrow(original)
  await testRectangle(original)
  await testEllipse(original)
  await testFreehand(original)
  await testDrawingStaysVector(original)
  await testDrawingThenTextEdit(original)
  await testReorderKeepsDrawingOnItsPage()
  check(sameBytes(original, untouched), 'source bytes stay unchanged')

  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed`)
  }
  console.log('All drawing checks passed.')
}

function testSampling(): void {
  const start = { x: 0, y: 0 }
  const close = appendDrawingPoint([start], { x: 0.2, y: 0 }, 'freehand')
  const kept = appendDrawingPoint([start], { x: 4, y: 1 }, 'freehand')
  check(close.length === 1, 'freehand sampling drops points that are too close')
  check(kept.length === 2 && kept[1]?.x === 4, 'freehand sampling keeps a point that moves the stroke')
}

function testRectangleNormalization(): void {
  const drawing = finalizeDrawing({
    pageNumber: 1,
    kind: 'rectangle',
    points: [
      { x: 80, y: 40 },
      { x: 20, y: 100 },
    ],
  })
  check(drawing?.points[0]?.x === 20 && drawing.points[0].y === 40, 'a rectangle stores its minimum corner')
  check(
    drawing?.points[1]?.x === 80 && drawing.points[1].y === 100,
    'a rectangle stores a positive width and height',
  )
  const ellipse = finalizeDrawing({
    pageNumber: 2,
    kind: 'ellipse',
    points: [
      { x: 5, y: 5 },
      { x: 1, y: 9 },
    ],
  })
  check(ellipse?.pageNumber === 2, 'an ellipse stays on the page where it was drawn')
  check(ellipse?.points[0]?.x === 1 && ellipse.points[1]?.y === 9, 'an ellipse stores a normalized bounding box')
}

function testArrowScalesWithThickness(): void {
  const thin = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2)
  const thick = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 6)
  const thinLength = thin ? Math.hypot(thin.head[0].x - thin.shaftEnd.x, thin.head[0].y - thin.shaftEnd.y) : 0
  const thickLength = thick ? Math.hypot(thick.head[0].x - thick.shaftEnd.x, thick.head[0].y - thick.shaftEnd.y) : 0
  check(thickLength > thinLength, 'a thicker arrow has a larger arrowhead')
}

function testZoomRoundTrip(): void {
  const point: PdfPoint = { x: 144, y: 500 }
  for (const scale of [0.5, 1, 2]) {
    const viewport = fakeViewport(scale, 792)
    const screen = pdfPointToViewport(viewport, point)
    const back = viewportPointToPdf(viewport, screen)
    check(
      near(back.x, point.x) && near(back.y, point.y),
      `a point drawn at ${scale * 100}% converts back to the same PDF location`,
    )
  }
  const half = pdfPointToViewport(fakeViewport(0.5, 792), point)
  const full = pdfPointToViewport(fakeViewport(2, 792), point)
  check(
    near(full.x / half.x, 4) && near(full.y / half.y, 4),
    'drawing screen position scales from 50% to 200%',
  )
}

async function testLine(original: Uint8Array): Promise<void> {
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [line()])
  const text = (await contentStreams(exported, 0)).join('\n')
  check(text.includes('72') && text.includes('700') && text.includes('180'), 'a line is written at its PDF endpoints')
  check(!text.includes('/Image') && !text.includes('\nBI\n'), 'a line is not stored as a raster image')
}

async function testArrow(original: Uint8Array): Promise<void> {
  const arrow = drawing('arrow', [
    { x: 40, y: 600 },
    { x: 140, y: 640 },
  ])
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [arrow])
  const text = (await contentStreams(exported, 0)).join('\n')
  check(text.includes('140') && text.includes('640'), 'an arrow keeps its PDF tip')
  check(text.includes(' f') || text.includes('\nf'), 'an arrowhead is a filled vector path')
}

async function testRectangle(original: Uint8Array): Promise<void> {
  const shape = drawing('rectangle', [
    { x: 50, y: 80 },
    { x: 150, y: 180 },
  ])
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [shape])
  const text = (await contentStreams(exported, 0)).join('\n')
  check(text.includes('50') && text.includes('80') && text.includes('100'), 'a rectangle is written from its PDF bounds')
}

async function testEllipse(original: Uint8Array): Promise<void> {
  const shape = drawing('ellipse', [
    { x: 200, y: 200 },
    { x: 280, y: 250 },
  ])
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [shape])
  const text = (await contentStreams(exported, 0)).join('\n')
  check(text.includes(' c') || text.includes('\nc'), 'an ellipse is a vector curve')
  check(text.includes('240') || text.includes('225'), 'an ellipse uses the center of its PDF bounds')
}

async function testFreehand(original: Uint8Array): Promise<void> {
  const shape = drawing('freehand', [
    { x: 15, y: 30 },
    { x: 25, y: 48 },
    { x: 40, y: 36 },
    { x: 55, y: 60 },
  ])
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [shape])
  const text = (await contentStreams(exported, 0)).join('\n')
  check(text.includes('15') && text.includes('55'), 'a freehand stroke keeps its PDF path')
  check(text.includes(' m') || text.includes('\nm'), 'a freehand stroke is a vector path')
}

async function testDrawingStaysVector(original: Uint8Array): Promise<void> {
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [
    line(),
    drawing('freehand', [
      { x: 10, y: 10 },
      { x: 30, y: 20 },
    ]),
  ])
  const pdf = await PDFDocument.load(exported.slice())
  const resources = pdf.getPage(0).node.Resources()
  const xObject = resources && 'lookup' in resources ? resources.lookup('XObject' as never) : undefined
  check(!xObject, 'drawings do not add an image XObject')
}

async function testDrawingThenTextEdit(original: Uint8Array): Promise<void> {
  const edit: TextEdit = {
    id: 'word',
    pageNumber: 1,
    originalText: 'Payment must be completed within 30 days.',
    editedText: 'Edited terms',
    pdfX: 72,
    pdfY: 700,
    width: 220,
    height: 12,
    transform: [12, 0, 0, 12, 72, 700],
  }
  const exported = await exportEditedPdf(original.slice().buffer, [edit], [], [line()])
  const streams = await contentStreams(exported, 0)
  const last = decodePdfStrings(streams[streams.length - 1] ?? '')
  const lineAt = last.indexOf('180')
  const textAt = last.indexOf('Edited terms')
  check(lineAt >= 0 && textAt > lineAt, 'replacement text is drawn after a drawing on the same page')
}

async function testReorderKeepsDrawingOnItsPage(): Promise<void> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([400, 500])
  const second = pdf.addPage([400, 500])
  first.drawText('Page A', { x: 48, y: 240, size: 18, font })
  second.drawText('Page B', { x: 48, y: 240, size: 18, font })
  const original = await pdf.save()
  const onSecond = drawing('line', [
    { x: 12, y: 333.5 },
    { x: 90, y: 333.5 },
  ], 2)
  const baked = await exportEditedPdf(original.slice().buffer, [], [], [onSecond])
  const moved = await reorderPages(baked, 1, 0)
  const firstText = (await contentStreams(moved, 0)).join('\n')
  const secondText = (await contentStreams(moved, 1)).join('\n')
  check(firstText.includes('333.5'), 'reordering moves a drawing with its page')
  check(!secondText.includes('333.5'), 'a drawing is not left on the page that took its place')
}

function line(): DrawingAnnotation {
  return drawing('line', [
    { x: 72, y: 700 },
    { x: 180, y: 700 },
  ])
}

function drawing(
  kind: DrawingAnnotation['kind'],
  points: PdfPoint[],
  pageNumber = 1,
): DrawingAnnotation {
  return {
    id: kind,
    pageNumber,
    kind,
    points,
    color: '#000000',
    opacity: 1,
    thickness: 2,
  }
}

function fakeViewport(scale: number, pageHeight: number): PageViewport {
  const css = (scale * 96) / 72
  return {
    convertToViewportPoint(x: number, y: number) {
      return [x * css, (pageHeight - y) * css]
    },
    convertToPdfPoint(x: number, y: number) {
      return [x / css, pageHeight - y / css]
    },
  } as PageViewport
}

async function makePage(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('Payment must be completed within 30 days.', {
    x: 72,
    y: 700,
    size: 12,
    font,
  })
  return pdf.save()
}

async function contentStreams(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes.slice())
  const contents = pdf.getPage(pageIndex).node.Contents()
  if (!contents) {
    return []
  }
  const entries = 'size' in contents ? Array.from({ length: contents.size() }, (_, index) => contents.get(index)) : [contents]
  const streams: string[] = []
  for (const entry of entries) {
    const stream = pdf.context.lookup(entry)
    streams.push(decodeStream(stream))
  }
  return streams
}

function decodeStream(stream: unknown): string {
  if (!stream || typeof stream !== 'object') {
    return ''
  }
  const raw = stream as {
    dict: object
    contents?: Uint8Array
    getContentsString?: () => string
  }
  if (raw.contents instanceof Uint8Array) {
    const decoded = decodePDFRawStream({ dict: raw.dict, contents: raw.contents })
    return latin1(decoded.getBytes())
  }
  if (typeof raw.getContentsString === 'function') {
    return raw.getContentsString()
  }
  return ''
}

function decodePdfStrings(content: string): string {
  return content.replace(/<([0-9A-Fa-f\s]+)>/g, (match, hex: string) => {
    const compact = hex.replace(/\s+/g, '')
    if (compact.length < 2 || compact.length % 2 !== 0) {
      return match
    }
    let decoded = ''
    for (let index = 0; index < compact.length; index += 2) {
      decoded += String.fromCharCode(Number.parseInt(compact.slice(index, index + 2), 16))
    }
    return decoded
  })
}

function latin1(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) {
    text += String.fromCharCode(byte)
  }
  return text
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.01
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
