import { PDFDocument, StandardFonts, rgb, degrees, setTextRenderingMode, TextRenderingMode } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { commitDocument, createDocumentHistory, redoHistory, undoHistory } from './documentHistory.ts'
import { exportEditedPdf } from './exportPdf.ts'
import {
  appearanceForRun,
  collectTextColorSamples,
  fittedOverlayWidth,
  horizontalFitFactor,
  matchTextColor,
  metricsFromMatrix,
  pdfTextOperators,
  readPageTextCapture,
  replacementFontCss,
  resolveStandardFont,
  samePdfFontName,
} from './textAppearance.ts'
import { fontProgramOnPage } from './originalFont.ts'
import {
  beginTextEdit,
  commitTextEdit,
  emptyEditorState,
  type TextEdit,
  type TextRunAppearance,
} from './textEdits.ts'
GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href

type RunSnapshot = {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
}

describe('text appearance', () => {
  it('maps known font names onto standard fonts and falls back otherwise', () => {
    expect(resolveStandardFont(face({ pdfFontName: 'ABCDEF+Arial-BoldMT', bold: true }))).toBe(
      StandardFonts.HelveticaBold,
    )
    expect(resolveStandardFont(face({ pdfFontName: 'Times-Italic', italic: true }))).toBe(
      StandardFonts.TimesRomanItalic,
    )
    expect(resolveStandardFont(face({ pdfFontName: 'CourierNewPS-BoldMT', bold: true }))).toBe(
      StandardFonts.CourierBold,
    )
    expect(
      resolveStandardFont(face({ fallbackFamily: 'serif', bold: true, italic: true })),
    ).toBe(StandardFonts.TimesRomanBoldItalic)
    expect(resolveStandardFont(face({ pdfFontName: 'Symbol' }))).toBe(StandardFonts.Helvetica)
    expect(resolveStandardFont(undefined)).toBe(StandardFonts.Helvetica)
    expect(resolveStandardFont(face({ pdfFontName: 'SomeDisplayFont' }))).toBe(
      StandardFonts.Helvetica,
    )
    expect(samePdfFontName('EAFJKL+Calibri', 'Calibri')).toBe(true)
    expect(samePdfFontName('Calibri', 'Calibri-Bold')).toBe(false)
    expect(
      replacementFontCss(face({ loadedName: 'g_d0_f1', pdfFontName: 'EAFJKL+Calibri' })),
    ).toEqual({
      fontFamily: '"g_d0_f1", Helvetica, Arial, sans-serif',
    })
    expect(replacementFontCss(face({ pdfFontName: 'Calibri', bold: false }))).toEqual({
      fontFamily: 'Helvetica, Arial, sans-serif',
    })
    expect(replacementFontCss(face({ pdfFontName: 'Calibri-Bold', bold: true })).fontWeight).toBe(
      700,
    )
  })

  it('reads font size and horizontal scale from the PDF text matrix', () => {
    expect(metricsFromMatrix([16, 0, 0, 16, 40, 100])).toEqual({
      fontSize: 16,
      horizontalScale: 1,
    })
    expect(metricsFromMatrix([8, 0, 0, 16, 0, 0])).toEqual({
      fontSize: 16,
      horizontalScale: 0.5,
    })
    const turned = metricsFromMatrix([0, 16, -16, 0, 80, 180])
    expect(turned?.fontSize).toBe(16)
    expect(turned?.horizontalScale).toBe(1)
  })

  it('reads a solid fill color from text operators', () => {
    const samples = collectTextColorSamples(
      [
        pdfTextOperators.setFillRGBColor,
        pdfTextOperators.beginText,
        pdfTextOperators.setTextMatrix,
        pdfTextOperators.setFont,
        pdfTextOperators.showText,
      ],
      [
        ['#cc1a33'],
        [],
        [1, 0, 0, 1, 50, 300],
        ['g_f1', 18],
        [[{ unicode: 'B', width: 700, isSpace: false }]],
      ],
    )
    expect(matchTextColor(50, 300, samples)).toEqual({
      r: 204 / 255,
      g: 26 / 255,
      b: 51 / 255,
    })
    expect(matchTextColor(10, 10, samples)).toBeUndefined()
  })

  it('exports black replacement text', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Hello', { x: 48, y: 240, size: 16, font, color: rgb(0, 0, 0) })
    }, StandardFonts.Helvetica)
    const edit = await editOf(source.bytes, 'Hello', 'World')
    const exported = await exportEditedPdf(copyBuffer(source.bytes), [edit])
    const items = await textItems(exported)
    expect(items.some((item) => item.str === 'World')).toBe(true)
    const loaded = await PDFDocument.load(exported)
    expect(loaded.getPageCount()).toBe(1)
  })

  it('maps detectable bold text to a bold standard font', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Bold', { x: 48, y: 240, size: 18, font, color: rgb(0, 0, 0) })
    }, StandardFonts.HelveticaBold)
    const edit = await editOf(source.bytes, 'Bold', 'Strong')
    expect(edit.appearance?.bold).toBe(true)
    expect(resolveStandardFont(edit.appearance)).toBe(StandardFonts.HelveticaBold)
    const exported = await exportEditedPdf(copyBuffer(source.bytes), [edit])
    expect(await fontNameFor(exported, 'Strong')).toBe('Helvetica-Bold')
  })

  it('keeps a regular face regular and draws it fill-only', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([612, 792])
    page.drawText('Hello', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) })
    page.pushOperators(setTextRenderingMode(TextRenderingMode.FillAndOutline))
    const bytes = await doc.save()

    const edit = await editOf(bytes, 'Hello', 'Hello')
    expect(edit.appearance?.pdfFontName).toMatch(/Helvetica/)
    expect(edit.appearance?.loadedName).toEqual(expect.any(String))
    expect(edit.appearance?.bold).toBe(false)
    expect(resolveStandardFont(edit.appearance)).toBe(StandardFonts.Helvetica)

    const exported = await exportEditedPdf(copyBuffer(bytes), [edit])
    expect(await fontNameFor(exported, 'Hello')).toBe('Helvetica')
    expect(await lastTextRenderingMode(exported)).toBe(0)
  })

  it('does not extract a FontFile from a standard Helvetica page', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Hello', { x: 48, y: 240, size: 16, font, color: rgb(0, 0, 0) })
    }, StandardFonts.Helvetica)
    const pdf = await PDFDocument.load(source.bytes)
    expect(fontProgramOnPage(pdf.getPage(0), 'Helvetica')).toBeNull()
  })

  it('maps detectable italic text to an italic standard font', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Italic', { x: 48, y: 220, size: 16, font, color: rgb(0, 0, 0) })
    }, StandardFonts.TimesRomanItalic)
    const edit = await editOf(source.bytes, 'Italic', 'Slant')
    expect(edit.appearance?.italic).toBe(true)
    expect(resolveStandardFont(edit.appearance)).toBe(StandardFonts.TimesRomanItalic)
    const exported = await exportEditedPdf(copyBuffer(source.bytes), [edit])
    expect(await fontNameFor(exported, 'Slant')).toBe('Times-Italic')
  })

  it('keeps a detected text color on the replacement', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Color', { x: 48, y: 200, size: 16, font, color: rgb(0.1, 0.2, 0.8) })
    }, StandardFonts.Helvetica)
    const edit = await editOf(source.bytes, 'Color', 'Tint')
    expect(edit.appearance?.color?.b).toBeGreaterThan(0.7)
    expect(edit.appearance?.color?.r).toBeLessThan(0.2)
    const exported = await exportEditedPdf(copyBuffer(source.bytes), [edit])
    const tint = (await textItems(exported)).find((item) => item.str === 'Tint')
    if (!tint) {
      throw new Error('expected the replacement run')
    }
    const color = await colorAt(exported, tint.transform[4] ?? 0, tint.transform[5] ?? 0)
    expect(color?.b).toBeGreaterThan(0.7)
    expect(color?.r).toBeLessThan(0.2)
  })

  it('keeps rotation and shear on the replacement', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([500, 500])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Turn', { x: 80, y: 180, size: 16, font, rotate: degrees(90) })
    page.drawText('Tilt', { x: 200, y: 180, size: 16, font, xSkew: degrees(15) })
    const bytes = new Uint8Array(await doc.save())
    const turned = await editOf(bytes, 'Turn', 'Spin')
    const tilted = await editOf(bytes, 'Tilt', 'Lean')
    expect(turned.appearance?.fontSize).toBeCloseTo(16, 1)
    const exported = await exportEditedPdf(copyBuffer(bytes), [turned, tilted])
    const items = await textItems(exported)
    const spin = items.find((item) => item.str === 'Spin')
    const lean = items.find((item) => item.str === 'Lean')
    if (!spin || !lean) {
      throw new Error('expected rotated and sheared replacements')
    }
    expect(Math.abs(spin.transform[0] ?? 0)).toBeLessThan(0.5)
    expect(spin.transform[1] ?? 0).toBeCloseTo(16, 0)
    expect(spin.transform[2] ?? 0).toBeCloseTo(-16, 0)
    const shear = (lean.transform[1] ?? 0) / (lean.transform[0] || 1)
    expect(shear).toBeCloseTo(Math.tan((15 * Math.PI) / 180), 1)
    expect(lean.transform[3] ?? 0).toBeCloseTo(16, 0)
  })

  it('uses the same width factor for short, longer, and much longer replacements', () => {
    expect(horizontalFitFactor(20, 40)).toBe(1)
    expect(fittedOverlayWidth(20, 40)).toBe(20)
    expect(horizontalFitFactor(40, 40)).toBe(1)
    expect(horizontalFitFactor(40.8, 40)).toBe(1)
    expect(horizontalFitFactor(80, 40)).toBeCloseTo(0.5)
    expect(fittedOverlayWidth(80, 40)).toBeCloseTo(40)
    expect(fittedOverlayWidth(200, 40)).toBeCloseTo(40)
    expect(horizontalFitFactor(200, 40, true)).toBe(1)
  })

  it('fits short, longer, and much longer replacements the same way on screen and export', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Hi', { x: 40, y: 120, size: 14, font, color: rgb(0, 0, 0) })
    }, StandardFonts.Helvetica)
    const original = await editOf(source.bytes, 'Hi', 'Hi')
    const cases = [
      { text: 'Hi', kind: 'short' },
      { text: 'Hello there', kind: 'longer' },
      { text: 'HELLOHELLOHELLOHELLOHELLO', kind: 'significantly longer' },
    ] as const

    for (const replacement of cases) {
      const edit = { ...original, editedText: replacement.text }
      const exported = await exportEditedPdf(copyBuffer(source.bytes), [edit])
      const run = (await textItems(exported)).find((item) => item.str === replacement.text)
      if (!run) {
        throw new Error(`expected the ${replacement.kind} replacement`)
      }

      const pdf = await PDFDocument.load(exported)
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const natural = font.widthOfTextAtSize(replacement.text, edit.appearance?.fontSize ?? 14)
      const screenWidth = fittedOverlayWidth(natural, edit.width, edit.appearance?.vertical === true)
      const factor = horizontalFitFactor(natural, edit.width, edit.appearance?.vertical === true)

      if (replacement.kind === 'short') {
        expect(factor).toBe(1)
        expect(run.width).toBeGreaterThan(0)
        expect(run.width).toBeLessThanOrEqual(edit.width * 1.08)
      } else {
        expect(run.width).toBeLessThanOrEqual(edit.width * 1.08)
        expect(screenWidth).toBeLessThanOrEqual(edit.width * 1.02)
        expect(Math.abs(run.width - screenWidth)).toBeLessThan(edit.width * 0.12)
      }
    }
  })

  it('keeps a much longer replacement inside the original run width', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Hi', { x: 40, y: 120, size: 14, font, color: rgb(0, 0, 0) })
    }, StandardFonts.Helvetica)
    const edit = await editOf(source.bytes, 'Hi', 'HELLOHELLOHELLO')
    const exported = await exportEditedPdf(copyBuffer(source.bytes), [edit])
    const loaded = await PDFDocument.load(exported)
    expect(loaded.getPageCount()).toBe(1)
    const items = await textItems(exported)
    const replacement = items.find((item) => item.str === 'HELLOHELLOHELLO')
    if (!replacement) {
      throw new Error('expected the long replacement')
    }
    expect(replacement.width).toBeLessThanOrEqual(edit.width * 1.08)
    expect(replacement.width).toBeGreaterThan(edit.width * 0.9)
  })

  it('keeps WinAnsi characters and replaces characters a standard font cannot encode', async () => {
    const source = await drawPdf((page, font) => {
      page.drawText('Cafe', { x: 40, y: 80, size: 14, font, color: rgb(0, 0, 0) })
    }, StandardFonts.Helvetica)
    const supported = await editOf(source.bytes, 'Cafe', 'Café')
    const withAccent = await exportEditedPdf(copyBuffer(source.bytes), [supported])
    expect((await textItems(withAccent)).some((item) => item.str === 'Café')).toBe(true)

    const unsupported = await editOf(source.bytes, 'Cafe', '你')
    const withFallback = await exportEditedPdf(copyBuffer(source.bytes), [unsupported])
    const loaded = await PDFDocument.load(withFallback)
    expect(loaded.getPageCount()).toBe(1)
    expect((await textItems(withFallback)).some((item) => item.str === '?')).toBe(true)
  })

  it('keeps appearance metadata across undo and redo', () => {
    const appearance: TextRunAppearance = {
      pdfFontName: 'Arial-BoldMT',
      fallbackFamily: 'sans-serif',
      bold: true,
      italic: false,
      fontSize: 18,
      horizontalScale: 1,
      color: { r: 0.8, g: 0.1, b: 0.2 },
      ascent: 0.72,
      descent: -0.21,
      vertical: false,
    }
    const committed = commitTextEdit(
      beginTextEdit(
        emptyEditorState(),
        {
          id: '1:0',
          pageNumber: 1,
          originalText: 'Bold',
          pdfX: 48,
          pdfY: 240,
          width: 40,
          height: 18,
          transform: [18, 0, 0, 18, 48, 240],
          fontName: 'Arial-BoldMT',
          appearance,
        },
        'Strong',
      ),
    )
    const committedColor = committed.edits[0]?.appearance?.color
    let history = commitDocument(createDocumentHistory(), (snapshot) => ({
      ...snapshot,
      edits: committed.edits,
    }))
    if (committedColor) {
      committedColor.r = 0
    }
    expect(history.present.snapshot.edits[0]?.appearance?.color?.r).toBe(0.8)

    history = undoHistory(history)
    expect(history.present.snapshot.edits).toHaveLength(0)
    history = redoHistory(history)
    expect(history.present.snapshot.edits[0]?.appearance).toEqual(appearance)
    expect(resolveStandardFont(history.present.snapshot.edits[0]?.appearance)).toBe(
      StandardFonts.HelveticaBold,
    )
  })
})

