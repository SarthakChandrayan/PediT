import type { PageViewport } from 'pdfjs-dist'
import { pageSizeFromViewport, viewportPointToPdf, type PdfPoint, type PdfRect } from './coordinates.ts'
import { cssColor, cssFontFamily, resolveStandardFont } from './textAppearance.ts'
import type { TextRunAppearance } from './textEdits.ts'

/**
 * User-created text. It is not a change to an existing PDF run.
 *
 * `pdfX` / `pdfY` are the baseline origin in PDF user space. Screen position
 * is derived from the current viewport. Unsaved boxes are not in the PDF.js
 * search cache; after save, export, or a page operation they become normal
 * page text and the existing search can find them.
 */
export type NewTextAnnotation = {
  id: string
  pageNumber: number
  text: string
  pdfX: number
  pdfY: number
  width: number
  height: number
  fontName: string
  fontSize: number
  bold: boolean
  italic: boolean
  color: { r: number; g: number; b: number }
  horizontalScale: number
}

export type NewTextBox = {
  pdfX: number
  pdfY: number
  width: number
  height: number
}

export type NewTextFontName = 'Helvetica' | 'Times-Roman' | 'Courier'

export const NEW_TEXT_FONTS: readonly NewTextFontName[] = ['Helvetica', 'Times-Roman', 'Courier']
export const DEFAULT_NEW_TEXT_FONT: NewTextFontName = 'Helvetica'
export const DEFAULT_NEW_TEXT_SIZE = 14
export const MIN_NEW_TEXT_WIDTH = 36
export const MIN_NEW_TEXT_SIZE = 8
export const MAX_NEW_TEXT_SIZE = 72
export const DEFAULT_NEW_TEXT_WIDTH = 140
export const NEW_TEXT_DESCENT = 0.25
export const NEW_TEXT_LINE_HEIGHT = 1.2

export function defaultNewTextColor(): { r: number; g: number; b: number } {
  return { r: 0, g: 0, b: 0 }
}

export function newTextHeight(fontSize: number): number {
  return Math.max(MIN_NEW_TEXT_SIZE, fontSize) * NEW_TEXT_LINE_HEIGHT
}

export function newTextId(): string {
  return crypto.randomUUID()
}

/** Click is the top-left of the box. The stored point is the baseline origin. */
export function baselineFromClick(click: PdfPoint, fontSize: number): PdfPoint {
  const height = newTextHeight(fontSize)
  const descent = fontSize * NEW_TEXT_DESCENT
  return {
    x: click.x,
    y: click.y - (height - descent),
  }
}

export function createNewText(options: {
  pageNumber: number
  pdfX: number
  pdfY: number
  pageWidth: number
  pageHeight: number
  text?: string
  id?: string
}): NewTextAnnotation {
  const fontSize = DEFAULT_NEW_TEXT_SIZE
  const height = newTextHeight(fontSize)
  const origin = baselineFromClick({ x: options.pdfX, y: options.pdfY }, fontSize)
  const box = clampNewTextBox(
    { pdfX: origin.x, pdfY: origin.y, width: DEFAULT_NEW_TEXT_WIDTH, height },
    options.pageWidth,
    options.pageHeight,
  )
  return {
    id: options.id ?? newTextId(),
    pageNumber: options.pageNumber,
    text: options.text ?? '',
    ...box,
    fontName: DEFAULT_NEW_TEXT_FONT,
    fontSize,
    bold: false,
    italic: false,
    color: defaultNewTextColor(),
    horizontalScale: 1,
  }
}

export function newTextFromPointer(options: {
  pageNumber: number
  viewport: PageViewport
  clientX: number
  clientY: number
  pageElement: HTMLElement
}): { pdfX: number; pdfY: number; pageWidth: number; pageHeight: number } {
  const bounds = options.pageElement.getBoundingClientRect()
  const point = viewportPointToPdf(options.viewport, {
    x: options.clientX - bounds.left,
    y: options.clientY - bounds.top,
  })
  const page = pageSizeFromViewport(options.viewport)
  return {
    pdfX: point.x,
    pdfY: point.y,
    pageWidth: page.width,
    pageHeight: page.height,
  }
}

