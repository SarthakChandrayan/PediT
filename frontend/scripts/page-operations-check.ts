import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib'
import { decodePDFRawStream } from 'pdf-lib/cjs/core/streams/decode.js'
import { exportEditedPdf } from '../src/pdf/exportPdf.ts'
import {
  addBlankPage,
  deletePage,
  duplicatePage,
  PageOperationError,
  reorderPages,
  rotatePage,
} from '../src/pdf/pageOperations.ts'
import type { TextEdit } from '../src/pdf/textEdits.ts'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

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
  const original = await makePdf()
  const untouched = original.slice()

  await testDelete(original)
  await testReorder(original)
  await testRotate(original)
  await testDuplicate(original)
  await testBlank(original)
  await testCombined(original)
  check(sameBytes(original, untouched), 'source bytes stay unchanged')

  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed`)
  }
  console.log('All page operation checks passed.')
}

async function testDelete(original: Uint8Array): Promise<void> {
  const deleted = await deletePage(original, 1)
  check(deleted !== original, 'delete returns a new PDF')
  const pages = await inspect(deleted)
  check(pages.length === 2, 'delete middle page leaves 2 pages')
  check(pages[0]?.markers.join() === 'Page A', 'delete keeps page 1')
  check(pages[1]?.markers.join() === 'Page C', 'delete keeps page 3')
  check(pages.every((page) => page.hasText && page.hasRectangle), 'delete keeps vector content')

  const single = await makePdf(['Page A'])
  const before = single.slice()
  let rejected = false
  try {
    await deletePage(single, 0)
  } catch (error) {
    rejected = error instanceof PageOperationError
  }
  check(rejected, 'deleting the only page is rejected')
  check(sameBytes(single, before), 'rejected delete does not change the PDF')
}

async function testReorder(original: Uint8Array): Promise<void> {
  const moved = await reorderPages(original, 2, 0)
  const pages = await inspect(moved)
  check(
    pages.map((page) => page.markers.join()).join('|') === 'Page C|Page A|Page B',
    'move page 3 before page 1',
  )
  check(pages.every((page) => page.hasText && page.hasRectangle), 'reorder keeps vector content')
}

async function testRotate(original: Uint8Array): Promise<void> {
  const once = await rotatePage(original, 0, 90)
  const twice = await rotatePage(once, 0, 90)
  check((await rotationOf(once, 0)) === 90, 'rotate 90°')
  check((await rotationOf(twice, 0)) === 180, 'second 90° rotation accumulates to 180°')

  const half = await rotatePage(original, 1, 180)
  const three = await rotatePage(original, 2, 270)
  check((await rotationOf(half, 1)) === 180, 'rotate 180°')
  check((await rotationOf(three, 2)) === 270, 'rotate 270°')

  const wrapped = await rotatePage(three, 2, 90)
  check((await rotationOf(wrapped, 2)) === 0, '270° plus 90° wraps to 0°')

  const turned = await inspect(twice)
  check(Boolean(turned[0]?.hasText && turned[0].hasRectangle), 'rotation keeps vector text')
  check(turned[1]?.markers.join() === 'Page B', 'rotation does not reorder pages')
}

async function testDuplicate(original: Uint8Array): Promise<void> {
  const duplicated = await duplicatePage(original, 1)
  const pages = await inspect(duplicated)
  check(pages.length === 4, 'duplicate increases the page count')
  check(
    pages.map((page) => page.markers.join()).join('|') === 'Page A|Page B|Page B|Page C',
    'duplicate inserts a copy after the selected page',
  )
  check(
    pages[1]?.width === 400 &&
      pages[1]?.height === 500 &&
      pages[2]?.width === 400 &&
      pages[2]?.height === 500,
    'duplicated page keeps its dimensions',
  )

  const rotatedCopy = await rotatePage(duplicated, 2, 90)
  check((await rotationOf(rotatedCopy, 1)) === 0, 'rotating the copy leaves the original page')
  check((await rotationOf(rotatedCopy, 2)) === 90, 'rotating the copy turns only the copy')
}

async function testBlank(original: Uint8Array): Promise<void> {
  const inserted = await addBlankPage(original, 2)
  const pages = await inspect(inserted)
  check(pages.length === 4, 'blank page increases the page count')
  check(pages[2]?.markers.length === 0, 'inserted page has no source text')
  check(pages[2]?.width === 400 && pages[2]?.height === 500, 'blank page uses the previous page size')
  check(
    pages.map((page) => page.markers.join()).join('|') === 'Page A|Page B||Page C',
    'blank page is inserted at the requested position',
  )

  const custom = await inspect(await addBlankPage(original, 0, 111, 222))
  check(custom[0]?.width === 111 && custom[0]?.height === 222, 'blank page can use explicit dimensions')

  const bare = await PDFDocument.create()
  bare.addPage([200, 300])
  bare.removePage(0)
  const savedBare = await bare.save()
  const bareCount = (await PDFDocument.load(savedBare)).getPageCount()
  const blank = await inspect(await addBlankPage(savedBare, bareCount))
  check(blank.length === bareCount + 1, `blank page appends (pdf-lib kept ${bareCount} pages)`)
  check(
    blank[blank.length - 1]?.width === A4_WIDTH &&
      blank[blank.length - 1]?.height === A4_HEIGHT,
    bareCount === 0
      ? 'a PDF with no pages gets an A4 blank page'
      : 'appending after pdf-lib’s default page uses that page size',
  )
}

async function testCombined(original: Uint8Array): Promise<void> {
  let working = original.slice()
  working = await duplicatePage(working, 1)
  working = await deletePage(working, 3)
  working = await rotatePage(working, 0, 90)
  working = await rotatePage(working, 0, 90)
  working = await reorderPages(working, 2, 0)

  const beforeText = await inspect(working)
  check(beforeText.length === 3, 'combined page count is 3')
  check(
    beforeText.map((page) => page.markers.join()).join('|') === 'Page B|Page A|Page B',
    'combined order keeps the duplicate and drops original page 3',
  )
  check((await rotationOf(working, 1)) === 180, 'combined rotation stays on the moved page')

  const exportedWithoutEdits = await exportEditedPdf(working.slice().buffer, [])
  const exportedPages = await inspect(exportedWithoutEdits)
  check(
    exportedPages.map((page) => page.markers.join()).join('|') === 'Page B|Page A|Page B',
    'export without text edits keeps page operations',
  )

  const withText = await exportEditedPdf(working.slice().buffer, [textEdit()])
  const edited = await inspect(withText)
  check(edited[0]?.text.includes('Edited B') === true, 'export applies a text edit on the working PDF')
  check((await rotationOf(withText, 1)) === 180, 'export keeps the rotated page')

  await saveRoundTrip(original, withText)
}

async function saveRoundTrip(versionOne: Uint8Array, versionTwo: Uint8Array): Promise<void> {
  const uploaded = await postPdf('http://localhost:8000/api/documents', versionOne, true)
  const saved = await postPdf(
    `http://localhost:8000/api/documents/${uploaded.id}/versions`,
    versionTwo,
    false,
  )
  check(saved.version === 2, 'save creates version 2')

  const response = await fetch(
    `http://localhost:8000/api/documents/${uploaded.id}/versions/2/file`,
  )
  check(response.ok, 'saved version can be downloaded')
  const stored = new Uint8Array(await response.arrayBuffer())
  const pages = await inspect(stored)
  check(
    pages.map((page) => page.markers.join()).join('|') === 'Page B|Page A|Page B',
    'saved version keeps duplicate, delete, and reorder',
  )
  check((await rotationOf(stored, 1)) === 180, 'saved version keeps rotation')
  check(pages[0]?.text.includes('Edited B') === true, 'saved version keeps the text edit')
}

