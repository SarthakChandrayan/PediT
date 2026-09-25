import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { inflate } from 'pako'
import { samePdfFontName } from './textAppearance.ts'

function registerFontkit(pdf: PDFDocument): void {
  pdf.registerFontkit(fontkit)
}

/**
 * Re-embeds the original page font when its program is in the PDF.
 * Standard fonts have no FontFile; those return null so export can use
 * Helvetica/Times/Courier as it already does.
 */
export async function embedOriginalFont(
  pdf: PDFDocument,
  page: PDFPage,
  pdfFontName: string | undefined,
  cache: Map<string, PDFFont | null>,
): Promise<PDFFont | null> {
  if (!pdfFontName) {
    return null
  }
  const cached = cache.get(pdfFontName)
  if (cached !== undefined) {
    return cached
  }

  const bytes = fontProgramOnPage(page, pdfFontName)
  if (!bytes || bytes.byteLength < 16) {
    cache.set(pdfFontName, null)
    return null
  }

  try {
    registerFontkit(pdf)
    const font = await pdf.embedFont(bytes, { subset: false })
    cache.set(pdfFontName, font)
    return font
  } catch {
    cache.set(pdfFontName, null)
    return null
  }
}

export function fontProgramOnPage(page: PDFPage, pdfFontName: string): Uint8Array | null {
  const resources = page.node.Resources()
  if (!(resources instanceof PDFDict)) {
    return null
  }
  const fonts = resources.lookup(PDFName.of('Font'))
  if (!(fonts instanceof PDFDict)) {
    return null
  }
  for (const [, value] of fonts.entries()) {
    const dict = asDict(value, page.doc.context)
    if (!dict) {
      continue
    }
    if (!fontDictMatches(dict, pdfFontName, page.doc.context)) {
      continue
    }
    const program = fontProgramFromDict(dict, page.doc.context)
    if (program) {
      return program
    }
  }
  return null
}

function fontDictMatches(
  dict: PDFDict,
  pdfFontName: string,
  context: PDFDocument['context'],
): boolean {
  if (samePdfFontName(baseFontName(dict), pdfFontName)) {
    return true
  }
  const descendants = dict.lookup(PDFName.of('DescendantFonts'))
  if (descendants instanceof PDFArray) {
    for (let index = 0; index < descendants.size(); index += 1) {
      const child = asDict(descendants.lookup(index), context)
      if (child && samePdfFontName(baseFontName(child), pdfFontName)) {
        return true
      }
    }
  }
  return false
}

function fontProgramFromDict(
  dict: PDFDict,
  context: PDFDocument['context'],
): Uint8Array | null {
  const fromDescriptor = programFromDescriptor(asDict(dict.lookup(PDFName.of('FontDescriptor')), context))
  if (fromDescriptor) {
    return fromDescriptor
  }
  const descendants = dict.lookup(PDFName.of('DescendantFonts'))
  if (!(descendants instanceof PDFArray)) {
    return null
  }
  for (let index = 0; index < descendants.size(); index += 1) {
    const child = asDict(descendants.lookup(index), context)
    if (!child) {
      continue
    }
    const program = programFromDescriptor(
      asDict(child.lookup(PDFName.of('FontDescriptor')), context),
    )
    if (program) {
      return program
    }
  }
  return null
}

function programFromDescriptor(descriptor: PDFDict | null): Uint8Array | null {
  if (!descriptor) {
    return null
  }
  for (const key of ['FontFile2', 'FontFile3', 'FontFile'] as const) {
    const stream = descriptor.lookup(PDFName.of(key))
    if (stream instanceof PDFRawStream) {
      return decodeFontBytes(stream)
    }
  }
  return null
}

function decodeFontBytes(stream: PDFRawStream): Uint8Array | null {
  let bytes = stream.getContents().slice()
  const names = filterNames(stream.dict.lookup(PDFName.of('Filter')))
  for (const name of names) {
    if (name === 'FlateDecode' || name === 'Fl') {
      try {
        bytes = inflate(bytes)
      } catch {
        return null
      }
      continue
    }
    return null
  }
  return bytes
}

function filterNames(filter: unknown): string[] {
  if (filter instanceof PDFName) {
    return [filter.decodeText()]
  }
  if (filter instanceof PDFArray) {
    const names: string[] = []
    for (let index = 0; index < filter.size(); index += 1) {
      const item = filter.lookup(index)
      if (item instanceof PDFName) {
        names.push(item.decodeText())
      }
    }
    return names
  }
  return []
}

function baseFontName(dict: PDFDict): string | undefined {
  const base = dict.lookup(PDFName.of('BaseFont'))
  if (base instanceof PDFName) {
    return base.decodeText()
  }
  return undefined
}

function asDict(value: unknown, context: PDFDocument['context']): PDFDict | null {
  if (value instanceof PDFDict) {
    return value
  }
  if (value instanceof PDFRef) {
    const resolved = context.lookup(value)
    return resolved instanceof PDFDict ? resolved : null
  }
  return null
}
