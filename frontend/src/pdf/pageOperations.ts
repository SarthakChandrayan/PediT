import { PDFDocument, PageSizes, degrees } from 'pdf-lib'

/** Clockwise rotation applied on top of a page's current rotation. */
export type PageRotation = 90 | 180 | 270

const [A4_WIDTH, A4_HEIGHT] = PageSizes.A4

/**
 * Page structure changes. Each function loads a copy of the input and returns
 * a new PDF. The Uint8Array passed in is not modified.
 */
export class PageOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageOperationError'
  }
}

export async function deletePage(
  pdfBytes: Uint8Array,
  pageIndex: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes)
  const pageCount = pdf.getPageCount()
  if (pageCount < 2) {
    throw new PageOperationError('The last page cannot be deleted.')
  }
  assertPageIndex(pageIndex, pageCount)
  pdf.removePage(pageIndex)
  return pdf.save()
}

export async function rotatePage(
  pdfBytes: Uint8Array,
  pageIndex: number,
  rotation: PageRotation,
): Promise<Uint8Array> {
  assertRotation(rotation)
  const pdf = await loadPdf(pdfBytes)
  const pageCount = pdf.getPageCount()
  assertPageIndex(pageIndex, pageCount)
  const page = pdf.getPage(pageIndex)
  const next = normalizeQuarterTurn(page.getRotation().angle + rotation)
  page.setRotation(degrees(next))
  return pdf.save()
}

export async function duplicatePage(
  pdfBytes: Uint8Array,
  pageIndex: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes)
  const pageCount = pdf.getPageCount()
  assertPageIndex(pageIndex, pageCount)
  const [copy] = await pdf.copyPages(pdf, [pageIndex])
  if (!copy) {
    throw new PageOperationError('That page could not be duplicated.')
  }
  pdf.insertPage(pageIndex + 1, copy)
  return pdf.save()
}

/**
 * Moves the page at `fromIndex` so it lands at `toIndex`.
 * Indexes are positions in the original page list.
 * Moving index 2 to index 0 turns [1, 2, 3] into [3, 1, 2].
 */
export async function reorderPages(
  pdfBytes: Uint8Array,
  fromIndex: number,
  toIndex: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes)
  const pageCount = pdf.getPageCount()
  assertPageIndex(fromIndex, pageCount)
  assertPageIndex(toIndex, pageCount)
  if (fromIndex === toIndex) {
    return cloneBytes(pdfBytes)
  }

  const page = pdf.getPage(fromIndex)
  pdf.removePage(fromIndex)
  pdf.insertPage(toIndex, page)
  return pdf.save()
}

/**
 * Inserts an empty page at `insertIndex`.
 * Omitted dimensions copy the neighboring page's media box.
 * A document with no pages, or no neighbor, falls back to A4.
 */
export async function addBlankPage(
  pdfBytes: Uint8Array,
  insertIndex: number,
  width?: number,
  height?: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes)
  const pageCount = pdf.getPageCount()
  assertInsertIndex(insertIndex, pageCount)
  const size = blankPageSize(pdf, insertIndex, width, height)
  pdf.insertPage(insertIndex, size)
  return pdf.save()
}

async function loadPdf(pdfBytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(cloneBytes(pdfBytes))
}

function cloneBytes(pdfBytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(pdfBytes.byteLength)
  copy.set(pdfBytes)
  return copy
}

function assertPageIndex(pageIndex: number, pageCount: number): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new PageOperationError(
      `Page index ${pageIndex} is outside this PDF (0–${Math.max(pageCount - 1, 0)}).`,
    )
  }
}

function assertInsertIndex(insertIndex: number, pageCount: number): void {
  if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > pageCount) {
    throw new PageOperationError(
      `Insert index ${insertIndex} is outside 0–${pageCount}.`,
    )
  }
}

function assertRotation(rotation: number): asserts rotation is PageRotation {
  if (rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new PageOperationError('Rotation must be 90, 180, or 270 degrees.')
  }
}

function normalizeQuarterTurn(angle: number): number {
  const quarters = Math.round(angle / 90)
  return ((((quarters % 4) + 4) % 4) * 90)
}

function blankPageSize(
  pdf: PDFDocument,
  insertIndex: number,
  width: number | undefined,
  height: number | undefined,
): [number, number] {
  const requestedWidth = optionalDimension(width, 'Width')
  const requestedHeight = optionalDimension(height, 'Height')
  const pageCount = pdf.getPageCount()
  const neighbor =
    pageCount === 0
      ? undefined
      : pdf.getPage(insertIndex > 0 ? insertIndex - 1 : 0).getSize()

  return [
    requestedWidth ?? neighbor?.width ?? A4_WIDTH,
    requestedHeight ?? neighbor?.height ?? A4_HEIGHT,
  ]
}

function optionalDimension(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new PageOperationError(`${label} must be a positive number.`)
  }
  return value
}
