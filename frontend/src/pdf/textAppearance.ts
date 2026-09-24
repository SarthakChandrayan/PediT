import type { PDFPageProxy } from 'pdfjs-dist'
import { StandardFonts } from 'pdf-lib'
import type { TextRunAppearance } from './textEdits.ts'

/**
 * Same slack export uses before condensing a longer replacement. Short
 * replacements stay at their natural width. The on-screen editor applies this
 * factor to measured CSS width so it matches export geometry.
 */
export const TEXT_FIT_SLACK = 1.02

export function horizontalFitFactor(
  naturalWidth: number,
  originalWidth: number,
  vertical = false,
): number {
  if (vertical || !(originalWidth > 0) || !(naturalWidth > 0)) {
    return 1
  }
  if (!(naturalWidth > originalWidth * TEXT_FIT_SLACK)) {
    return 1
  }
  return originalWidth / naturalWidth
}

export function fittedOverlayWidth(
  naturalWidth: number,
  originalWidth: number,
  vertical = false,
): number {
  return naturalWidth * horizontalFitFactor(naturalWidth, originalWidth, vertical)
}

/**
 * What this module can recover, and what it cannot.
 *
 * Reliable from PDF.js `getTextContent` plus the font object sent with the
 * operator list:
 * - PDF font name (`Font.name`), including a subset prefix such as `ABCDEF+`
 * - bold / italic when the font name or PDF.js font flags say so
 * - generic family (`serif`, `sans-serif`, `monospace`) from the font flags
 * - ascent and descent in em units
 * - font size and horizontal scale from the text rendering matrix in PDF space
 * - rotation, shear, and the text origin, which stay in `TextEdit.transform`
 *
 * Reliable from the page operator list, not from pixels:
 * - solid fill color (DeviceGray, DeviceRGB, and DeviceCMYK already converted
 *   to RGB by PDF.js)
 * - stroke color when the text rendering mode is stroke-only
 *
 * Not recovered:
 * - arbitrary embedded font programs (they are not extracted or re-embedded)
 * - Symbol and ZapfDingbats encodings (replacement uses a WinAnsi standard font)
 * - pattern, shading, or transparency-only text colors
 * - colors guessed from anti-aliased canvas pixels
 * - the page background behind a run
 *
 * Export maps a recovered font onto one of the 14 standard fonts pdf-lib can
 * embed. Anything that does not map safely becomes Helvetica (with bold or
 * italic when those flags were actually set). Standard fonts use WinAnsi, so
 * characters they cannot encode are replaced with "?" rather than failing
 * the PDF. See `textForStandardFont` in exportPdf.ts.
 */

export type RgbColor = { r: number; g: number; b: number }

export type TextColorSample = {
  x: number
  y: number
  color: RgbColor
}

export type PdfFontRecord = {
  pdfFontName?: string
  fallbackFamily?: TextRunAppearance['fallbackFamily']
  bold: boolean
  italic: boolean
  ascent?: number
  descent?: number
  vertical: boolean
}

/**
 * PDF.js operator ids used while reading text color. These match `OPS` in
 * pdfjs-dist; the legacy build's types do not export that object.
 */
export const pdfTextOperators = {
  save: 10,
  restore: 11,
  transform: 12,
  beginText: 31,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  setStrokeTransparent: 92,
  setFillTransparent: 93,
} as const

type FontFamily = 'helvetica' | 'times' | 'courier'

