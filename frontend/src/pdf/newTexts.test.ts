import { PDFDocument, StandardFonts, setCharacterSpacing, setTextRenderingMode, setTextRise, setWordSpacing, TextRenderingMode } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { pdfRectToViewportBox } from './coordinates.ts'
import {
  beginGesture,
  commitDocument,
  createDocumentHistory,
  endGesture,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  resetHistory,
  undoHistory,
  updateGesture,
  withPageOperation,
  type DocumentHistory,
  type DocumentSnapshot,
} from './documentHistory.ts'
import { exportEditedPdf } from './exportPdf.ts'
import type { DrawingAnnotation } from './drawings.ts'
import type { TextMarkup } from './highlights.ts'
import type { ImageAnnotation } from './images.ts'
import {
  clampNewTextBox,
  createNewText,
  DEFAULT_NEW_TEXT_FONT,
  DEFAULT_NEW_TEXT_SIZE,
  MIN_NEW_TEXT_WIDTH,
  moveNewText,
  newTextFromPointer,
  newTextPdfRect,
  patchNewTextStyle,
  resizeNewTextWidth,
  type NewTextAnnotation,
} from './newTexts.ts'
import { rotatePage } from './pageOperations.ts'
import {
  createSearchModel,
  extractSearchDocument,
  findTextMatches,
  setSearchQuery,
} from './search.ts'
import { pdfTextOperators } from './textAppearance.ts'
import type { TextEdit } from './textEdits.ts'

GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('new text', () => {
  it('creates a text annotation on the clicked page with default Helvetica 14', () => {
    const created = createNewText({
      id: 't1',
      pageNumber: 2,
      pdfX: 80,
      pdfY: 200,
      pageWidth: 300,
      pageHeight: 400,
      text: 'Hello',
    })
    expect(created.id).toBe('t1')
    expect(created.pageNumber).toBe(2)
    expect(created.text).toBe('Hello')
    expect(created.fontName).toBe(DEFAULT_NEW_TEXT_FONT)
    expect(created.fontSize).toBe(DEFAULT_NEW_TEXT_SIZE)
    expect(created.bold).toBe(false)
    expect(created.italic).toBe(false)
    expect(created.color).toEqual({ r: 0, g: 0, b: 0 })
    expect(created.horizontalScale).toBe(1)
    expect(created.width).toBeGreaterThanOrEqual(MIN_NEW_TEXT_WIDTH)
  })

  it('converts client clicks to PDF coordinates and ignores zoom for the stored point', () => {
    const page = pageElement(10, 20)
    const at100 = newTextFromPointer({
      pageNumber: 1,
      viewport: mockViewport(1),
      clientX: 10 + 90,
      clientY: 20 + 80,
      pageElement: page,
    })
    const at50 = newTextFromPointer({
      pageNumber: 1,
      viewport: mockViewport(0.5),
      clientX: 10 + 45,
      clientY: 20 + 40,
      pageElement: page,
    })
    const at200 = newTextFromPointer({
      pageNumber: 1,
      viewport: mockViewport(2),
      clientX: 10 + 180,
      clientY: 20 + 160,
      pageElement: page,
    })
    expect(at100.pageWidth).toBe(300)
    expect(at100.pageHeight).toBe(400)
    expect(at100.pdfX).toBeCloseTo(90)
    expect(at100.pdfY).toBeCloseTo(320)
    expect(at50.pdfX).toBeCloseTo(at100.pdfX)
    expect(at50.pdfY).toBeCloseTo(at100.pdfY)
    expect(at200.pdfX).toBeCloseTo(at100.pdfX)
    expect(at200.pdfY).toBeCloseTo(at100.pdfY)

    const created = createNewText({
      id: 'placed',
      pageNumber: 1,
      pdfX: at100.pdfX,
      pdfY: at100.pdfY,
      pageWidth: at100.pageWidth,
      pageHeight: at100.pageHeight,
    })
    const box100 = pdfRectToViewportBox(mockViewport(1), newTextPdfRect(created))
    const box50 = pdfRectToViewportBox(mockViewport(0.5), newTextPdfRect(created))
    const box200 = pdfRectToViewportBox(mockViewport(2), newTextPdfRect(created))
    expect(box50.left).toBeCloseTo(box100.left * 0.5)
    expect(box50.top).toBeCloseTo(box100.top * 0.5)
    expect(box200.left).toBeCloseTo(box100.left * 2)
    expect(box200.top).toBeCloseTo(box100.top * 2)
    expect(created.pdfX).toBe(createNewText({
      id: 'again',
      pageNumber: 1,
      pdfX: at200.pdfX,
      pdfY: at200.pdfY,
      pageWidth: at200.pageWidth,
      pageHeight: at200.pageHeight,
    }).pdfX)
  })

  it('moves in PDF space and clamps the box to the page', () => {
    const start = boxOf(createNewText({
      id: 'm',
      pageNumber: 1,
      pdfX: 80,
      pdfY: 120,
      pageWidth: 300,
      pageHeight: 400,
    }))
    const moved = moveNewText(start, { x: 80, y: 120 }, { x: 110, y: 90 }, 300, 400)
    expect(moved.pdfX).toBeCloseTo(start.pdfX + 30)
    expect(moved.pdfY).toBeCloseTo(start.pdfY - 30)
    expect(moved.width).toBe(start.width)
    expect(insidePage(moved, 300, 400, start.height)).toBe(true)

    const off = moveNewText(start, { x: 80, y: 120 }, { x: -800, y: 2000 }, 300, 400)
    expect(off.pdfX).toBe(0)
    expect(insidePage(off, 300, 400, start.height)).toBe(true)
  })

  it('resizes horizontally and enforces a minimum width', () => {
    const start = boxOf(createNewText({
      id: 'r',
      pageNumber: 1,
      pdfX: 40,
      pdfY: 80,
      pageWidth: 300,
      pageHeight: 400,
    }))
    const wider = resizeNewTextWidth(start, start.pdfX + 180, 300, 400)
    expect(wider.width).toBeCloseTo(180)
    expect(wider.pdfY).toBe(start.pdfY)
    expect(wider.height).toBe(start.height)

    const tooSmall = resizeNewTextWidth(start, start.pdfX + 4, 300, 400)
    expect(tooSmall.width).toBe(MIN_NEW_TEXT_WIDTH)
  })

  it('stores font, size, bold, italic, and color changes', () => {
    const created = createNewText({
      id: 's',
      pageNumber: 1,
      pdfX: 40,
      pdfY: 80,
      pageWidth: 300,
      pageHeight: 400,
    })
    const styled = patchNewTextStyle(created, {
      fontName: 'Times-Roman',
      fontSize: 24,
      bold: true,
      italic: true,
      color: { r: 0.2, g: 0.4, b: 0.8 },
    })
    expect(styled.fontName).toBe('Times-Roman')
    expect(styled.fontSize).toBe(24)
    expect(styled.bold).toBe(true)
    expect(styled.italic).toBe(true)
    expect(styled.color).toEqual({ r: 0.2, g: 0.4, b: 0.8 })
    expect(styled.height).toBeGreaterThan(created.height)
  })

  it('deletes a created annotation and keeps other overlays', async () => {
    let history = await openPdf()
    const created = sampleText('keep-me')
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: [created],
      markups: [markup('h1')],
      selectedTextId: created.id,
    }))
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.filter((item) => item.id !== created.id),
      selectedTextId: null,
    }))
    expect(history.present.snapshot.texts).toHaveLength(0)
    expect(history.present.snapshot.markups).toHaveLength(1)
  })

  it('undoes and redoes creation, movement, resize, and formatting as one step each', async () => {
    let history = await openPdf()
    expect(isHistoryDirty(history)).toBe(false)
    const created = sampleText('Hello')
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: [...snapshot.texts, created],
    }))
    expect(isHistoryDirty(history)).toBe(true)
    expect(history.present.snapshot.texts[0]?.text).toBe('Hello')

    history = undoHistory(history)
    expect(history.present.snapshot.texts).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)
    history = redoHistory(history)
    expect(history.present.snapshot.texts[0]?.text).toBe('Hello')
    expect(isHistoryDirty(history)).toBe(true)

    const originX = history.present.snapshot.texts[0]?.pdfX
    let dragging = beginGesture(history)
    for (let step = 1; step <= 20; step += 1) {
      dragging = updateGesture(dragging, (snapshot) => ({
        ...snapshot,
        texts: snapshot.texts.map((item) =>
          item.id === created.id ? { ...item, pdfX: created.pdfX + step } : item,
        ),
      }))
      expect(dragging.past).toHaveLength(1)
    }
    history = endGesture(dragging)
    expect(history.past).toHaveLength(2)
    expect(history.present.snapshot.texts[0]?.pdfX).toBe(created.pdfX + 20)
    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.pdfX).toBe(originX)
    history = redoHistory(history)
    expect(history.present.snapshot.texts[0]?.pdfX).toBe(created.pdfX + 20)

    const beforeWidth = history.present.snapshot.texts[0]?.width
    let resizing = beginGesture(history)
    resizing = updateGesture(resizing, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === created.id ? { ...item, width: 80 } : item,
      ),
    }))
    resizing = updateGesture(resizing, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === created.id ? { ...item, width: 160 } : item,
      ),
    }))
    history = endGesture(resizing)
    expect(history.present.snapshot.texts[0]?.width).toBe(160)
    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.width).toBe(beforeWidth)
    history = redoHistory(history)
    expect(history.present.snapshot.texts[0]?.width).toBe(160)

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === created.id ? patchNewTextStyle(item, { fontName: 'Courier', fontSize: 18 }) : item,
      ),
    }))
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === created.id ? patchNewTextStyle(item, { bold: true }) : item,
      ),
    }))
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === created.id ? patchNewTextStyle(item, { italic: true }) : item,
      ),
    }))
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === created.id
          ? patchNewTextStyle(item, { color: { r: 1, g: 0, b: 0 } })
          : item,
      ),
    }))
    expect(history.present.snapshot.texts[0]?.fontName).toBe('Courier')
    expect(history.present.snapshot.texts[0]?.bold).toBe(true)
    expect(history.present.snapshot.texts[0]?.italic).toBe(true)
    expect(history.present.snapshot.texts[0]?.color.r).toBe(1)

    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.color.r).toBe(0)
    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.italic).toBe(false)
    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.bold).toBe(false)
    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.fontName).toBe('Helvetica')
    expect(history.present.snapshot.texts[0]?.fontSize).toBe(14)
  })

  it('marks the document dirty until undo returns to the saved state', async () => {
    let history = await openPdf()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: [sampleText('Draft')],
    }))
    expect(isHistoryDirty(history)).toBe(true)
    history = markHistorySaved(history)
    expect(isHistoryDirty(history)).toBe(false)
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) => ({ ...item, text: 'Changed' })),
    }))
    expect(isHistoryDirty(history)).toBe(true)
    history = undoHistory(history)
    expect(isHistoryDirty(history)).toBe(false)
    history = redoHistory(history)
    expect(isHistoryDirty(history)).toBe(true)
  })

  it('exports created text as selectable vector text with fill-only state', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([300, 400])
    page.pushOperators(
      setTextRenderingMode(TextRenderingMode.FillAndOutline),
      setCharacterSpacing(4),
      setWordSpacing(6),
      setTextRise(3),
    )
    const original = await source.save()
    const created = sampleText('Created', { pdfX: 40, pdfY: 220, fontSize: 16 })
    const exported = await exportEditedPdf(copyBuffer(original), [], [], [], [], [created])
    const items = await textItems(exported)
    const drawn = items.find((item) => item.str === 'Created')
    expect(drawn).toBeTruthy()
    expect(drawn?.transform[4]).toBeCloseTo(40, 0)
    expect(drawn?.transform[5]).toBeCloseTo(220, 0)
    expect(pdfHasImage(exported)).toBe(false)
    expect(await lastTextRenderingMode(exported)).toBe(0)
    expect(await lastTextState(exported)).toEqual({
      renderingMode: 0,
      charSpacing: 0,
      wordSpacing: 0,
      hScale: 100,
      rise: 0,
    })

    const unsupported = sampleText('Hello😀', { id: 'u1' })
    const fallback = await exportEditedPdf(copyBuffer(original), [], [], [], [], [unsupported])
    const fallbackItems = await textItems(fallback)
    expect(fallbackItems.some((item) => item.str.includes('?'))).toBe(true)
  })

  it('survives save/reopen and is searchable only after it is baked', async () => {
    let history = await openPdf()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: [sampleText('UniquePhrase')],
    }))
    const overlayPdf = await openPdfJs(history.present.snapshot.pdfBytes)
    try {
      const overlayPages = await extractSearchDocument(overlayPdf)
      expect(
        findTextMatches(
          overlayPages,
          setSearchQuery(createSearchModel(), 'UniquePhrase').query,
          false,
        ),
      ).toEqual([])
    } finally {
      await overlayPdf.destroy()
    }

    const saved = await exportSnapshot(history.present.snapshot)
    history = resetHistory(history, snapshotOf(saved))
    expect(history.present.snapshot.texts).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)
    const savedPdf = await openPdfJs(saved)
    try {
      const pages = await extractSearchDocument(savedPdf)
      const hits = findTextMatches(pages, 'UniquePhrase', false)
      expect(hits.some((hit) => hit.text.includes('UniquePhrase'))).toBe(true)
    } finally {
      await savedPdf.destroy()
    }
  })

  it('bakes created text into page operations and keeps the page-relative position after rotate', async () => {
    let history = await openPdf()
    const created = sampleText('RotateMe', { pdfX: 36, pdfY: 80 })
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      texts: [created],
    }))
    const baked = await exportSnapshot(history.present.snapshot)
    const rotated = await rotatePage(baked, 0, 90)
    history = commitDocument(history, () => withPageOperation(rotated), { pdfChanged: true })
    expect(history.present.snapshot.texts).toHaveLength(0)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(90)
    const items = await textItems(history.present.snapshot.pdfBytes)
    expect(items.some((item) => item.str === 'RotateMe')).toBe(true)

    history = undoHistory(history)
    expect(history.present.snapshot.texts[0]?.pdfX).toBe(created.pdfX)
    expect(history.present.snapshot.texts[0]?.pdfY).toBe(created.pdfY)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(0)
  })

  it('does not disturb existing text edits, search, drawings, images, markups, or versioning', async () => {
    let history = await openPdf()
    const edit = textEdit('World')
    const highlight = markup('h1')
    const drawing = rectangle('d1')
    const image = imageAnnotation('img', pngBytes())
    const created = sampleText('Overlay')
    history = commitDocument(history, (snapshot) => ({ ...snapshot, edits: [edit] }))
    history = commitDocument(history, (snapshot) => ({ ...snapshot, markups: [highlight] }))
    history = commitDocument(history, (snapshot) => ({ ...snapshot, drawings: [drawing] }))
    history = commitDocument(history, (snapshot) => ({ ...snapshot, images: [image] }))
    history = commitDocument(history, (snapshot) => ({ ...snapshot, texts: [created] }))

    expect(history.present.snapshot.edits[0]?.editedText).toBe('World')
    expect(history.present.snapshot.markups[0]?.id).toBe('h1')
    expect(history.present.snapshot.drawings[0]?.id).toBe('d1')
    expect(history.present.snapshot.images[0]?.id).toBe('img')
    expect(history.present.snapshot.texts[0]?.text).toBe('Overlay')

    const searchPdf = await openPdfJs(history.present.snapshot.pdfBytes)
    try {
      const pages = await extractSearchDocument(searchPdf)
      expect(findTextMatches(pages, 'Hello', false).length).toBeGreaterThan(0)
    } finally {
      await searchPdf.destroy()
    }

    const exported = await exportSnapshot(history.present.snapshot)
    const items = await textItems(exported)
    expect(items.some((item) => item.str === 'World')).toBe(true)
    expect(items.some((item) => item.str === 'Overlay')).toBe(true)
    expect(pdfHasImage(exported)).toBe(true)

    history = undoHistory(history)
    expect(history.present.snapshot.texts).toHaveLength(0)
    expect(history.present.snapshot.images).toHaveLength(1)
    history = redoHistory(history)
    expect(history.present.snapshot.texts).toHaveLength(1)

    const baked = await exportSnapshot(history.present.snapshot)
    history = commitDocument(history, () => withPageOperation(baked), { pdfChanged: true })
    expect(history.present.snapshot.edits).toHaveLength(0)
    expect(history.present.snapshot.markups).toHaveLength(0)
    expect(history.present.snapshot.drawings).toHaveLength(0)
    expect(history.present.snapshot.images).toHaveLength(0)
    expect(history.present.snapshot.texts).toHaveLength(0)
  })
})

