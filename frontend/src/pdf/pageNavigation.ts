import { MAX_PDF_SCALE, MIN_PDF_SCALE } from './scale.ts'

/** CSS width of a thumbnail preview. The PDF page is not rendered at full size. */
export const THUMBNAIL_CSS_WIDTH = 112

/** Horizontal padding around the page stack in the main viewer. */
export const VIEWER_FIT_INSET_X = 48

/** Vertical padding kept clear when fitting a page into the viewer. */
export const VIEWER_FIT_INSET_Y = 56

export function thumbnailPageNumbers(pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return []
  }
  return Array.from({ length: pageCount }, (_, index) => index + 1)
}

export function clampPageNumber(page: number, pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return 1
  }
  const whole = Number.isFinite(page) ? Math.trunc(page) : 1
  return Math.min(Math.max(whole, 1), pageCount)
}

/**
 * Accepts a whole page number inside 1..pageCount.
 * Empty, non-numeric, decimal, and out-of-range values do not navigate.
 */
export function parsePageJump(raw: string, pageCount: number): number | null {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return null
  }
  const text = raw.trim()
  if (!/^[1-9]\d*$/.test(text)) {
    return null
  }
  const page = Number(text)
  if (!Number.isInteger(page) || page > pageCount) {
    return null
  }
  return page
}

export function clampPdfScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return MIN_PDF_SCALE
  }
  return Math.min(MAX_PDF_SCALE, Math.max(MIN_PDF_SCALE, scale))
}

/** Viewer zoom that makes `pageWidthPoints` span `availableCssWidth`. Aspect is unchanged. */
export function fitWidthScale(
  pageWidthPoints: number,
  availableCssWidth: number,
  cssPixelsPerPoint: number,
): number {
  if (pageWidthPoints <= 0 || availableCssWidth <= 0 || cssPixelsPerPoint <= 0) {
    return 1
  }
  return clampPdfScale(availableCssWidth / (pageWidthPoints * cssPixelsPerPoint))
}

/**
 * Uniform zoom that fits the page inside the viewer.
 * The smaller of the width and height scales is used, so the page is not stretched.
 */
export function fitPageScale(
  pageWidthPoints: number,
  pageHeightPoints: number,
  availableCssWidth: number,
  availableCssHeight: number,
  cssPixelsPerPoint: number,
): number {
  if (
    pageWidthPoints <= 0 ||
    pageHeightPoints <= 0 ||
    availableCssWidth <= 0 ||
    availableCssHeight <= 0 ||
    cssPixelsPerPoint <= 0
  ) {
    return 1
  }
  const widthScale = availableCssWidth / (pageWidthPoints * cssPixelsPerPoint)
  const heightScale = availableCssHeight / (pageHeightPoints * cssPixelsPerPoint)
  return clampPdfScale(Math.min(widthScale, heightScale))
}

/** A newly loaded document or version starts on page 1. */
export function navigationAfterDocumentChange(): { currentPage: number } {
  return { currentPage: 1 }
}

export function pageAfterStructureChange(currentPage: number, pageCount: number): number {
  return clampPageNumber(currentPage, pageCount)
}