const FONT_BY_NAME: Record<string, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Helvetica-Oblique': StandardFonts.HelveticaOblique,
  'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
  'Helvetica-Italic': StandardFonts.HelveticaOblique,
  'Helvetica-BoldItalic': StandardFonts.HelveticaBoldOblique,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  'Times-Italic': StandardFonts.TimesRomanItalic,
  'Times-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
  'Courier-Oblique': StandardFonts.CourierOblique,
  'Courier-BoldOblique': StandardFonts.CourierBoldOblique,
  'Courier-Italic': StandardFonts.CourierOblique,
  'Courier-BoldItalic': StandardFonts.CourierBoldOblique,
  Arial: StandardFonts.Helvetica,
  ArialMT: StandardFonts.Helvetica,
  'Arial-Bold': StandardFonts.HelveticaBold,
  'Arial-BoldMT': StandardFonts.HelveticaBold,
  'Arial-Italic': StandardFonts.HelveticaOblique,
  'Arial-ItalicMT': StandardFonts.HelveticaOblique,
  'Arial-BoldItalic': StandardFonts.HelveticaBoldOblique,
  'Arial-BoldItalicMT': StandardFonts.HelveticaBoldOblique,
  'Arial-Black': StandardFonts.Helvetica,
  ArialBlack: StandardFonts.Helvetica,
  ArialNarrow: StandardFonts.Helvetica,
  'ArialNarrow-Bold': StandardFonts.HelveticaBold,
  'ArialNarrow-Italic': StandardFonts.HelveticaOblique,
  'ArialNarrow-BoldItalic': StandardFonts.HelveticaBoldOblique,
  Calibri: StandardFonts.Helvetica,
  'Calibri-Bold': StandardFonts.HelveticaBold,
  'Calibri-Italic': StandardFonts.HelveticaOblique,
  'Calibri-BoldItalic': StandardFonts.HelveticaBoldOblique,
  Verdana: StandardFonts.Helvetica,
  'Verdana-Bold': StandardFonts.HelveticaBold,
  'Verdana-Italic': StandardFonts.HelveticaOblique,
  'Verdana-BoldItalic': StandardFonts.HelveticaBoldOblique,
  Tahoma: StandardFonts.Helvetica,
  'Tahoma-Bold': StandardFonts.HelveticaBold,
  Impact: StandardFonts.Helvetica,
  TimesNewRoman: StandardFonts.TimesRoman,
  TimesNewRomanPS: StandardFonts.TimesRoman,
  TimesNewRomanPSMT: StandardFonts.TimesRoman,
  'TimesNewRoman-Bold': StandardFonts.TimesRomanBold,
  'TimesNewRoman-Italic': StandardFonts.TimesRomanItalic,
  'TimesNewRoman-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  'TimesNewRomanPS-Bold': StandardFonts.TimesRomanBold,
  'TimesNewRomanPS-BoldMT': StandardFonts.TimesRomanBold,
  'TimesNewRomanPS-Italic': StandardFonts.TimesRomanItalic,
  'TimesNewRomanPS-ItalicMT': StandardFonts.TimesRomanItalic,
  'TimesNewRomanPS-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  'TimesNewRomanPS-BoldItalicMT': StandardFonts.TimesRomanBoldItalic,
  'TimesNewRomanPSMT-Bold': StandardFonts.TimesRomanBold,
  'TimesNewRomanPSMT-Italic': StandardFonts.TimesRomanItalic,
  'TimesNewRomanPSMT-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  Georgia: StandardFonts.TimesRoman,
  'Georgia-Bold': StandardFonts.TimesRomanBold,
  'Georgia-Italic': StandardFonts.TimesRomanItalic,
  'Georgia-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  CourierNew: StandardFonts.Courier,
  CourierNewPSMT: StandardFonts.Courier,
  'CourierNew-Bold': StandardFonts.CourierBold,
  'CourierNew-Italic': StandardFonts.CourierOblique,
  'CourierNew-BoldItalic': StandardFonts.CourierBoldOblique,
  'CourierNewPS-BoldMT': StandardFonts.CourierBold,
  'CourierNewPS-ItalicMT': StandardFonts.CourierOblique,
  'CourierNewPS-BoldItalicMT': StandardFonts.CourierBoldOblique,
  Consolas: StandardFonts.Courier,
  'Consolas-Bold': StandardFonts.CourierBold,
  'Consolas-Italic': StandardFonts.CourierOblique,
  'Consolas-BoldItalic': StandardFonts.CourierBoldOblique,
}

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** PDF user-space em size and baseline scale from a text rendering matrix. */
export function metricsFromMatrix(
  transform: readonly number[],
  vertical = false,
): { fontSize: number; horizontalScale: number } | null {
  if (transform.length < 6 || !transform.slice(0, 6).every((value) => Number.isFinite(value))) {
    return null
  }
  const scaleX = Math.hypot(transform[0] ?? 0, transform[1] ?? 0)
  const scaleY = Math.hypot(transform[2] ?? 0, transform[3] ?? 0)
  const fontSize = vertical ? scaleX : scaleY > 0 ? scaleY : scaleX
  if (!(fontSize > 0)) {
    return null
  }
  const alongBaseline = vertical ? scaleY : scaleX
  const horizontalScale = alongBaseline > 0 ? alongBaseline / fontSize : 1
  return {
    fontSize,
    horizontalScale: Number.isFinite(horizontalScale) && horizontalScale > 0 ? horizontalScale : 1,
  }
}