function mockViewport(scale: number, pageWidth = 300, pageHeight = 400): PageViewport {
  return {
    width: pageWidth * scale,
    height: pageHeight * scale,
    scale,
    convertToViewportPoint(x: number, y: number) {
      return [x * scale, (pageHeight - y) * scale]
    },
    convertToPdfPoint(x: number, y: number) {
      return [x / scale, pageHeight - y / scale]
    },
  } as PageViewport
}

function pageElement(left: number, top: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + 300,
      bottom: top + 400,
      width: 300,
      height: 400,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
  } as HTMLElement
}

function boxOf(text: NewTextAnnotation) {
  return { pdfX: text.pdfX, pdfY: text.pdfY, width: text.width, height: text.height }
}

function insidePage(
  box: { pdfX: number; pdfY: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  height: number,
): boolean {
  const clamped = clampNewTextBox(box, pageWidth, pageHeight)
  return (
    clamped.pdfX >= 0 &&
    clamped.pdfX + clamped.width <= pageWidth + 0.001 &&
    clamped.pdfY - height * 0.25 >= -0.001 &&
    clamped.pdfY + (height - height * 0.25) <= pageHeight + 0.001
  )
}

function sampleText(
  text: string,
  extra: Partial<NewTextAnnotation> = {},
): NewTextAnnotation {
  return {
    ...createNewText({
      id: extra.id ?? 't1',
      pageNumber: extra.pageNumber ?? 1,
      pdfX: extra.pdfX ?? 40,
      pdfY: extra.pdfY ?? 80,
      pageWidth: 300,
      pageHeight: 400,
      text,
    }),
    ...extra,
    text,
    color: extra.color ?? { r: 0, g: 0, b: 0 },
  }
}

async function openPdf(): Promise<DocumentHistory> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([300, 400])
  page.drawText('Hello', { x: 36, y: 300, size: 14, font })
  return createDocumentHistory(snapshotOf(await pdf.save()))
}

