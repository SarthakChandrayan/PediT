import { PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import {
  commitDocument,
  createDocumentHistory,
  emptyDocumentSnapshot,
  isHistoryDirty,
  redoHistory,
  undoHistory,
  withPageOperation,
  type DocumentHistory,
} from './documentHistory.ts'
import {
  addBlankPage,
  deletePage,
  duplicatePage,
  reorderPages,
  rotatePage,
} from './pageOperations.ts'
import {
  clampPageNumber,
  fitPageScale,
  fitWidthScale,
  navigationAfterDocumentChange,
  pageAfterStructureChange,
  parsePageJump,
  thumbnailPageNumbers,
} from './pageNavigation.ts'
import type { SearchMatch } from './search.ts'

GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href

const CSS_PER_POINT = 96 / 72

describe('page thumbnails and navigation', () => {
  it('builds one thumbnail page number per PDF page', () => {
    expect(thumbnailPageNumbers(0)).toEqual([])
    expect(thumbnailPageNumbers(3)).toEqual([1, 2, 3])
    expect(thumbnailPageNumbers(3)).toHaveLength(3)
  })

  it('selects the clicked thumbnail as the current page', () => {
    const history = openHistory()
    const before = fingerprint(history)
    const currentPage = clampPageNumber(2, 3)

    expect(currentPage).toBe(2)
    expect(thumbnailPageNumbers(3)[currentPage - 1]).toBe(2)
    expect(fingerprint(history)).toEqual(before)
    expect(isHistoryDirty(history)).toBe(false)
  })

  it('follows the visible page with the selected thumbnail', () => {
    const currentPage = 3
    const pages = thumbnailPageNumbers(5)
    expect(pages[currentPage - 1]).toBe(currentPage)
    expect(pages.filter((page) => page === currentPage)).toEqual([3])
  })

  it('jumps to an entered page number', () => {
    expect(parsePageJump('12', 25)).toBe(12)
    expect(parsePageJump(' 7 ', 25)).toBe(7)
    expect(parsePageJump('1', 1)).toBe(1)
  })

  it('rejects empty, non-numeric, decimal, and out-of-range page numbers', () => {
    expect(parsePageJump('', 25)).toBeNull()
    expect(parsePageJump('   ', 25)).toBeNull()
    expect(parsePageJump('abc', 25)).toBeNull()
    expect(parsePageJump('12a', 25)).toBeNull()
    expect(parsePageJump('0', 25)).toBeNull()
    expect(parsePageJump('-1', 25)).toBeNull()
    expect(parsePageJump('26', 25)).toBeNull()
    expect(parsePageJump('1.5', 25)).toBeNull()
    expect(parsePageJump('12.0', 25)).toBeNull()
  })

  it('calculates fit width from the page and the viewer width', () => {
    expect(fitWidthScale(612, 816, CSS_PER_POINT)).toBeCloseTo(1)
    expect(fitWidthScale(612, 408, CSS_PER_POINT)).toBeCloseTo(0.5)
    expect(fitWidthScale(612, 10_000, CSS_PER_POINT)).toBe(3)
  })

  it('calculates fit page from width and height without stretching', () => {
    expect(fitPageScale(612, 792, 816, 1056, CSS_PER_POINT)).toBeCloseTo(1)
    const wide = fitPageScale(612, 792, 816, 400, CSS_PER_POINT)
    const tall = fitPageScale(792, 612, 400, 1056, CSS_PER_POINT)
    expect(wide).toBeCloseTo(0.5)
    expect(tall).toBeCloseTo(0.5)
    const widthScale = 900 / (612 * CSS_PER_POINT)
    const heightScale = 500 / (792 * CSS_PER_POINT)
    expect(fitPageScale(612, 792, 900, 500, CSS_PER_POINT)).toBeCloseTo(
      Math.min(Math.max(Math.min(widthScale, heightScale), 0.5), 3),
    )
  })

  it('moves the current page to the search match page', () => {
    const history = openHistory()
    const before = fingerprint(history)
    const match: Pick<SearchMatch, 'pageNumber'> = { pageNumber: 4 }
    const currentPage = clampPageNumber(match.pageNumber, 6)

    expect(currentPage).toBe(match.pageNumber)
    expect(thumbnailPageNumbers(6)[currentPage - 1]).toBe(4)
    expect(fingerprint(history)).toEqual(before)
  })

  it('drops a thumbnail when a page is deleted and keeps the selection valid', async () => {
    const bytes = await labeledPdf()
    const next = await deletePage(bytes, 1)
    const count = await pageCount(next)
    expect(thumbnailPageNumbers(count)).toEqual([1, 2])
    expect(pageAfterStructureChange(2, count)).toBe(2)
    expect(pageAfterStructureChange(3, count)).toBe(2)
  })

  it('keeps thumbnail numbers aligned after a reorder', async () => {
    const bytes = await sizedPdf()
    const next = await reorderPages(bytes, 2, 0)
    const sizes = await pageSizes(next)
    expect(thumbnailPageNumbers(sizes.length)).toEqual([1, 2, 3])
    expect(sizes.map((size) => size.width)).toEqual([400, 200, 300])
  })

  it('adds a thumbnail when a page is duplicated', async () => {
    const bytes = await sizedPdf()
    const next = await duplicatePage(bytes, 0)
    const sizes = await pageSizes(next)
    expect(thumbnailPageNumbers(sizes.length)).toEqual([1, 2, 3, 4])
    expect(sizes.map((size) => size.width)).toEqual([200, 200, 300, 400])
  })

  it('adds a thumbnail when a blank page is inserted', async () => {
    const bytes = await sizedPdf()
    const next = await addBlankPage(bytes, 1)
    const count = await pageCount(next)
    expect(thumbnailPageNumbers(count)).toEqual([1, 2, 3, 4])
    expect(pageAfterStructureChange(2, count)).toBe(2)
  })

  it('changes the thumbnail viewport when a page is rotated', async () => {
    const bytes = await sizedPdf()
    const before = await viewportSize(bytes, 1)
    const rotated = await rotatePage(bytes, 0, 90)
    const after = await viewportSize(rotated, 1)
    expect(after.width).toBeCloseTo(before.height)
    expect(after.height).toBeCloseTo(before.width)
    expect(thumbnailPageNumbers(await pageCount(rotated))).toEqual([1, 2, 3])
  })

  it('restores thumbnail structure on undo and redo of a page move', async () => {
    const bytes = await sizedPdf()
    let history = createDocumentHistory({ ...emptyDocumentSnapshot(), pdfBytes: bytes })
    const moved = await reorderPages(bytes, 2, 0)
    history = commitDocument(history, () => withPageOperation(moved), { pdfChanged: true })
    expect(await widths(history)).toEqual([400, 200, 300])

    history = undoHistory(history)
    expect(await widths(history)).toEqual([200, 300, 400])
    expect(thumbnailPageNumbers(await pageCount(history.present.snapshot.pdfBytes))).toEqual([
      1, 2, 3,
    ])

    history = redoHistory(history)
    expect(await widths(history)).toEqual([400, 200, 300])
  })

  it('resets navigation when another document or version is opened', () => {
    expect(navigationAfterDocumentChange()).toEqual({ currentPage: 1 })
    expect(thumbnailPageNumbers(0)).toEqual([])
  })

  it('does not dirty the document when the current page changes', () => {
    const history = openHistory()
    const before = fingerprint(history)
    const currentPage = clampPageNumber(3, 4)
    expect(currentPage).toBe(3)
    expect(isHistoryDirty(history)).toBe(false)
    expect(fingerprint(history)).toEqual(before)
  })

  it('does not create undo or redo history for page jumps or zoom', () => {
    let history = openHistory()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      edits: [
        ...snapshot.edits,
        {
          id: '1:0',
          pageNumber: 1,
          originalText: 'A',
          editedText: 'B',
          pdfX: 1,
          pdfY: 1,
          width: 10,
          height: 10,
          transform: [12, 0, 0, 12, 1, 1],
        },
      ],
    }))
    const before = fingerprint(history)
    parsePageJump('2', 4)
    fitWidthScale(612, 700, CSS_PER_POINT)
    fitPageScale(612, 792, 700, 800, CSS_PER_POINT)
    clampPageNumber(2, 4)
    expect(fingerprint(history)).toEqual(before)
    expect(history.past).toHaveLength(1)
    expect(history.future).toHaveLength(0)

    history = undoHistory(history)
    expect(history.present.snapshot.edits).toEqual([])
    history = redoHistory(history)
    expect(history.present.snapshot.edits).toHaveLength(1)
  })
})