export function resolveStandardFont(
  appearance: Pick<TextRunAppearance, 'pdfFontName' | 'fallbackFamily' | 'bold' | 'italic'> | undefined,
): StandardFonts {
  if (!appearance) {
    return StandardFonts.Helvetica
  }
  const name = appearance.pdfFontName ? normalizePdfFontName(appearance.pdfFontName) : ''
  if (/^(Symbol|ZapfDingbats)/i.test(name)) {
    return StandardFonts.Helvetica
  }
  const bold = appearance.bold === true
  const italic = appearance.italic === true
  const mapped = name ? FONT_BY_NAME[name] : undefined
  if (mapped) {
    return applyWeight(
      familyOf(mapped),
      bold || fontIsBold(mapped),
      italic || fontIsItalic(mapped),
    )
  }
  const family =
    familyFromName(name) ?? familyFromFallback(appearance.fallbackFamily) ?? 'helvetica'
  return applyWeight(family, bold, italic)
}

export function cssFontFamily(font: StandardFonts): string {
  if (font.startsWith('Times')) {
    return '"Times New Roman", Times, serif'
  }
  if (font.startsWith('Courier')) {
    return '"Courier New", Courier, monospace'
  }
  return 'Helvetica, Arial, sans-serif'
}

export function cssColor(color: RgbColor): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

export function appearanceForRun(input: {
  transform: readonly number[]
  styleFamily?: string
  font?: PdfFontRecord | null
  color?: RgbColor | null
  ascent?: number
  descent?: number
  vertical?: boolean
}): TextRunAppearance {
  const vertical = input.font?.vertical === true || input.vertical === true
  const metrics = metricsFromMatrix(input.transform, vertical)
  const fallbackFamily =
    input.font?.fallbackFamily ?? parseFallbackFamily(input.styleFamily)
  return {
    pdfFontName: input.font?.pdfFontName,
    fallbackFamily,
    bold: input.font?.bold === true,
    italic: input.font?.italic === true,
    fontSize: metrics?.fontSize ?? 0,
    horizontalScale: metrics?.horizontalScale ?? 1,
    color: input.color ? { ...input.color } : undefined,
    ascent: metricOrUndefined(input.font?.ascent ?? input.ascent, -0.5, 1.5),
    descent: metricOrUndefined(input.font?.descent ?? input.descent, -1, 0.2),
    vertical,
  }
}

export function matchTextColor(
  x: number,
  y: number,
  samples: readonly TextColorSample[],
): RgbColor | undefined {
  let best: TextColorSample | undefined
  let bestDistance = 1.5
  for (const sample of samples) {
    const distance = Math.hypot(sample.x - x, sample.y - y)
    if (distance <= bestDistance) {
      best = sample
      bestDistance = distance
    }
  }
  return best ? { ...best.color } : undefined
}

/**
 * Walks a PDF.js operator list and records the solid color at each glyph
 * origin. Pattern fills and invisible text are skipped.
 */