function snapshotOf(pdfBytes: Uint8Array): DocumentSnapshot {
  return {
    pdfBytes,
    edits: [],
    markups: [],
    drawings: [],
    images: [],
    texts: [],
    selectedMarkupId: null,
    selectedDrawingId: null,
    selectedImageId: null,
    selectedTextId: null,
  }
}

async function exportSnapshot(snapshot: DocumentSnapshot): Promise<Uint8Array> {
  const copy = new ArrayBuffer(snapshot.pdfBytes.byteLength)
  new Uint8Array(copy).set(snapshot.pdfBytes)
  return exportEditedPdf(
    copy,
    snapshot.edits,
    snapshot.markups,
    snapshot.drawings,
    snapshot.images,
    snapshot.texts,
  )
}

async function textItems(bytes: Uint8Array): Promise<Array<{ str: string; transform: number[] }>> {
  const pdf = await openPdfJs(bytes)
  try {
    const page = await pdf.getPage(1)
    const text = await page.getTextContent()
    return text.items.flatMap((entry) => {
      if (!('str' in entry)) {
        return []
      }
      return [{ str: entry.str, transform: entry.transform.slice(0, 6).map((value) => Number(value)) }]
    })
  } finally {
    await pdf.destroy()
  }
}

async function lastTextRenderingMode(bytes: Uint8Array): Promise<number | undefined> {
  return (await lastTextState(bytes)).renderingMode
}

