import { describe, expect, it } from 'vitest'
import {
  fontFamilyBase,
  restyleRange,
  styleIndex,
  styleVariant,
  stylesInRange,
} from './richText.ts'
import type { TextRunAppearance } from './textEdits.ts'

function face(patch: Partial<TextRunAppearance>): TextRunAppearance {
  return { bold: false, italic: false, fontSize: 12, horizontalScale: 1, vertical: false, ...patch }
}

describe('restyleRange', () => {
  it('restyles part of a segment and merges neighbours of the same style', () => {
    const segments = [{ text: 'Hello world', style: 0 }]
    expect(restyleRange(segments, 6, 11, () => 1)).toEqual([
      { text: 'Hello ', style: 0 },
      { text: 'world', style: 1 },
    ])
  })

  it('spans several segments', () => {
    const segments = [
      { text: 'ab', style: 0 },
      { text: 'cd', style: 1 },
      { text: 'ef', style: 0 },
    ]
    expect(restyleRange(segments, 1, 5, () => 2)).toEqual([
      { text: 'a', style: 0 },
      { text: 'bcde', style: 2 },
      { text: 'f', style: 0 },
    ])
  })

  it('reports the styles used in a range', () => {
    const segments = [
      { text: 'ab', style: 0 },
      { text: 'cd', style: 1 },
    ]
    expect(stylesInRange(segments, 0, 2)).toEqual([0])
    expect(stylesInRange(segments, 1, 3).sort()).toEqual([0, 1])
  })
})

describe('styleIndex', () => {
  it('reuses an identical style and appends a new one', () => {
    const regular = face({ pdfFontName: 'Helvetica' })
    const bold = face({ pdfFontName: 'Helvetica-Bold', bold: true })
    expect(styleIndex([regular], face({ pdfFontName: 'Helvetica' })).index).toBe(0)
    const added = styleIndex([regular], bold)
    expect(added.index).toBe(1)
    expect(added.styles).toHaveLength(2)
  })
})

describe('fontFamilyBase', () => {
  it('normalises subset prefixes and style suffixes', () => {
    expect(fontFamilyBase('ABCDEF+Calibri-Bold')).toBe('calibri')
    expect(fontFamilyBase('Calibri,Italic')).toBe('calibri')
    expect(fontFamilyBase('Helvetica-BoldOblique')).toBe('helvetica')
    expect(fontFamilyBase('TimesNewRomanPS-BoldMT')).toBe(fontFamilyBase('TimesNewRomanPSMT'))
    expect(fontFamilyBase(undefined)).toBeNull()
  })
})

describe('styleVariant', () => {
  const regular = face({ pdfFontName: 'ABCDEF+Calibri', loadedName: 'g_d0_f1' })
  const boldFace = face({ pdfFontName: 'GHIJKL+Calibri-Bold', loadedName: 'g_d0_f2', bold: true })

  it('uses a bold face of the same family that is already in the PDF', () => {
    const variant = styleVariant(regular, { bold: true }, [regular, boldFace])
    expect(variant.pdfFontName).toBe('GHIJKL+Calibri-Bold')
    expect(variant.loadedName).toBe('g_d0_f2')
    expect(variant.bold).toBe(true)
  })

  it('drops the font reference when the PDF has no matching face', () => {
    const variant = styleVariant(regular, { italic: true }, [regular, boldFace])
    expect(variant.pdfFontName).toBeUndefined()
    expect(variant.loadedName).toBeUndefined()
    expect(variant.italic).toBe(true)
    expect(variant.fallbackFamily).toBe('sans-serif')
  })

  it('keeps the font for a colour-only change', () => {
    const variant = styleVariant(regular, { color: { r: 1, g: 0, b: 0 } }, [regular])
    expect(variant.pdfFontName).toBe('ABCDEF+Calibri')
    expect(variant.color).toEqual({ r: 1, g: 0, b: 0 })
  })
})