export function collectTextColorSamples(
  fnArray: readonly number[],
  argsArray: readonly unknown[],
): TextColorSample[] {
  const samples: TextColorSample[] = []
  const stack: Graphics[] = []
  let state = createGraphics()

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index]
    if (fn === pdfTextOperators.save) {
      stack.push(cloneGraphics(state))
      continue
    }
    if (fn === pdfTextOperators.restore || fn === pdfTextOperators.paintFormXObjectEnd) {
      const previous = stack.pop()
      if (previous) {
        state = previous
      }
      continue
    }
    if (fn === pdfTextOperators.paintFormXObjectBegin) {
      stack.push(cloneGraphics(state))
      const matrix = matrixFrom(arrayAt(args, 0))
      if (matrix) {
        state.ctm = multiply(state.ctm, matrix)
      }
      continue
    }
    if (fn === pdfTextOperators.transform) {
      const matrix = matrixFrom(args)
      if (matrix) {
        state.ctm = multiply(state.ctm, matrix)
      }
      continue
    }
    if (fn === pdfTextOperators.beginText) {
      state.text = [...IDENTITY]
      state.line = [...IDENTITY]
      continue
    }
    if (fn === pdfTextOperators.setFont) {
      const size = numberAt(args, 1)
      if (size !== null && size > 0) {
        state.fontSize = size
      }
      continue
    }
    if (fn === pdfTextOperators.setHScale) {
      const scale = numberAt(args, 0)
      if (scale !== null) {
        state.hScale = scale / 100
      }
      continue
    }
    if (fn === pdfTextOperators.setTextRise) {
      const rise = numberAt(args, 0)
      if (rise !== null) {
        state.rise = rise
      }
      continue
    }
    if (fn === pdfTextOperators.setCharSpacing) {
      const spacing = numberAt(args, 0)
      if (spacing !== null) {
        state.charSpacing = spacing
      }
      continue
    }
    if (fn === pdfTextOperators.setWordSpacing) {
      const spacing = numberAt(args, 0)
      if (spacing !== null) {
        state.wordSpacing = spacing
      }
      continue
    }
    if (fn === pdfTextOperators.setLeading) {
      const leading = numberAt(args, 0)
      if (leading !== null) {
        state.leading = leading
      }
      continue
    }
    if (fn === pdfTextOperators.setTextRenderingMode) {
      const mode = numberAt(args, 0)
      if (mode !== null) {
        state.renderMode = mode
      }
      continue
    }
    if (fn === pdfTextOperators.moveText) {
      const x = numberAt(args, 0)
      const y = numberAt(args, 1)
      if (x !== null && y !== null) {
        translate(state.line, x, y)
        state.text = [...state.line]
      }
      continue
    }
    if (fn === pdfTextOperators.setLeadingMoveText) {
      const x = numberAt(args, 0)
      const y = numberAt(args, 1)
      if (x !== null && y !== null) {
        state.leading = -y
        translate(state.line, x, y)
        state.text = [...state.line]
      }
      continue
    }
    if (fn === pdfTextOperators.nextLine) {
      translate(state.line, 0, -state.leading)
      state.text = [...state.line]
      continue
    }
    if (fn === pdfTextOperators.setTextMatrix) {
      const matrix = matrixFrom(args)
      if (matrix) {
        state.text = matrix
        state.line = [...matrix]
      }
      continue
    }
    if (fn === pdfTextOperators.setFillRGBColor) {
      state.fill = colorFrom(args)
      continue
    }
    if (fn === pdfTextOperators.setStrokeRGBColor) {
      state.stroke = colorFrom(args)
      continue
    }
    if (fn === pdfTextOperators.setFillTransparent) {
      state.fill = null
      continue
    }
    if (fn === pdfTextOperators.setStrokeTransparent) {
      state.stroke = null
      continue
    }
    if (fn === pdfTextOperators.showText || fn === pdfTextOperators.showSpacedText) {
      recordShowText(state, args, samples)
    }
  }

  return samples
}

export async function readPageTextCapture(
  page: PDFPageProxy,
  fontIds: readonly string[],
): Promise<{ colors: TextColorSample[]; fonts: Map<string, PdfFontRecord> }> {
  const ops = await page.getOperatorList()
  const colors = collectTextColorSamples(ops.fnArray, ops.argsArray)
  const fonts = new Map<string, PdfFontRecord>()
  for (const fontId of fontIds) {
    const record = readFontRecord(page, fontId)
    if (record) {
      fonts.set(fontId, record)
    }
  }
  return { colors, fonts }
}

