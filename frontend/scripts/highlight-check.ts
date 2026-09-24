import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import type { PageViewport } from 'pdfjs-dist'
import { decodePDFRawStream } from 'pdf-lib/cjs/core/streams/decode.js'
import { pdfRectToViewportBox, viewportPointToPdf, type PdfRect } from '../src/pdf/coordinates.ts'
import { exportEditedPdf } from '../src/pdf/exportPdf.ts'
import {
  clipPdfRect,
  HIGHLIGHT_COLORS,
  highlightsFromPieces,
  lineMarkupsFromPieces,
  lineRect,
  type TextHighlight,
  type TextMarkup,
} from '../src/pdf/highlights.ts'
import { deletePage } from '../src/pdf/pageOperations.ts'
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
  testSelectionRecords()
  testZoomMapping()
  const original = await makeSentencePdf()
  const untouched = original.slice()
  await testOneRun(original)
  await testSeveralRects(original)
  await testHighlightAndEdit(original)
  await testPageOperationKeepsHighlightOnItsPage()
  await testUnderline(original)
  await testStrikethrough(original)
  await testAllThreeMarkups(original)
  await testUnderlineAndEdit(original)
  await testPageOperationKeepsUnderlineOnItsPage()
  check(sameBytes(original, untouched), 'source bytes stay unchanged')

  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed`)
  }
  console.log('All highlight checks passed.')
}

function testSelectionRecords(): void {
  const created = highlightsFromPieces(
    [
      {
        pageNumber: 1,
        text: '30',
        hasEOL: false,
        pdfRect: { x: 10, y: 20, width: 30, height: 12 },
      },
      {
        pageNumber: 1,
        text: 'days',
        hasEOL: false,
        pdfRect: { x: 42, y: 20, width: 40, height: 12 },
      },
      {
        pageNumber: 2,
        text: 'later',
        hasEOL: false,
        pdfRect: { x: 10, y: 40, width: 36, height: 12 },
      },
    ],
    HIGHLIGHT_COLORS.yellow,
  )
  check(created.length === 2, 'a selection on two pages becomes two highlights')
  check(created[0]?.pdfRects.length === 2, 'one line of several runs keeps every rectangle')
  check(created[0]?.text === '30 days', 'adjacent runs are joined with a space')
  check(created[1]?.pageNumber === 2, 'the second highlight stays on its page')
  check(created[0]?.color === HIGHLIGHT_COLORS.yellow, 'default color is yellow')
  check(created[0]?.kind === 'highlight', 'highlight records keep their kind')
  check(created[0]?.opacity === 0.45, 'highlight opacity is stored on the record')
  const lines = lineMarkupsFromPieces(
    [
      {
        pageNumber: 1,
        text: '30',
        hasEOL: false,
        pdfRect: { x: 10, y: 20, width: 30, height: 12 },
      },
      {
        pageNumber: 1,
        text: 'days',
        hasEOL: true,
        pdfRect: { x: 42, y: 20, width: 40, height: 12 },
      },
    ],
    'underline',
  )
  check(lines.length === 1 && lines[0]?.pdfRects.length === 2, 'an underline keeps every selected rectangle')
  check(lines[0]?.kind === 'underline' && lines[0]?.color === '#000000', 'underlines are black')
  check((lines[0]?.thickness ?? 0) > 0, 'an underline stores a thickness')

  const full = { x: 100, y: 200, width: 80, height: 10 }
  const partial = clipPdfRect(full, 0.25, 0.5)
  check(
    partial.x === 120 && partial.width === 40 && partial.y === 200 && partial.height === 10,
    'a partial selection is a fraction of the PDF run, not a screen coordinate',
  )
}

function testZoomMapping(): void {
  const rect: PdfRect = { x: 72, y: 700, width: 80, height: 12 }
  const pageHeight = 792
  const half = pdfRectToViewportBox(fakeViewport(0.5, pageHeight), rect)
  const full = pdfRectToViewportBox(fakeViewport(2, pageHeight), rect)
  check(
    Math.abs(full.width / half.width - 4) < 0.001 &&
      Math.abs(full.height / half.height - 4) < 0.001,
    'highlight screen size scales from 50% to 200%',
  )

  const viewport = fakeViewport(2, pageHeight)
  const box = pdfRectToViewportBox(viewport, rect)
  const bottomLeft = viewportPointToPdf(viewport, {
    x: box.left,
    y: box.top + box.height,
  })
  const topRight = viewportPointToPdf(viewport, {
    x: box.left + box.width,
    y: box.top,
  })
  check(
    near(bottomLeft.x, rect.x) &&
      near(bottomLeft.y, rect.y) &&
      near(topRight.x, rect.x + rect.width) &&
      near(topRight.y, rect.y + rect.height),
    'viewport highlight boxes convert back to the stored PDF rectangle',
  )
}

async function testOneRun(original: Uint8Array): Promise<void> {
  const highlight = sentenceHighlight(HIGHLIGHT_COLORS.yellow)
  const exported = await exportEditedPdf(original.slice().buffer, [], [highlight])
  const streams = await contentStreams(exported, 0)
  check(streams.length >= 2, 'a highlight is its own content stream')
  check(streams[0]?.includes('72.5') === true, 'highlight uses the stored PDF x')
  check(streams[0]?.includes('697.25') === true, 'highlight uses the stored PDF y')
  check(
    streams[0]?.includes('Payment must') !== true,
    'the highlight stream does not replace the page text',
  )
  const readable = streams.map((stream) => decodePdfStrings(stream)).join('\n')
  check(
    readable.includes('Payment must be completed within 30 days.'),
    'original text remains in the PDF',
  )
  check(
    (await opacities(exported, 0)).includes(0.45),
    'highlight opacity is written into the PDF',
  )
  check(streams[0]?.includes(' gs') === true, 'the highlight stream uses that opacity')
  const raw = latin1(exported)
  check(!raw.includes('/Subtype /Image'), 'highlight export does not rasterize the page')
}

async function testSeveralRects(original: Uint8Array): Promise<void> {
  const highlight: TextHighlight = {
    ...sentenceHighlight(HIGHLIGHT_COLORS.green),
    pdfRects: [
      { x: 72.5, y: 697.25, width: 40.25, height: 14.5 },
      { x: 120.5, y: 680.25, width: 55.25, height: 14.5 },
    ],
  }
  const exported = await exportEditedPdf(original.slice().buffer, [], [highlight])
  const first = (await contentStreams(exported, 0))[0] ?? ''
  check(first.includes('72.5') && first.includes('120.5'), 'multi-line highlight writes every rectangle')
  check(first.includes('0.490') || first.includes('0.49'), 'green highlight keeps its color')
}

async function testHighlightAndEdit(original: Uint8Array): Promise<void> {
  const highlight = sentenceHighlight(HIGHLIGHT_COLORS.yellow)
  const edit: TextEdit = {
    id: 'sentence',
    pageNumber: 1,
    originalText: 'Payment must be completed within 30 days.',
    editedText: 'Edited terms',
    pdfX: 72,
    pdfY: 700,
    width: 220,
    height: 12,
    transform: [12, 0, 0, 12, 72, 700],
  }
  const exported = await exportEditedPdf(original.slice().buffer, [edit], [highlight])
  const streams = await contentStreams(exported, 0)
  const last = decodePdfStrings(streams[streams.length - 1] ?? '')
  const colorAt = last.indexOf('0.290')
  const textAt = last.indexOf('Edited terms')
  check(last.includes('Edited terms'), 'edited text is written into the PDF')
  check(colorAt >= 0 && textAt > colorAt, 'highlight is painted underneath the replacement text')
}

async function testPageOperationKeepsHighlightOnItsPage(): Promise<void> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([400, 500])
  const second = pdf.addPage([400, 500])
  first.drawText('Page A', { x: 48, y: 240, size: 18, font })
  second.drawText('Page B', { x: 48, y: 240, size: 18, font })
  const original = await pdf.save()
  const highlights: TextHighlight[] = [
    {
      id: 'on-a',
      pageNumber: 1,
      text: 'Page A',
      color: HIGHLIGHT_COLORS.yellow,
      opacity: 0.45,
      pdfRects: [{ x: 48.5, y: 236.25, width: 70.25, height: 16.5 }],
    },
    {
      id: 'on-b',
      pageNumber: 2,
      text: 'Page B',
      color: HIGHLIGHT_COLORS.blue,
      opacity: 0.45,
      pdfRects: [{ x: 48.5, y: 236.25, width: 70.25, height: 16.5 }],
    },
  ]
  const baked = await exportEditedPdf(original.slice().buffer, [], highlights)
  const deleted = await deletePage(baked, 0)
  const pages = await PDFDocument.load(deleted.slice())
  check(pages.getPageCount() === 1, 'deleting a page drops that page')
  const streams = await contentStreams(deleted, 0)
  const text = streams.map((stream) => decodePdfStrings(stream)).join('\n')
  check(text.includes('Page B'), 'the kept page still has its own text')
  check(text.includes('0.556'), 'the kept page still has its own highlight')
  check(!text.includes('0.290'), 'a highlight is not left behind on a different page')
}

async function testUnderline(original: Uint8Array): Promise<void> {
  const markup = lineMarkup('underline')
  const line = lineRect(markup.pdfRects[0]!, 'underline', markup.thickness)
  const exported = await exportEditedPdf(original.slice().buffer, [], [markup])
  const streams = await contentStreams(exported, 0)
  const readable = streams.map((stream) => decodePdfStrings(stream)).join('\n')
  check(streams[0]?.includes(String(line.y)) === true, 'underline is written at its PDF baseline')
  check(streams[0]?.includes('Payment must') !== true, 'the underline stream stays behind the page text')
  check(readable.includes('Payment must be completed within 30 days.'), 'underlined text stays in the PDF')
}

async function testStrikethrough(original: Uint8Array): Promise<void> {
  const markup = lineMarkup('strikethrough')
  const line = lineRect(markup.pdfRects[0]!, 'strikethrough', markup.thickness)
  const exported = await exportEditedPdf(original.slice().buffer, [], [markup])
  const streams = await contentStreams(exported, 0)
  const textIndex = streams.findIndex((stream) => decodePdfStrings(stream).includes('Payment must'))
  const lineIndex = streams.findIndex((stream) => stream.includes(String(line.y)))
  check(textIndex >= 0 && lineIndex > textIndex, 'strikethrough is painted across the glyphs')
}

async function testAllThreeMarkups(original: Uint8Array): Promise<void> {
  const highlight = sentenceHighlight(HIGHLIGHT_COLORS.yellow)
  const underline = lineMarkup('underline')
  const strike = lineMarkup('strikethrough')
  const exported = await exportEditedPdf(original.slice().buffer, [], [highlight, underline, strike])
  const streams = await contentStreams(exported, 0)
  const behind = streams[0] ?? ''
  const strikeLine = lineRect(strike.pdfRects[0]!, 'strikethrough', strike.thickness)
  const textIndex = streams.findIndex((stream) => decodePdfStrings(stream).includes('Payment must'))
  const strikeIndex = streams.findIndex((stream) => stream.includes(String(strikeLine.y)))
  check(behind.includes('72.5') && behind.includes('0.290'), 'highlight still paints behind the text')
  check(
    behind.includes(String(lineRect(underline.pdfRects[0]!, 'underline', underline.thickness).y)),
    'underline shares the behind-text stream with the highlight',
  )
  check(textIndex >= 0 && strikeIndex > textIndex, 'strikethrough stays above the original text')
}

async function testUnderlineAndEdit(original: Uint8Array): Promise<void> {
  const underline = lineMarkup('underline')
  const line = lineRect(underline.pdfRects[0]!, 'underline', underline.thickness)
  const edit: TextEdit = {
    id: 'sentence',
    pageNumber: 1,
    originalText: 'Payment must be completed within 30 days.',
    editedText: 'Edited terms',
    pdfX: 72,
    pdfY: 700,
    width: 220,
    height: 12,
    transform: [12, 0, 0, 12, 72, 700],
  }
  const exported = await exportEditedPdf(original.slice().buffer, [edit], [underline])
  const streams = await contentStreams(exported, 0)
  const last = decodePdfStrings(streams[streams.length - 1] ?? '')
  const lineAt = last.indexOf(String(line.y))
  const textAt = last.indexOf('Edited terms')
  check(lineAt >= 0 && textAt > lineAt, 'underline is painted before the replacement text')
}

async function testPageOperationKeepsUnderlineOnItsPage(): Promise<void> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([400, 500])
  const second = pdf.addPage([400, 500])
  first.drawText('Page A', { x: 48, y: 240, size: 18, font })
  second.drawText('Page B', { x: 48, y: 240, size: 18, font })
  const original = await pdf.save()
  const onA = lineMarkup('underline', {
    id: 'line-a',
    pageNumber: 1,
    text: 'Page A',
    pdfRects: [{ x: 48.5, y: 236.25, width: 70.25, height: 16.5 }],
  })
  const onB = lineMarkup('strikethrough', {
    id: 'line-b',
    pageNumber: 2,
    text: 'Page B',
    pdfRects: [{ x: 48.5, y: 236.25, width: 70.25, height: 16.5 }],
  })
  const baked = await exportEditedPdf(original.slice().buffer, [], [onA, onB])
  const deleted = await deletePage(baked, 0)
  const pages = await PDFDocument.load(deleted.slice())
  check(pages.getPageCount() === 1, 'deleting a page drops the other page annotations')
  const text = (await contentStreams(deleted, 0)).join('\n')
  const kept = lineRect(onB.pdfRects[0]!, 'strikethrough', onB.thickness)
  const dropped = lineRect(onA.pdfRects[0]!, 'underline', onA.thickness)
  check(text.includes(String(kept.y)), 'the kept page still has its strikethrough')
  check(!text.includes(String(dropped.y)), 'an underline is not left on a different page')
}

function lineMarkup(
  kind: 'underline' | 'strikethrough',
  overrides: Partial<TextMarkup> = {},
): TextMarkup {
  const pdfRects = overrides.pdfRects ?? [{ x: 72.5, y: 697.25, width: 88.25, height: 14.5 }]
  return {
    id: kind,
    kind,
    pageNumber: 1,
    text: '30 days',
    color: '#000000',
    opacity: 1,
    thickness: 0.87,
    pdfRects,
    ...overrides,
  }
}

function sentenceHighlight(color: string): TextHighlight {
  return {
    id: 'sentence',
    kind: 'highlight',
    pageNumber: 1,
    text: '30 days',
    color,
    opacity: 0.45,
    thickness: 0,
    pdfRects: [{ x: 72.5, y: 697.25, width: 88.25, height: 14.5 }],
  }
}

async function makeSentencePdf(): Promise<Uint8Array> {
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

async function opacities(bytes: Uint8Array, pageIndex: number): Promise<number[]> {
  const pdf = await PDFDocument.load(bytes.slice())
  const resources = pdf.getPage(pageIndex).node.Resources()
  if (!isDict(resources)) {
    return []
  }
  const states = lookupEntry(resources, 'ExtGState')
  if (!isDict(states)) {
    return []
  }
  const values: number[] = []
  for (const [key] of states.entries()) {
    const state = states.lookup(key)
    if (!isDict(state)) {
      continue
    }
    const opacity = lookupEntry(state, 'ca')
    if (isNumber(opacity)) {
      values.push(opacity.asNumber())
    }
  }
  return values
}

type PdfDictLike = {
  entries: () => Array<[PdfNameLike, unknown]>
  lookup: (key: PdfNameLike) => unknown
}

type PdfNameLike = {
  decodeText?: () => string
}

type PdfNumberLike = {
  asNumber: () => number
}

function lookupEntry(dict: PdfDictLike, name: string): unknown {
  for (const [key] of dict.entries()) {
    if (key.decodeText?.() === name) {
      return dict.lookup(key)
    }
  }
  return undefined
}

function isDict(value: unknown): value is PdfDictLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    'lookup' in value &&
    !('asNumber' in value)
  )
}

function isNumber(value: unknown): value is PdfNumberLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'asNumber' in value &&
    typeof value.asNumber === 'function'
  )
}

async function contentStreams(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes.slice())
  return streamList(pdf.getPage(pageIndex))
}

function streamList(page: PDFPage): string[] {
  const contents = page.node.Contents()
  if (!contents) {
    return []
  }
  if (isContentArray(contents)) {
    const streams: string[] = []
    for (let index = 0; index < contents.size(); index += 1) {
      streams.push(streamText(contents.lookup(index)))
    }
    return streams
  }
  return [streamText(contents)]
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

function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 0.01
}

await main()