function face(
  appearance: Partial<TextRunAppearance>,
): TextRunAppearance {
  return {
    bold: false,
    italic: false,
    fontSize: 12,
    horizontalScale: 1,
    vertical: false,
    ...appearance,
  }
}

async function drawPdf(
  draw: (
    page: ReturnType<PDFDocument['addPage']>,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  ) => void,
  standard: StandardFonts,
): Promise<{ bytes: Uint8Array }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const font = await doc.embedFont(standard)
  draw(page, font)
  return { bytes: new Uint8Array(await doc.save()) }
}

async function editOf(bytes: Uint8Array, original: string, editedText: string): Promise<TextEdit> {
  const pdf = await openPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    const text = await page.getTextContent()
    const item = text.items.find((entry) => 'str' in entry && entry.str === original)
    if (!item || !('str' in item)) {
      throw new Error(`missing text run ${original}`)
    }
    const style = text.styles[item.fontName]
    const captured = await readPageTextCapture(page, [item.fontName])
    const appearance = appearanceForRun({
      transform: item.transform,
      styleFamily: style?.fontFamily,
      font: captured.fonts.get(item.fontName),
      color: matchTextColor(item.transform[4] ?? 0, item.transform[5] ?? 0, captured.colors),
      ascent: style?.ascent,
      descent: style?.descent,
      vertical: style?.vertical,
    })
    return {
      id: '1:0',
      pageNumber: 1,
      originalText: original,
      editedText,
      pdfX: item.transform[4] ?? 0,
      pdfY: item.transform[5] ?? 0,
      width: item.width,
      height: item.height,
      transform: item.transform.slice(0, 6).map((value) => Number(value)),
      fontName: appearance.pdfFontName,
      appearance,
    }
  } finally {
    await pdf.destroy()
  }
}