function openHistory(): DocumentHistory {
  return createDocumentHistory()
}

function fingerprint(history: DocumentHistory) {
  return {
    past: history.past.length,
    future: history.future.length,
    epoch: history.present.epoch,
    savedEpoch: history.savedEpoch,
    dirty: isHistoryDirty(history),
    pdfBytes: history.present.snapshot.pdfBytes,
    edits: history.present.snapshot.edits,
  }
}

async function labeledPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const label of ['One', 'Two', 'Three']) {
    const page = pdf.addPage([612, 792])
    page.drawText(label, { x: 72, y: 700, size: 18, font })
  }
  return pdf.save()
}

async function sizedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([200, 400])
  pdf.addPage([300, 400])
  pdf.addPage([400, 500])
  return pdf.save()
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPageCount()
}

async function pageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPages().map((page) => page.getSize())
}

async function widths(history: DocumentHistory): Promise<number[]> {
  const sizes = await pageSizes(history.present.snapshot.pdfBytes)
  return sizes.map((size) => size.width)
}

async function viewportSize(
  bytes: Uint8Array,
  pageNumber: number,
): Promise<{ width: number; height: number }> {
  const pdf = await getDocument({ data: bytes.slice() }).promise
  try {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    return { width: viewport.width, height: viewport.height }
  } finally {
    await pdf.destroy()
  }
}
