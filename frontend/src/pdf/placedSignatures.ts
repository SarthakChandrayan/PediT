import type { PageViewport } from 'pdfjs-dist'
import {
  pageSizeFromViewport,
  pdfRectToViewportBox,
  viewportPointToPdf,
  type PdfPoint,
  type ViewportPoint,
} from './coordinates.ts'
import type { DocumentSnapshot } from './documentHistory.ts'
import type { ImageAnnotation } from './images.ts'
import type { Signature } from './signatures.ts'

/**
 * A signature placed on a page, in PDF user space.
 *
 * `pdfX` and `pdfY` are the bottom-left corner. `width` and `height` are in
 * points and always keep the `originalWidth / originalHeight` ratio of the
 * captured signature. `dataUrl` is copied from the reusable signature when it
 * is placed, so replacing that signature later does not change this overlay.
 * Screen position is derived from the current viewport.
 */
export type SignatureAnnotation = {
  id: string
  pageNumber: number
  pdfX: number
  pdfY: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  dataUrl: string
}

export type SignatureBox = Pick<SignatureAnnotation, 'pdfX' | 'pdfY' | 'width' | 'height'>

export type PageSize = {
  width: number
  height: number
}

export type SignatureGesture =
  | {
      mode: 'move'
      box: SignatureBox
      ratio: number
      start: PdfPoint
    }
  | {
      mode: 'resize'
      box: SignatureBox
      ratio: number
      /** Corner that stays fixed. The opposite corner follows the pointer. */
      anchor: PdfPoint
      directionX: 1 | -1
      directionY: 1 | -1
    }

/** A placed signature's longer side is never shorter than this, in points. */
export const MIN_SIGNATURE_LONG_SIDE = 36
/** A placed signature's shorter side is never shorter than this, in points. */
export const MIN_SIGNATURE_SHORT_SIDE = 8
/** Initial size: points per CSS pixel of the drawn signature. */
export const DEFAULT_SIGNATURE_POINTS_PER_PIXEL = 0.5
export const DEFAULT_SIGNATURE_MAX_WIDTH = 180
export const DEFAULT_SIGNATURE_MAX_HEIGHT = 72