async function textItems(bytes: Uint8Array): Promise<RunSnapshot[]> {
  const pdf = await openPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    const text = await page.getTextContent()
    return text.items.flatMap((entry) => {
      if (!('str' in entry)) {
        return []
      }
      return [
        {
          str: entry.str,
          transform: entry.transform.slice(0, 6).map((value) => Number(value)),
          width: entry.width,
          height: entry.height,
          fontName: entry.fontName,
        },
      ]
    })
  } finally {
    await pdf.destroy()
  }
}

async function fontNameFor(bytes: Uint8Array, text: string): Promise<string | undefined> {
  const pdf = await openPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    const content = await page.getTextContent()
    await page.getOperatorList()
    const item = content.items.find((entry) => 'str' in entry && entry.str === text)
    if (!item || !('str' in item) || !page.commonObjs.has(item.fontName)) {
      return undefined
    }
    const font = page.commonObjs.get(item.fontName) as { name?: string }
    return font.name
  } finally {
    await pdf.destroy()
  }
}

async function colorAt(bytes: Uint8Array, x: number, y: number) {
  const pdf = await openPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    const ops = await page.getOperatorList()
    return matchTextColor(x, y, collectTextColorSamples(ops.fnArray, ops.argsArray))
  } finally {
    await pdf.destroy()
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

async function lastTextRenderingMode(bytes: Uint8Array): Promise<number | undefined> {
  const pdf = await openPdf(bytes)
  try {
    const page = await pdf.getPage(1)
    const ops = await page.getOperatorList()
    let mode = 0
    let last: number | undefined
    for (let index = 0; index < ops.fnArray.length; index += 1) {
      const fn = ops.fnArray[index]
      if (fn === pdfTextOperators.setTextRenderingMode) {
        const value = ops.argsArray[index]?.[0]
        if (typeof value === 'number') {
          mode = value
        }
      }
      if (fn === pdfTextOperators.showText || fn === pdfTextOperators.showSpacedText) {
        last = mode
      }
    }
    return last
  } finally {
    await pdf.destroy()
  }
}

async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes.slice() }).promise
}