async function postPdf(
  url: string,
  bytes: Uint8Array,
  includeEmail: boolean,
): Promise<{ id: string; version: number }> {
  const body = new FormData()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  body.append('file', new File([copy], 'pages.pdf', { type: 'application/pdf' }))
  if (includeEmail) {
    body.append('email', 'test@pdfforge.local')
  }
  const response = await fetch(url, { method: 'POST', body })
  if (!response.ok) {
    throw new Error(`Save request failed (${response.status})`)
  }
  const payload: unknown = await response.json()
  if (!isUploaded(payload)) {
    throw new Error('Save response was not a document version')
  }
  return payload
}

function isUploaded(value: unknown): value is { id: string; version: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'version' in value &&
    typeof value.version === 'number'
  )
}

function textEdit(): TextEdit {
  return {
    id: '1:0',
    pageNumber: 1,
    originalText: 'Page B',
    editedText: 'Edited B',
    pdfX: 24,
    pdfY: 120,
    width: 80,
    height: 18,
    transform: [18, 0, 0, 18, 24, 120],
  }
}

async function makePdf(labels: readonly string[] = ['Page A', 'Page B', 'Page C']): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sizes = [
    [200, 300],
    [400, 500],
    [210, 320],
  ] as const
  labels.forEach((label, index) => {
    const size = sizes[index] ?? ([300, 400] as const)
    const page = pdf.addPage([size[0], size[1]])
    page.drawRectangle({
      x: 10,
      y: 10,
      width: 40,
      height: 20,
      color: rgb(0.2, 0.4, 0.8),
    })
    page.drawText(label, { x: 24, y: 120, size: 18, font })
  })
  return pdf.save()
}