/** Axis-aligned box around the baseline origin. Used for hit testing and overlay. */
export function newTextPdfRect(
  text: Pick<NewTextAnnotation, 'pdfX' | 'pdfY' | 'width' | 'height' | 'fontSize'>,
): PdfRect {
  const descent = text.fontSize * NEW_TEXT_DESCENT
  return {
    x: text.pdfX,
    y: text.pdfY - descent,
    width: text.width,
    height: text.height,
  }
}

export function clampNewTextBox(
  box: NewTextBox,
  pageWidth: number,
  pageHeight: number,
): NewTextBox {
  const width = Math.max(MIN_NEW_TEXT_WIDTH, box.width)
  const height = Math.max(newTextHeight(MIN_NEW_TEXT_SIZE), box.height)
  const descent = height * (NEW_TEXT_DESCENT / NEW_TEXT_LINE_HEIGHT)
  const minY = descent
  const maxY = Math.max(minY, pageHeight - (height - descent))
  return {
    pdfX: clamp(box.pdfX, 0, Math.max(0, pageWidth - width)),
    pdfY: clamp(box.pdfY, minY, maxY),
    width: Math.min(width, Math.max(MIN_NEW_TEXT_WIDTH, pageWidth)),
    height,
  }
}

export function moveNewText(
  box: NewTextBox,
  start: PdfPoint,
  current: PdfPoint,
  pageWidth: number,
  pageHeight: number,
): NewTextBox {
  return clampNewTextBox(
    {
      pdfX: box.pdfX + (current.x - start.x),
      pdfY: box.pdfY + (current.y - start.y),
      width: box.width,
      height: box.height,
    },
    pageWidth,
    pageHeight,
  )
}

/** Horizontal resize. The left edge stays put when growing to the right. */
export function resizeNewTextWidth(
  box: NewTextBox,
  pointerX: number,
  pageWidth: number,
  pageHeight: number,
): NewTextBox {
  const width = Math.max(MIN_NEW_TEXT_WIDTH, pointerX - box.pdfX)
  return clampNewTextBox({ ...box, width }, pageWidth, pageHeight)
}

export function patchNewTextStyle(
  text: NewTextAnnotation,
  patch: Partial<Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>>,
  pageWidth?: number,
  pageHeight?: number,
): NewTextAnnotation {
  const fontSize = patch.fontSize !== undefined
    ? clamp(patch.fontSize, MIN_NEW_TEXT_SIZE, MAX_NEW_TEXT_SIZE)
    : text.fontSize
  const next = {
    ...text,
    ...patch,
    fontSize,
    height: newTextHeight(fontSize),
    color: patch.color ? { ...patch.color } : { ...text.color },
  }
  if (pageWidth === undefined || pageHeight === undefined) {
    return next
  }
  return { ...next, ...clampNewTextBox(next, pageWidth, pageHeight) }
}

export function cloneNewText(text: NewTextAnnotation): NewTextAnnotation {
  return { ...text, color: { ...text.color } }
}

export function newTextOverlayCss(
  text: Pick<NewTextAnnotation, 'fontName' | 'bold' | 'italic' | 'fontSize' | 'color' | 'horizontalScale'>,
): { fontFamily: string; fontWeight?: number; fontStyle?: 'italic'; color: string } {
  const font = resolveNewTextFont(text)
  return {
    fontFamily: cssFontFamily(font),
    fontWeight: text.bold ? 700 : undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: cssColor(text.color),
  }
}

export function isNewTextFontName(value: string): value is NewTextFontName {
  return NEW_TEXT_FONTS.includes(value as NewTextFontName)
}

export function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

export function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const match = /^#([\da-f]{6})$/i.exec(value.trim())
  if (!match?.[1]) {
    return null
  }
  const hex = match[1]
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  }
}

export function appearanceForNewText(
  text: Pick<NewTextAnnotation, 'fontName' | 'bold' | 'italic' | 'fontSize' | 'horizontalScale' | 'color'>,
): Pick<TextRunAppearance, 'pdfFontName' | 'bold' | 'italic' | 'fontSize' | 'horizontalScale'> {
  return {
    pdfFontName: text.fontName,
    bold: text.bold,
    italic: text.italic,
    fontSize: text.fontSize,
    horizontalScale: text.horizontalScale,
  }
}

export function resolveNewTextFont(
  text: Pick<NewTextAnnotation, 'fontName' | 'bold' | 'italic'>,
) {
  return resolveStandardFont({
    pdfFontName: text.fontName,
    bold: text.bold,
    italic: text.italic,
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