async function lastTextState(bytes: Uint8Array): Promise<{
  renderingMode: number
  charSpacing: number
  wordSpacing: number
  hScale: number
  rise: number
}> {
  const pdf = await openPdfJs(bytes)
  try {
    const page = await pdf.getPage(1)
    const ops = await page.getOperatorList()
    let renderingMode = 0
    let charSpacing = 0
    let wordSpacing = 0
    let hScale = 100
    let rise = 0
    let last = { renderingMode, charSpacing, wordSpacing, hScale, rise }
    for (let index = 0; index < ops.fnArray.length; index += 1) {
      const fn = ops.fnArray[index]
      const args = ops.argsArray[index] ?? []
      if (fn === pdfTextOperators.setTextRenderingMode && typeof args[0] === 'number') {
        renderingMode = args[0]
      }
      if (fn === pdfTextOperators.setCharSpacing && typeof args[0] === 'number') {
        charSpacing = args[0]
      }
      if (fn === pdfTextOperators.setWordSpacing && typeof args[0] === 'number') {
        wordSpacing = args[0]
      }
      if (fn === pdfTextOperators.setHScale && typeof args[0] === 'number') {
        hScale = args[0]
      }
      if (fn === pdfTextOperators.setTextRise && typeof args[0] === 'number') {
        rise = args[0]
      }
      if (fn === pdfTextOperators.showText || fn === pdfTextOperators.showSpacedText) {
        last = { renderingMode, charSpacing, wordSpacing, hScale, rise }
      }
    }
    return last
  } finally {
    await pdf.destroy()
  }
}