type InspectedPage = {
  markers: string[]
  width: number
  height: number
  text: string
  hasText: boolean
  hasRectangle: boolean
}

async function inspect(bytes: Uint8Array): Promise<InspectedPage[]> {
  const pdf = await PDFDocument.load(bytes.slice())
  return pdf.getPages().map((page) => {
    const text = pageText(page)
    const { width, height } = page.getSize()
    const readable = decodePdfStrings(text)
    return {
      markers: ['Page A', 'Page B', 'Page C'].filter((marker) => readable.includes(marker)),
      width,
      height,
      text: readable,
      hasText: text.includes('Tj') || text.includes('TJ'),
      hasRectangle: /\bl\b/.test(text),
    }
  })
}

async function rotationOf(bytes: Uint8Array, pageIndex: number): Promise<number> {
  const pdf = await PDFDocument.load(bytes.slice())
  const angle = pdf.getPage(pageIndex).getRotation().angle
  return ((Math.round(angle / 90) % 4) + 4) % 4 * 90
}

function pageText(page: PDFPage): string {
  const contents = page.node.Contents()
  if (!contents) {
    return ''
  }
  if (isContentArray(contents)) {
    let text = ''
    for (let index = 0; index < contents.size(); index += 1) {
      text += streamText(contents.lookup(index))
    }
    return text
  }
  return streamText(contents)
}

function isContentArray(
  value: object,
): value is { size: () => number; lookup: (index: number) => unknown } {
  return 'size' in value && 'lookup' in value && !('dict' in value)
}

function streamText(stream: unknown): string {
  if (typeof stream !== 'object' || stream === null || !('dict' in stream)) {
    return ''
  }
  const raw = stream as { dict: object; contents?: Uint8Array; getContentsString?: () => string }
  if (raw.contents instanceof Uint8Array) {
    const decoded = decodePDFRawStream({ dict: raw.dict, contents: raw.contents })
    return latin1(decoded.getBytes(0))
  }
  if (typeof raw.getContentsString === 'function') {
    return raw.getContentsString()
  }
  return ''
}

function decodePdfStrings(content: string): string {
  return content.replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex: string) => {
    const compact = hex.replace(/\s+/g, '')
    if (compact.length < 2 || compact.length % 2 !== 0) {
      return _match
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
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

await main()
