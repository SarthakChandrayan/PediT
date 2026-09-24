import type { PdfPoint } from './coordinates.ts'

export type ImageFormat = 'png' | 'jpeg'

export type ImageResizeHandle = 'nw' | 'ne' | 'se' | 'sw'

/**
 * An inserted image in PDF user space.
 *
 * `x` and `y` are the bottom-left corner. `width` and `height` stay in the
 * image's original aspect ratio. `bytes` are the local PNG or JPEG used for
 * the overlay and for embedding on export. Screen position is derived from
 * the current viewport.
 */
export type ImageAnnotation = {
  id: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  format: ImageFormat
  bytes: Uint8Array
}

export type ImageBox = {
  x: number
  y: number
  width: number
  height: number
}

const MIN_IMAGE_SIZE = 12

export function imageFormatOf(bytes: Uint8Array): ImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  return null
}

export async function loadLocalImage(file: File): Promise<{
  bytes: Uint8Array
  format: ImageFormat
  width: number
  height: number
}> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = imageFormatOf(bytes)
  if (!format) {
    throw new Error('Choose a PNG or JPEG image.')
  }
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }))
  const width = bitmap.width
  const height = bitmap.height
  bitmap.close()
  if (width < 1 || height < 1) {
    throw new Error('This image has no visible size.')
  }
  return { bytes, format, width, height }
}

/** A centered box that fits on the page and keeps the file's aspect ratio. */
export function placeImageBox(options: {
  originalWidth: number
  originalHeight: number
  pageWidth: number
  pageHeight: number
  centerX: number
  centerY: number
}): ImageBox {
  const ratio = options.originalWidth / options.originalHeight
  const longSide = Math.min(220, options.pageWidth * 0.45, options.pageHeight * 0.45)
  let width = options.originalWidth >= options.originalHeight ? longSide : longSide * ratio
  let height = width / ratio
  const fitted = fitBox(width, height, options.pageWidth * 0.8, options.pageHeight * 0.8)
  width = fitted.width
  height = fitted.height
  const x = clamp(options.centerX - width / 2, 0, Math.max(0, options.pageWidth - width))
  const y = clamp(options.centerY - height / 2, 0, Math.max(0, options.pageHeight - height))
  return { x, y, width, height }
}

export function clampImageBoxToPage(
  box: ImageBox,
  pageWidth: number,
  pageHeight: number,
): ImageBox {
  return {
    x: clamp(box.x, 0, Math.max(0, pageWidth - box.width)),
    y: clamp(box.y, 0, Math.max(0, pageHeight - box.height)),
    width: box.width,
    height: box.height,
  }
}

export function moveImageBox(
  box: ImageBox,
  start: PdfPoint,
  current: PdfPoint,
  pageWidth: number,
  pageHeight: number,
): ImageBox {
  return clampImageBoxToPage(
    {
      x: box.x + (current.x - start.x),
      y: box.y + (current.y - start.y),
      width: box.width,
      height: box.height,
    },
    pageWidth,
    pageHeight,
  )
}

/**
 * Resize from one corner. The opposite corner stays fixed, and height follows
 * the original aspect ratio.
 */
export function resizeImageBox(
  box: ImageBox,
  handle: ImageResizeHandle,
  pointer: PdfPoint,
  ratio: number,
): ImageBox {
  const anchor = oppositeCorner(box, handle)
  const signX = handle === 'ne' || handle === 'se' ? 1 : -1
  const signY = handle === 'nw' || handle === 'ne' ? 1 : -1
  const rawWidth = Math.abs(pointer.x - anchor.x)
  const rawHeight = Math.abs(pointer.y - anchor.y)
  const safeRatio = ratio > 0 ? ratio : 1
  let width = Math.max(rawWidth, rawHeight * safeRatio, MIN_IMAGE_SIZE)
  let height = width / safeRatio
  if (height < MIN_IMAGE_SIZE) {
    height = MIN_IMAGE_SIZE
    width = height * safeRatio
  }
  return {
    x: signX > 0 ? anchor.x : anchor.x - width,
    y: signY > 0 ? anchor.y : anchor.y - height,
    width,
    height,
  }
}

export function imageSnapshot(images: readonly ImageAnnotation[]): string {
  return images
    .map(
      (image) =>
        `${image.id}:${image.pageNumber}:${image.x}:${image.y}:${image.width}:${image.height}:${image.format}`,
    )
    .join('\n')
}

function oppositeCorner(box: ImageBox, handle: ImageResizeHandle): PdfPoint {
  if (handle === 'nw') {
    return { x: box.x + box.width, y: box.y }
  }
  if (handle === 'ne') {
    return { x: box.x, y: box.y }
  }
  if (handle === 'se') {
    return { x: box.x, y: box.y + box.height }
  }
  return { x: box.x + box.width, y: box.y + box.height }
}

function fitBox(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  let nextWidth = width
  let nextHeight = height
  if (nextWidth > maxWidth && maxWidth > 0) {
    const scale = maxWidth / nextWidth
    nextWidth *= scale
    nextHeight *= scale
  }
  if (nextHeight > maxHeight && maxHeight > 0) {
    const scale = maxHeight / nextHeight
    nextWidth *= scale
    nextHeight *= scale
  }
  return { width: nextWidth, height: nextHeight }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