function readFontRecord(page: PDFPageProxy, fontId: string): PdfFontRecord | null {
  if (!fontId || !page.commonObjs.has(fontId)) {
    return null
  }
  let font: {
    name?: string
    bold?: boolean
    italic?: boolean
    fallbackName?: string
    ascent?: number
    descent?: number
    vertical?: boolean
  }
  try {
    font = page.commonObjs.get(fontId) as typeof font
  } catch {
    return null
  }
  if (!font || typeof font !== 'object') {
    return null
  }
  const pdfFontName = typeof font.name === 'string' && font.name.length > 0 ? font.name : undefined
  return {
    pdfFontName,
    fallbackFamily: parseFallbackFamily(font.fallbackName),
    bold: font.bold === true || (font.bold === undefined && nameIsBold(pdfFontName)),
    italic: font.italic === true || (font.italic === undefined && nameIsItalic(pdfFontName)),
    ascent: typeof font.ascent === 'number' ? font.ascent : undefined,
    descent: typeof font.descent === 'number' ? font.descent : undefined,
    vertical: font.vertical === true,
  }
}

function normalizePdfFontName(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '').replace(/[,_]/g, '-').replace(/\s+/g, '')
}

function familyFromName(name: string): FontFamily | null {
  const lower = name.toLowerCase()
  if (/courier|consolas|monospace|lucidaconsole|liberationmono|nimbusmon/.test(lower)) {
    return 'courier'
  }
  if (/times|georgia|garamond|palatino|cambria|liberationserif|nimbusrom|freeserif/.test(lower)) {
    return 'times'
  }
  if (/helvetica|arial|calibri|verdana|tahoma|liberationsans|nimbussan|freesans|gill/.test(lower)) {
    return 'helvetica'
  }
  return null
}

function familyFromFallback(
  family: TextRunAppearance['fallbackFamily'] | undefined,
): FontFamily | null {
  if (family === 'serif') {
    return 'times'
  }
  if (family === 'monospace') {
    return 'courier'
  }
  if (family === 'sans-serif') {
    return 'helvetica'
  }
  return null
}

function parseFallbackFamily(value: string | undefined): TextRunAppearance['fallbackFamily'] | undefined {
  if (value === 'serif' || value === 'sans-serif' || value === 'monospace') {
    return value
  }
  return undefined
}

function familyOf(font: StandardFonts): FontFamily {
  if (font.startsWith('Times')) {
    return 'times'
  }
  if (font.startsWith('Courier')) {
    return 'courier'
  }
  return 'helvetica'
}

function fontIsBold(font: StandardFonts): boolean {
  return font.includes('Bold')
}

function fontIsItalic(font: StandardFonts): boolean {
  return font.includes('Italic') || font.includes('Oblique')
}

function nameIsBold(name: string | undefined): boolean {
  return !!name && /bold|semibold|demibold|heavy|black/i.test(name)
}

function nameIsItalic(name: string | undefined): boolean {
  return !!name && /italic|oblique/i.test(name)
}

function applyWeight(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  if (family === 'times') {
    if (bold && italic) {
      return StandardFonts.TimesRomanBoldItalic
    }
    if (bold) {
      return StandardFonts.TimesRomanBold
    }
    if (italic) {
      return StandardFonts.TimesRomanItalic
    }
    return StandardFonts.TimesRoman
  }
  if (family === 'courier') {
    if (bold && italic) {
      return StandardFonts.CourierBoldOblique
    }
    if (bold) {
      return StandardFonts.CourierBold
    }
    if (italic) {
      return StandardFonts.CourierOblique
    }
    return StandardFonts.Courier
  }
  if (bold && italic) {
    return StandardFonts.HelveticaBoldOblique
  }
  if (bold) {
    return StandardFonts.HelveticaBold
  }
  if (italic) {
    return StandardFonts.HelveticaOblique
  }
  return StandardFonts.Helvetica
}

function metricOrUndefined(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return undefined
  }
  return value
}

