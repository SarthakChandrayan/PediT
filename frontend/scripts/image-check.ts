import { PDFDocument, StandardFonts } from 'pdf-lib'
import { decodePDFRawStream } from 'pdf-lib/cjs/core/streams/decode.js'
import { exportEditedPdf } from '../src/pdf/exportPdf.ts'
import {
  imageFormatOf,
  moveImageBox,
  placeImageBox,
  resizeImageBox,
  type ImageAnnotation,
  type ImageResizeHandle,
} from '../src/pdf/images.ts'
import { deletePage, reorderPages } from '../src/pdf/pageOperations.ts'
import type { TextEdit } from '../src/pdf/textEdits.ts'

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
)

const JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfAAH/2Q==',
  ),
  (char) => char.charCodeAt(0),
)

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
  testFormat()
  testPlacement()
  testMove()
  testResizeKeepsRatio()
  const original = await makePage()
  const untouched = original.slice()
  await testPngExport(original)
  await testJpegExport(original)
  await testMultipleImages(original)
  await testImageAndText(original)
  await testPageOperations()
  check(sameBytes(original, untouched), 'source bytes stay unchanged')

  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed`)
  }
  console.log('All image checks passed.')
}

function testFormat(): void {
  check(imageFormatOf(PNG) === 'png', 'PNG bytes are recognized')
  check(imageFormatOf(JPEG) === 'jpeg', 'JPEG bytes are recognized')
  check(imageFormatOf(Uint8Array.from([1, 2, 3, 4])) === null, 'other files are rejected')
}

function testPlacement(): void {
  const box = placeImageBox({
    originalWidth: 200,
    originalHeight: 100,
    pageWidth: 612,
    pageHeight: 792,
    centerX: 306,
    centerY: 396,
  })
  check(near(box.width / box.height, 2), 'placement keeps the image aspect ratio')
  check(box.width > 0 && box.height > 0, 'placement has a visible size')
  check(
    near(box.x + box.width / 2, 306) && near(box.y + box.height / 2, 396),
    'placement centers the image on the page',
  )
}

function testMove(): void {
  const moved = moveImageBox(
    { x: 40, y: 80, width: 50, height: 25 },
    { x: 10, y: 10 },
    { x: 30, y: 4 },
    612,
    792,
  )
  check(moved.x === 60 && moved.y === 74, 'moving changes the PDF origin')
  check(moved.width === 50 && moved.height === 25, 'moving keeps the image size')

  const offLeft = moveImageBox(
    { x: 40, y: 80, width: 50, height: 25 },
    { x: 40, y: 80 },
    { x: -400, y: 80 },
    612,
    792,
  )
  const offRight = moveImageBox(
    { x: 40, y: 80, width: 50, height: 25 },
    { x: 40, y: 80 },
    { x: 2000, y: 80 },
    612,
    792,
  )
  const offBottom = moveImageBox(
    { x: 40, y: 80, width: 50, height: 25 },
    { x: 40, y: 80 },
    { x: 40, y: -400 },
    612,
    792,
  )
  const offTop = moveImageBox(
    { x: 40, y: 80, width: 50, height: 25 },
    { x: 40, y: 80 },
    { x: 40, y: 2000 },
    612,
    792,
  )
  check(offLeft.x === 0 && offLeft.y === 80, 'a left-edge drag stays on the page')
  check(offRight.x === 562 && offRight.y === 80, 'a right-edge drag stays on the page')
  check(offBottom.x === 40 && offBottom.y === 0, 'a bottom-edge drag stays on the page')
  check(offTop.x === 40 && offTop.y === 767, 'a top-edge drag stays on the page')
  check(
    offLeft.width === 50 &&
      offRight.width === 50 &&
      offBottom.height === 25 &&
      offTop.height === 25,
    'clamped moves keep the image size',
  )
}

function testResizeKeepsRatio(): void {
  const box = { x: 100, y: 200, width: 80, height: 40 }
  const handles: ImageResizeHandle[] = ['nw', 'ne', 'se', 'sw']
  for (const handle of handles) {
    const pointer = {
      nw: { x: 60, y: 280 },
      ne: { x: 220, y: 280 },
      se: { x: 220, y: 140 },
      sw: { x: 60, y: 140 },
    }[handle]
    const next = resizeImageBox(box, handle, pointer, 2)
    check(near(next.width / next.height, 2), `${handle} resize keeps the aspect ratio`)
    check(next.width > 12 && next.height > 12, `${handle} resize stays large enough to grab`)
  }
}

async function testPngExport(original: Uint8Array): Promise<void> {
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [], [logo('png', PNG)])
  const text = (await contentStreams(exported, 0)).join('\n')
  const resources = await resourceText(exported, 0)
  check(text.includes('72') && text.includes('400'), 'a PNG is drawn at its PDF position')
  check(text.includes('120') && text.includes('60'), 'a PNG is drawn at its PDF size')
  check(resources.includes('/Image'), 'a PNG is an embedded image object')
  check(text.includes('Payment must') || decodePdfStrings(text).includes('Payment'), 'PNG export keeps the page text')
}

async function testJpegExport(original: Uint8Array): Promise<void> {
  const exported = await exportEditedPdf(
    original.slice().buffer,
    [],
    [],
    [],
    [logo('jpeg', JPEG, { x: 90, y: 500, width: 40, height: 40 })],
  )
  const resources = await resourceText(exported, 0)
  check(resources.includes('/Image'), 'a JPEG is an embedded image object')
  const text = (await contentStreams(exported, 0)).join('\n')
  check(text.includes('90') && text.includes('500'), 'a JPEG is drawn at its PDF position')
}

async function testMultipleImages(original: Uint8Array): Promise<void> {
  const exported = await exportEditedPdf(original.slice().buffer, [], [], [], [
    logo('png', PNG, { x: 20, y: 20, width: 30, height: 15 }),
    logo('png', PNG, { x: 200, y: 300, width: 30, height: 15 }, 1, 'second'),
  ])
  const resources = await resourceText(exported, 0)
  const matches = resources.match(/\/Image/g) ?? []
  check(matches.length >= 2, 'each inserted image is its own embedded object')
}

async function testImageAndText(original: Uint8Array): Promise<void> {
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
  const exported = await exportEditedPdf(original.slice().buffer, [edit], [], [], [logo('png', PNG)])
  const streams = await contentStreams(exported, 0)
  const readable = decodePdfStrings(streams.join('\n'))
  check(readable.includes('Edited terms'), 'text edited beside an image is still written')
  check(readable.includes('/Image') || (await resourceText(exported, 0)).includes('/Image'), 'the image remains embedded beside the edit')
}

async function testPageOperations(): Promise<void> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([400, 500])
  const second = pdf.addPage([400, 500])
  first.drawText('Page A', { x: 48, y: 240, size: 18, font })
  second.drawText('Page B', { x: 48, y: 240, size: 18, font })
  const original = await pdf.save()
  const onSecond = logo('png', PNG, { x: 18, y: 333.5, width: 40, height: 20 }, 2, 'page-b')
  const baked = await exportEditedPdf(original.slice().buffer, [], [], [], [onSecond])
  const moved = await reorderPages(baked, 1, 0)
  const firstText = (await contentStreams(moved, 0)).join('\n')
  const secondText = (await contentStreams(moved, 1)).join('\n')
  check(firstText.includes('333.5'), 'reordering moves an image with its page')
  check(!secondText.includes('333.5'), 'an image is not left on the page that took its place')

  const deleted = await deletePage(baked, 0)
  const kept = (await contentStreams(deleted, 0)).join('\n')
  check(kept.includes('333.5'), 'deleting another page keeps the image on its own page')
}

function logo(
  format: ImageAnnotation['format'],
  bytes: Uint8Array,
  box: { x: number; y: number; width: number; height: number } = {
    x: 72,
    y: 400,
    width: 120,
    height: 60,
  },
  pageNumber = 1,
  id = format,
): ImageAnnotation {
  return {
    id,
    pageNumber,
    ...box,
    originalWidth: box.width,
    originalHeight: box.height,
    format,
    bytes,
  }
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

async function resourceText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const pdf = await PDFDocument.load(bytes.slice())
  const resources = pdf.getPage(pageIndex).node.Resources()
  return resources ? String(resources) : ''
}

async function contentStreams(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes.slice())
  const contents = pdf.getPage(pageIndex).node.Contents()
  if (!contents) {
    return []
  }
  const entries =
    'size' in contents
      ? Array.from({ length: contents.size() }, (_, index) => contents.get(index))
      : [contents]
  const streams: string[] = []
  for (const entry of entries) {
    streams.push(decodeStream(pdf.context.lookup(entry)))
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
  return Math.abs(left - right) < 0.02
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