async function openPdfJs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes.slice() }).promise
}

async function pageRotation(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPage(0).getRotation().angle
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function pdfHasImage(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes)
  return text.includes('/Subtype /Image') || text.includes('/Subtype/Image')
}

function textEdit(editedText: string): TextEdit {
  return {
    id: '1:0',
    pageNumber: 1,
    originalText: 'Hello',
    editedText,
    pdfX: 36,
    pdfY: 300,
    width: 40,
    height: 14,
    transform: [14, 0, 0, 14, 36, 300],
  }
}

function markup(id: string): TextMarkup {
  return {
    id,
    kind: 'highlight',
    pageNumber: 1,
    text: 'Hello',
    pdfRects: [{ x: 36, y: 300, width: 40, height: 14 }],
    color: '#ffe14a',
    opacity: 0.45,
    thickness: 0,
  }
}

function rectangle(id: string): DrawingAnnotation {
  return {
    id,
    pageNumber: 1,
    kind: 'rectangle',
    points: [
      { x: 10, y: 10 },
      { x: 40, y: 40 },
    ],
    color: '#000000',
    opacity: 1,
    thickness: 2,
  }
}

function imageAnnotation(id: string, bytes: Uint8Array): ImageAnnotation {
  return {
    id,
    pageNumber: 1,
    x: 12,
    y: 18,
    width: 20,
    height: 20,
    originalWidth: 1,
    originalHeight: 1,
    format: 'png',
    bytes,
  }
}

function pngBytes(): Uint8Array {
  const binary = atob(PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
