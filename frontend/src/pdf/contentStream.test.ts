import { describe, expect, it } from 'vitest'
import {
  parseOperations,
  removeGlyphsInRegions,
  type FontLookup,
  type Region,
} from './contentStream.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder('latin1')

/** Every glyph is 500 units wide: half an em. */
const monospace: FontLookup = (name) =>
  name === 'F1' ? { bytesPerCode: 1, width: () => 500 } : null

function run(content: string, regions: Region[], fonts: FontLookup = monospace) {
  const result = removeGlyphsInRegions(encoder.encode(content), regions, fonts)
  return result ? { text: decoder.decode(result.bytes), removed: result.removed } : null
}

/** Text left after removal, by re-reading every shown string. */
function shownText(content: string): string {
  const operations = parseOperations(encoder.encode(content)) ?? []
  let text = ''
  for (const operation of operations) {
    for (const operand of operation.operands) {
      const items = Array.isArray(operand) ? operand : [operand]
      for (const item of items) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item) && item.kind === 'string') {
          text += String.fromCharCode(...item.bytes)
        }
      }
    }
  }
  return text
}

// At 10pt each glyph advances 5pt. "Hello world" starts at x=100, baseline 700.
const line = 'BT /F1 10 Tf 100 700 Td (Hello world) Tj ET'

describe('removeGlyphsInRegions', () => {
  it('removes glyphs inside the region and keeps the rest', () => {
    // "world" spans x 130..155.
    const result = run(line, [{ x0: 129, y0: 695, x1: 156, y1: 712 }])
    expect(result).not.toBeNull()
    expect(result!.removed).toBe(5)
    expect(shownText(result!.text)).toBe('Hello ')
  })

  it('replaces removed glyphs with an equal-width adjustment', () => {
    const result = run(line, [{ x0: 99, y0: 695, x1: 126, y1: 712 }])
    // "Hello" (5 glyphs × 500) becomes -2500, keeping " world" in place.
    expect(result!.text).toContain('[-2500 <20776f726c64>] TJ')
  })

  it('removes a whole operator', () => {
    const result = run(line, [{ x0: 0, y0: 0, x1: 612, y1: 792 }])
    expect(shownText(result!.text)).toBe('')
    expect(result!.text).toContain('[-5500] TJ')
  })

  it('leaves text outside every region untouched', () => {
    expect(run(line, [{ x0: 0, y0: 0, x1: 50, y1: 50 }])).toBeNull()
  })

  it('handles TJ arrays and keeps their kerning', () => {
    const content = 'BT /F1 10 Tf 100 700 Td [(AB) -200 (CD)] TJ ET'
    // A at 100, B at 105, kern +2pt, C at 112, D at 117.
    const result = run(content, [{ x0: 111, y0: 695, x1: 116, y1: 712 }])
    expect(shownText(result!.text)).toBe('ABD')
  })

  it('tracks position across Td, T* and the quote operator', () => {
    const content = "BT /F1 10 Tf 14 TL 100 700 Td (top) Tj T* (mid) Tj (low) ' ET"
    // "mid" sits on baseline 686, "low" on 672.
    const result = run(content, [{ x0: 99, y0: 683, x1: 120, y1: 692 }])
    expect(shownText(result!.text)).toBe('toplow')
    expect(result!.text).toContain("(low) '")
  })

  it('applies the CTM from cm', () => {
    const content = 'q 1 0 0 1 0 -100 cm BT /F1 10 Tf 100 700 Td (Hi) Tj ET Q'
    expect(run(content, [{ x0: 99, y0: 695, x1: 112, y1: 712 }])).toBeNull()
    expect(shownText(run(content, [{ x0: 99, y0: 595, x1: 112, y1: 612 }])!.text)).toBe('')
  })

  it('does not rewrite text in fonts it cannot measure', () => {
    const content = 'BT /F9 10 Tf 100 700 Td (Hello) Tj ET'
    expect(run(content, [{ x0: 0, y0: 0, x1: 612, y1: 792 }])).toBeNull()
  })

  it('stops trusting positions after unmeasured text on the same line', () => {
    const content = 'BT /F9 10 Tf 100 700 Td (xx) Tj /F1 10 Tf (Hello) Tj ET'
    expect(run(content, [{ x0: 0, y0: 0, x1: 612, y1: 792 }])).toBeNull()
  })

  it('handles two-byte codes', () => {
    const fonts: FontLookup = () => ({ bytesPerCode: 2, width: () => 1000 })
    const content = 'BT /F2 10 Tf 100 700 Td <00410042> Tj ET'
    const result = run(content, [{ x0: 108, y0: 695, x1: 120, y1: 712 }], fonts)
    expect(result!.text).toContain('[<0041> -1000] TJ')
  })

  it('keeps inline images and escaped strings intact', () => {
    const content =
      'BI /W 2 /H 1 /BPC 8 /CS /G ID \u0001) EI\nBT /F1 10 Tf 100 700 Td (a\\)b) Tj ET'
    const result = run(content, [{ x0: 104, y0: 695, x1: 109, y1: 712 }])
    expect(result!.text.startsWith('BI /W 2 /H 1 /BPC 8 /CS /G ID \u0001) EI')).toBe(true)
    expect(shownText(result!.text)).toBe('ab')
  })

  it('returns null for malformed content', () => {
    expect(run('BT /F1 10 Tf (unterminated Tj ET', [{ x0: 0, y0: 0, x1: 612, y1: 792 }])).toBeNull()
  })
})
