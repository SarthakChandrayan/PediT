import type { TextRunAppearance, TextSegment } from './textEdits.ts'

/** Identity of a text style, for de-duplicating a paragraph's style list. */
export function appearanceKey(appearance: TextRunAppearance): string {
  const color = appearance.color
  return [
    appearance.pdfFontName ?? '',
    appearance.loadedName ?? '',
    appearance.fallbackFamily ?? '',
    appearance.bold ? 'b' : '',
    appearance.italic ? 'i' : '',
    color ? `${color.r.toFixed(3)},${color.g.toFixed(3)},${color.b.toFixed(3)}` : '',
  ].join('|')
}

/** Returns the index of `appearance` in `styles`, appending it if new. */
export function styleIndex(
  styles: readonly TextRunAppearance[],
  appearance: TextRunAppearance,
): { styles: TextRunAppearance[]; index: number } {
  const key = appearanceKey(appearance)
  const found = styles.findIndex((style) => appearanceKey(style) === key)
  if (found >= 0) {
    return { styles: [...styles], index: found }
  }
  return { styles: [...styles, appearance], index: styles.length }
}

/** Applies `mapStyle` to every character in [start, end). */
export function restyleRange(
  segments: readonly TextSegment[],
  start: number,
  end: number,
  mapStyle: (style: number) => number,
): TextSegment[] {
  const result: TextSegment[] = []
  const push = (text: string, style: number) => {
    if (text.length === 0) {
      return
    }
    const last = result[result.length - 1]
    if (last && last.style === style) {
      last.text += text
    } else {
      result.push({ text, style })
    }
  }
  let offset = 0
  for (const segment of segments) {
    const segmentEnd = offset + segment.text.length
    const from = Math.max(start, offset)
    const to = Math.min(end, segmentEnd)
    if (from >= to) {
      push(segment.text, segment.style)
    } else {
      push(segment.text.slice(0, from - offset), segment.style)
      push(segment.text.slice(from - offset, to - offset), mapStyle(segment.style))
      push(segment.text.slice(to - offset), segment.style)
    }
    offset = segmentEnd
  }
  return result
}

/** Styles used by any character in [start, end). */
export function stylesInRange(
  segments: readonly TextSegment[],
  start: number,
  end: number,
): number[] {
  const used = new Set<number>()
  let offset = 0
  for (const segment of segments) {
    const segmentEnd = offset + segment.text.length
    if (Math.max(start, offset) < Math.min(end, segmentEnd)) {
      used.add(segment.style)
    }
    offset = segmentEnd
  }
  return [...used]
}

export type StylePatch = {
  bold?: boolean
  italic?: boolean
  color?: { r: number; g: number; b: number }
}

/**
 * `base` with a weight, slant or color change. A weight or slant change uses
 * a face of the same family already in the PDF when there is one ("Calibri"
 * → "Calibri-Bold"), so the result matches the document. Otherwise the font
 * reference is dropped and export uses the closest standard font.
 */
export function styleVariant(
  base: TextRunAppearance,
  patch: StylePatch,
  pageStyles: readonly TextRunAppearance[],
): TextRunAppearance {
  const bold = patch.bold ?? base.bold
  const italic = patch.italic ?? base.italic
  const color = patch.color ? { ...patch.color } : base.color ? { ...base.color } : undefined
  if (bold === base.bold && italic === base.italic) {
    return { ...base, color }
  }

  const family = fontFamilyBase(base.pdfFontName)
  const sibling = family
    ? pageStyles.find(
        (style) =>
          fontFamilyBase(style.pdfFontName) === family &&
          isBold(style) === bold &&
          isItalic(style) === italic,
      )
    : undefined
  if (sibling) {
    return {
      ...base,
      pdfFontName: sibling.pdfFontName,
      loadedName: sibling.loadedName,
      ascent: sibling.ascent ?? base.ascent,
      descent: sibling.descent ?? base.descent,
      bold,
      italic,
      color,
    }
  }
  return {
    ...base,
    pdfFontName: undefined,
    loadedName: undefined,
    fallbackFamily: base.fallbackFamily ?? familyKind(base.pdfFontName),
    bold,
    italic,
    color,
  }
}

export function isBold(style: TextRunAppearance): boolean {
  return style.bold || /bold|black|heavy|semibold|demi/i.test(style.pdfFontName ?? '')
}

export function isItalic(style: TextRunAppearance): boolean {
  return style.italic || /italic|oblique/i.test(style.pdfFontName ?? '')
}

/** "ABCDEF+Calibri-BoldItalic" → "calibri". */
export function fontFamilyBase(pdfFontName: string | undefined): string | null {
  if (!pdfFontName) {
    return null
  }
  let name = pdfFontName.replace(/^[A-Z]{6}\+/, '')
  // Strip vendor and style suffixes until nothing changes:
  // "TimesNewRomanPS-BoldMT" and "TimesNewRomanPSMT" both become "timesnewroman".
  for (let previous = ''; previous !== name; ) {
    previous = name
    name = name
      .replace(/(PSMT|MT|PS)$/, '')
      .replace(/[-,_ ]?(bold|black|heavy|semibold|demibold|demi|medium|regular|roman|book|italic|oblique)$/i, '')
      .replace(/[-,_ ]+$/, '')
  }
  name = name.toLowerCase()
  return name.length > 0 ? name : null
}

function familyKind(pdfFontName: string | undefined): TextRunAppearance['fallbackFamily'] {
  const name = pdfFontName?.toLowerCase() ?? ''
  if (/times|georgia|garamond|serif|cambria|book/.test(name) && !/sans/.test(name)) {
    return 'serif'
  }
  if (/courier|mono|consol/.test(name)) {
    return 'monospace'
  }
  return 'sans-serif'
}
