import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib'
import { Encodings, Font, FontNames, type EncodingType } from '@pdf-lib/standard-fonts'
import { removeGlyphsInRegions, type FontMetrics, type Region } from './contentStream.ts'

/**
 * Deletes the original glyphs under edited text from a page's content, so the
 * old words cannot be selected, searched or copied from the saved PDF.
 * Returns how many glyphs were removed. Text it cannot measure, and text in
 * form XObjects, is left alone; the export's white cover still hides it.
 *
 * Call before anything else is drawn on the page: the page's content streams
 * are merged into one rewritten stream.
 */
export function removeOriginalText(
  pdf: PDFDocument,
  page: PDFPage,
  regions: readonly Region[],
): number {
  if (regions.length === 0) {
    return 0
  }
  const content = readPageContent(page)
  if (!content) {
    return 0
  }
  const fonts = fontLookup(page)
  let result: ReturnType<typeof removeGlyphsInRegions>
  try {
    result = removeGlyphsInRegions(content, regions, fonts)
  } catch {
    return 0
  }
  if (!result) {
    return 0
  }
  const stream = pdf.context.flateStream(result.bytes)
  page.node.set(PDFName.of('Contents'), pdf.context.register(stream))
  return result.removed
}

function readPageContent(page: PDFPage): Uint8Array | null {
  const contents = page.node.get(PDFName.of('Contents'))
  if (!contents) {
    return null
  }
  const streams: PDFObject[] = []
  const resolved = page.node.context.lookup(contents)
  if (resolved instanceof PDFArray) {
    for (let index = 0; index < resolved.size(); index += 1) {
      const item = resolved.lookup(index)
      if (!item) {
        return null
      }
      streams.push(item)
    }
  } else if (resolved) {
    streams.push(resolved)
  }

  const parts: Uint8Array[] = []
  for (const stream of streams) {
    try {
      if (stream instanceof PDFRawStream) {
        parts.push(decodePDFRawStream(stream).decode())
      } else if (stream instanceof PDFStream) {
        parts.push(stream.getContents())
      } else {
        return null
      }
    } catch {
      // An unsupported filter: leave this page's content as it is.
      return null
    }
  }
  const size = parts.reduce((total, part) => total + part.length + 1, 0)
  const merged = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
    // Streams are concatenated as if separated by whitespace.
    merged[offset] = 10
    offset += 1
  }
  return merged
}

function fontLookup(page: PDFPage): (name: string) => FontMetrics | null {
  const cache = new Map<string, FontMetrics | null>()
  const resources = page.node.Resources()
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict)
  return (name) => {
    if (cache.has(name)) {
      return cache.get(name) ?? null
    }
    let metrics: FontMetrics | null
    try {
      const dict = fonts?.lookupMaybe(PDFName.of(name), PDFDict)
      metrics = dict ? metricsFor(dict) : null
    } catch {
      metrics = null
    }
    cache.set(name, metrics)
    return metrics
  }
}

function metricsFor(font: PDFDict): FontMetrics | null {
  const subtype = nameOf(font.get(PDFName.of('Subtype')))
  if (subtype === 'Type0') {
    return compositeMetrics(font)
  }
  if (subtype === 'Type1' || subtype === 'TrueType' || subtype === 'MMType1') {
    return simpleMetrics(font)
  }
  // Type3 glyphs use their own matrix; not worth the risk.
  return null
}

function compositeMetrics(font: PDFDict): FontMetrics | null {
  const encoding = nameOf(font.get(PDFName.of('Encoding')))
  if (encoding !== 'Identity-H') {
    return null
  }
  const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)
  const descendant = descendants?.lookupMaybe(0, PDFDict)
  if (!descendant) {
    return null
  }
  const defaultWidth = numberOf(descendant.lookup(PDFName.of('DW'))) ?? 1000
  const widths = new Map<number, number>()
  const w = descendant.lookupMaybe(PDFName.of('W'), PDFArray)
  if (w) {
    let index = 0
    while (index < w.size()) {
      const first = numberOf(w.lookup(index))
      const next = w.lookup(index + 1)
      if (first === null) {
        return null
      }
      if (next instanceof PDFArray) {
        for (let offset = 0; offset < next.size(); offset += 1) {
          widths.set(first + offset, numberOf(next.lookup(offset)) ?? defaultWidth)
        }
        index += 2
      } else {
        const last = numberOf(next)
        const width = numberOf(w.lookup(index + 2))
        if (last === null || width === null || last - first > 65535) {
          return null
        }
        for (let code = first; code <= last; code += 1) {
          widths.set(code, width)
        }
        index += 3
      }
    }
  }
  return { bytesPerCode: 2, width: (code) => widths.get(code) ?? defaultWidth }
}