type Graphics = {
  ctm: Matrix
  text: Matrix
  line: Matrix
  fontSize: number
  hScale: number
  rise: number
  charSpacing: number
  wordSpacing: number
  leading: number
  fill: RgbColor | null
  stroke: RgbColor | null
  renderMode: number
}

function createGraphics(): Graphics {
  return {
    ctm: [...IDENTITY],
    text: [...IDENTITY],
    line: [...IDENTITY],
    fontSize: 1,
    hScale: 1,
    rise: 0,
    charSpacing: 0,
    wordSpacing: 0,
    leading: 0,
    fill: { r: 0, g: 0, b: 0 },
    stroke: { r: 0, g: 0, b: 0 },
    renderMode: 0,
  }
}

function cloneGraphics(state: Graphics): Graphics {
  return {
    ...state,
    ctm: [...state.ctm],
    text: [...state.text],
    line: [...state.line],
    fill: state.fill ? { ...state.fill } : null,
    stroke: state.stroke ? { ...state.stroke } : null,
  }
}

function recordShowText(state: Graphics, args: unknown, samples: TextColorSample[]): void {
  const glyphs = Array.isArray(args) ? args[0] : args
  if (!Array.isArray(glyphs)) {
    return
  }
  const color = textColor(state)
  for (const glyph of glyphs) {
    if (typeof glyph === 'number') {
      const extra = glyph * (-state.fontSize / 1000) * state.hScale
      translate(state.text, extra, 0)
      continue
    }
    if (!isGlyph(glyph)) {
      continue
    }
    if (color && state.renderMode !== 3 && state.renderMode !== 7) {
      const point = glyphOrigin(state)
      samples.push({ x: point.x, y: point.y, color: { ...color } })
    }
    const width = typeof glyph.width === 'number' ? glyph.width : 0
    let spacing = state.charSpacing
    if (glyph.isSpace === true) {
      spacing += state.wordSpacing
    }
    const advance = (width * 0.001 * state.fontSize + spacing) * state.hScale
    translate(state.text, advance, 0)
  }
}

function textColor(state: Graphics): RgbColor | null {
  if (state.renderMode === 1 || state.renderMode === 5) {
    return state.stroke
  }
  return state.fill
}

function glyphOrigin(state: Graphics): { x: number; y: number } {
  const fontMatrix: Matrix = [state.fontSize * state.hScale, 0, 0, state.fontSize, 0, state.rise]
  const placed = multiply(state.ctm, multiply(state.text, fontMatrix))
  return { x: placed[4], y: placed[5] }
}

function isGlyph(value: unknown): value is { unicode?: string; width?: number; isSpace?: boolean } {
  return typeof value === 'object' && value !== null && 'unicode' in value
}

function translate(matrix: Matrix, x: number, y: number): void {
  matrix[4] = matrix[0] * x + matrix[2] * y + matrix[4]
  matrix[5] = matrix[1] * x + matrix[3] * y + matrix[5]
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function matrixFrom(value: unknown): Matrix | null {
  const direct = sixNumbers(value)
  if (direct) {
    return direct
  }
  if (Array.isArray(value)) {
    return sixNumbers(value[0])
  }
  return null
}

function sixNumbers(value: unknown): Matrix | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    return null
  }
  const source = value as ArrayLike<unknown>
  if (source.length < 6) {
    return null
  }
  const matrix: number[] = []
  for (let index = 0; index < 6; index += 1) {
    const entry = source[index]
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      return null
    }
    matrix.push(entry)
  }
  return matrix as Matrix
}

function colorFrom(args: unknown): RgbColor | null {
  const value = Array.isArray(args) ? args[0] : args
  if (typeof value !== 'string') {
    return null
  }
  const match = /^#?([\da-f]{6})$/i.exec(value)
  const hex = match?.[1]
  if (!hex) {
    return null
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  }
}

function numberAt(args: unknown, index: number): number | null {
  if (!Array.isArray(args)) {
    return null
  }
  const value = args[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function arrayAt(args: unknown, index: number): unknown {
  return Array.isArray(args) ? args[index] : undefined
}