export function signatureAspectRatio(
  signature: Pick<SignatureAnnotation, 'originalWidth' | 'originalHeight'>,
): number {
  const ratio = signature.originalWidth / signature.originalHeight
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/** Allowed widths for a ratio on a page. The largest box still fits on the page. */
export function signatureWidthBounds(ratio: number, page: PageSize): { min: number; max: number } {
  const max = Math.max(0, Math.min(page.width, page.height * ratio))
  const fromLongSide = ratio >= 1 ? MIN_SIGNATURE_LONG_SIDE : MIN_SIGNATURE_LONG_SIDE * ratio
  const fromShortSide = ratio >= 1 ? MIN_SIGNATURE_SHORT_SIDE * ratio : MIN_SIGNATURE_SHORT_SIDE
  return { min: Math.min(Math.max(fromLongSide, fromShortSide), max), max }
}

/** Initial width from the drawn size, kept within the default and page bounds. */
export function defaultSignatureWidth(
  signature: Pick<Signature, 'width' | 'height'>,
  page: PageSize,
): number {
  const ratio = signatureAspectRatio({
    originalWidth: signature.width,
    originalHeight: signature.height,
  })
  let width = signature.width * DEFAULT_SIGNATURE_POINTS_PER_PIXEL
  width = Math.min(width, DEFAULT_SIGNATURE_MAX_WIDTH, DEFAULT_SIGNATURE_MAX_HEIGHT * ratio)
  const bounds = signatureWidthBounds(ratio, page)
  return clamp(width, bounds.min, bounds.max)
}

/** A new overlay centered on `center`, moved inward so it stays on the page. */
export function placeSignature(options: {
  signature: Pick<Signature, 'dataUrl' | 'width' | 'height'>
  pageNumber: number
  center: PdfPoint
  page: PageSize
}): SignatureAnnotation {
  const { signature, page } = options
  const originalWidth = signature.width > 0 ? signature.width : 1
  const originalHeight = signature.height > 0 ? signature.height : 1
  const ratio = signatureAspectRatio({ originalWidth, originalHeight })
  const width = defaultSignatureWidth(signature, page)
  const height = width / ratio
  const box = clampSignatureBox(
    {
      pdfX: options.center.x - width / 2,
      pdfY: options.center.y - height / 2,
      width,
      height,
    },
    page,
  )
  return {
    id: crypto.randomUUID(),
    pageNumber: options.pageNumber,
    ...box,
    originalWidth,
    originalHeight,
    dataUrl: signature.dataUrl,
  }
}

export function clampSignatureBox(box: SignatureBox, page: PageSize): SignatureBox {
  return {
    pdfX: clamp(box.pdfX, 0, Math.max(0, page.width - box.width)),
    pdfY: clamp(box.pdfY, 0, Math.max(0, page.height - box.height)),
    width: box.width,
    height: box.height,
  }
}

export function moveSignatureBox(
  box: SignatureBox,
  start: PdfPoint,
  current: PdfPoint,
  page: PageSize,
): SignatureBox {
  return clampSignatureBox(
    {
      pdfX: box.pdfX + (current.x - start.x),
      pdfY: box.pdfY + (current.y - start.y),
      width: box.width,
      height: box.height,
    },
    page,
  )
}

/**
 * Proportional resize from a fixed corner. The size follows whichever axis the
 * pointer moved further along, then is limited by the size bounds and by the
 * room between the anchor and the page edge.
 */
export function resizeSignatureBox(
  gesture: Extract<SignatureGesture, { mode: 'resize' }>,
  pointer: PdfPoint,
  page: PageSize,
): SignatureBox {
  const { anchor, directionX, directionY, ratio } = gesture
  const rawWidth = Math.max(0, directionX * (pointer.x - anchor.x))
  const rawHeight = Math.max(0, directionY * (pointer.y - anchor.y))
  const bounds = signatureWidthBounds(ratio, page)
  const roomWidth = directionX > 0 ? page.width - anchor.x : anchor.x
  const roomHeight = directionY > 0 ? page.height - anchor.y : anchor.y
  const limit = Math.max(bounds.min, Math.min(bounds.max, roomWidth, roomHeight * ratio))
  const width = clamp(Math.max(rawWidth, rawHeight * ratio), bounds.min, limit)
  const height = width / ratio
  return clampSignatureBox(
    {
      pdfX: directionX > 0 ? anchor.x : anchor.x - width,
      pdfY: directionY > 0 ? anchor.y : anchor.y - height,
      width,
      height,
    },
    page,
  )
}

/**
 * Starts a move or resize from a pointer position in viewport CSS pixels.
 * A resize anchors the corner shown at the top-left, so the handle drawn at
 * the bottom-right follows the pointer at any zoom or page rotation.
 */
export function startSignatureGesture(
  mode: 'move' | 'resize',
  signature: SignatureAnnotation,
  pointer: ViewportPoint,
  viewport: PageViewport,
): SignatureGesture {
  const box = boxOf(signature)
  const ratio = signatureAspectRatio(signature)
  if (mode === 'move') {
    return { mode, box, ratio, start: viewportPointToPdf(viewport, pointer) }
  }
  const view = pdfRectToViewportBox(viewport, signatureRect(box))
  const topLeft = viewportPointToPdf(viewport, { x: view.left, y: view.top })
  const bottomRight = viewportPointToPdf(viewport, {
    x: view.left + view.width,
    y: view.top + view.height,
  })
  const directionX = bottomRight.x >= topLeft.x ? 1 : -1
  const directionY = bottomRight.y >= topLeft.y ? 1 : -1
  return {
    mode,
    box,
    ratio,
    anchor: {
      x: directionX > 0 ? box.pdfX : box.pdfX + box.width,
      y: directionY > 0 ? box.pdfY : box.pdfY + box.height,
    },
    directionX,
    directionY,
  }
}

/** The box for the pointer's current viewport position during a gesture. */
export function dragSignature(
  gesture: SignatureGesture,
  pointer: ViewportPoint,
  viewport: PageViewport,
): SignatureBox {
  const point = viewportPointToPdf(viewport, pointer)
  const page = pageSizeFromViewport(viewport)
  if (gesture.mode === 'move') {
    return moveSignatureBox(gesture.box, gesture.start, point, page)
  }
  return resizeSignatureBox(gesture, point, page)
}

export function signatureRect(box: SignatureBox): {
  x: number
  y: number
  width: number
  height: number
} {
  return { x: box.pdfX, y: box.pdfY, width: box.width, height: box.height }
}

/** Adds a placed signature as one document change and selects it. */
export function withPlacedSignature(
  snapshot: DocumentSnapshot,
  signature: SignatureAnnotation,
): DocumentSnapshot {
  return {
    ...snapshot,
    signatures: [...snapshot.signatures, signature],
    selectedSignatureId: signature.id,
    selectedMarkupId: null,
    selectedDrawingId: null,
    selectedImageId: null,
    selectedTextId: null,
  }
}

export function withSignatureBox(
  snapshot: DocumentSnapshot,
  id: string,
  box: SignatureBox,
): DocumentSnapshot {
  return {
    ...snapshot,
    signatures: snapshot.signatures.map((item) => (item.id === id ? { ...item, ...box } : item)),
  }
}

export function withoutSignature(snapshot: DocumentSnapshot, id: string): DocumentSnapshot {
  return {
    ...snapshot,
    signatures: snapshot.signatures.filter((item) => item.id !== id),
    selectedSignatureId: snapshot.selectedSignatureId === id ? null : snapshot.selectedSignatureId,
  }
}

/**
 * Placed signatures as PNG image overlays. Page operations bake overlays
 * through the existing image path; save and export do not include signatures.
 */
export function signaturesAsImages(
  signatures: readonly SignatureAnnotation[],
): ImageAnnotation[] {
  return signatures.map((signature) => ({
    id: signature.id,
    pageNumber: signature.pageNumber,
    x: signature.pdfX,
    y: signature.pdfY,
    width: signature.width,
    height: signature.height,
    originalWidth: signature.originalWidth,
    originalHeight: signature.originalHeight,
    format: 'png',
    bytes: pngDataUrlToBytes(signature.dataUrl),
  }))
}

export function pngDataUrlToBytes(dataUrl: string): Uint8Array {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('A signature must be a PNG data URL.')
  }
  const binary = atob(dataUrl.slice(prefix.length))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function boxOf(signature: SignatureAnnotation): SignatureBox {
  return {
    pdfX: signature.pdfX,
    pdfY: signature.pdfY,
    width: signature.width,
    height: signature.height,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
