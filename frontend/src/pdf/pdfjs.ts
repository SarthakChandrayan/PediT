import {
  getDocument,
  GlobalWorkerOptions,
  OutputScale,
  PixelsPerInch,
  RenderingCancelledException,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// The modern PDF.js build calls Map#getOrInsertComputed. The legacy build
// includes a polyfill so rendering does not depend on that method.

GlobalWorkerOptions.workerSrc = workerSrc

export { getDocument, OutputScale, PixelsPerInch, RenderingCancelledException }
export type { PDFDocumentLoadingTask, PDFDocumentProxy }

const MAX_CANVAS_PIXELS = 16_777_216

export function createOutputScale(cssWidth: number, cssHeight: number): OutputScale {
  const outputScale = new OutputScale()
  outputScale.limitCanvas(cssWidth, cssHeight, MAX_CANVAS_PIXELS, -1)
  return outputScale
}

export function isRenderingCancelled(error: unknown): boolean {
  return (
    error instanceof RenderingCancelledException ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'RenderingCancelledException')
  )
}

export function readPdfError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    if (error.name === 'PasswordException') {
      return 'This PDF is password-protected. Unlocking is not supported yet.'
    }
    if (error.name === 'InvalidPDFException') {
      return 'This file is not a valid PDF.'
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Could not open this PDF.'
}