function simpleMetrics(font: PDFDict): FontMetrics | null {
  const widthsArray = font.lookupMaybe(PDFName.of('Widths'), PDFArray)
  const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  const missing = numberOf(descriptor?.lookup(PDFName.of('MissingWidth'))) ?? 0
  if (widthsArray) {
    const firstChar = numberOf(font.lookup(PDFName.of('FirstChar'))) ?? 0
    const widths: number[] = []
    for (let index = 0; index < widthsArray.size(); index += 1) {
      widths.push(numberOf(widthsArray.lookup(index)) ?? missing)
    }
    return { bytesPerCode: 1, width: (code) => widths[code - firstChar] ?? missing }
  }
  // The standard 14 fonts may omit Widths; use their built-in metrics.
  const standard = standardFont(nameOf(font.get(PDFName.of('BaseFont'))))
  if (!standard) {
    return null
  }
  return { bytesPerCode: 1, width: (code) => standard.widthOf(code) }
}

const STANDARD_ALIASES: Record<string, FontNames> = {
  Helvetica: FontNames.Helvetica,
  'Helvetica-Bold': FontNames.HelveticaBold,
  'Helvetica-Oblique': FontNames.HelveticaOblique,
  'Helvetica-BoldOblique': FontNames.HelveticaBoldOblique,
  Arial: FontNames.Helvetica,
  'Arial,Bold': FontNames.HelveticaBold,
  'Times-Roman': FontNames.TimesRoman,
  'Times-Bold': FontNames.TimesRomanBold,
  'Times-Italic': FontNames.TimesRomanItalic,
  'Times-BoldItalic': FontNames.TimesRomanBoldItalic,
  TimesNewRoman: FontNames.TimesRoman,
  Courier: FontNames.Courier,
  'Courier-Bold': FontNames.CourierBold,
  'Courier-Oblique': FontNames.CourierOblique,
  'Courier-BoldOblique': FontNames.CourierBoldOblique,
  Symbol: FontNames.Symbol,
  ZapfDingbats: FontNames.ZapfDingbats,
}

const codeNameCache = new Map<EncodingType, Map<number, string>>()

function standardFont(baseFont: string | null): { widthOf: (code: number) => number } | null {
  const fontName = baseFont ? STANDARD_ALIASES[baseFont.replace(/^[A-Z]{6}\+/, '')] : undefined
  if (!fontName) {
    return null
  }
  const font = Font.load(fontName)
  const encoding =
    fontName === FontNames.Symbol
      ? Encodings.Symbol
      : fontName === FontNames.ZapfDingbats
        ? Encodings.ZapfDingbats
        : Encodings.WinAnsi
  let names = codeNameCache.get(encoding)
  if (!names) {
    names = new Map()
    for (const codePoint of encoding.supportedCodePoints) {
      const { code, name } = encoding.encodeUnicodeCodePoint(codePoint)
      if (!names.has(code)) {
        names.set(code, name)
      }
    }
    codeNameCache.set(encoding, names)
  }
  const map = names
  return {
    widthOf: (code) => {
      const name = map.get(code)
      return (name ? font.getWidthOfGlyph(name) : undefined) ?? 0
    },
  }
}

function nameOf(value: PDFObject | undefined): string | null {
  return value instanceof PDFName ? value.decodeText() : null
}

function numberOf(value: PDFObject | undefined): number | null {
  return value instanceof PDFNumber ? value.asNumber() : null
}
