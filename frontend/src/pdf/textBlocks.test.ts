import { describe, expect, it } from 'vitest'
import {
  groupTextBlocks,
  wrapParagraphText,
  wrapStyledText,
  type BlockRunInput,
} from './textBlocks.ts'

let counter = 0
function run(str: string, x: number, baseline: number, width: number, fontSize = 12): BlockRunInput {
  counter += 1
  return { id: `r${counter}`, str, x, baseline, width, fontSize }
}

describe('groupTextBlocks', () => {
  it('joins runs on one baseline into a line, adding spaces at word gaps', () => {
    const blocks = groupTextBlocks([
      run('Amount', 72, 700, 40),
      run('due', 116, 700, 20),
      run('today', 139, 700, 30),
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe('Amount due today')
  })

  it('adds a space after a label even when the measured gap is tiny', () => {
    const blocks = groupTextBlocks([run('Tools:', 72, 700, 36), run('AWS, Git', 108.6, 700, 50)])
    expect(blocks[0]!.text).toBe('Tools: AWS, Git')
  })

  it('does not split a decimal number', () => {
    const blocks = groupTextBlocks([run('3.', 72, 700, 9), run('14', 81.5, 700, 12)])
    expect(blocks[0]!.text).toBe('3.14')
  })

  it('does not insert a space between touching fragments of one word', () => {
    const blocks = groupTextBlocks([run('Inv', 72, 700, 18), run('oice', 90, 700, 24)])
    expect(blocks[0]!.text).toBe('Invoice')
  })

  it('merges wrapped lines of a paragraph and joins soft wraps with a space', () => {
    const blocks = groupTextBlocks([
      run('The quick brown fox jumps over', 72, 700, 300),
      run('the lazy dog and keeps running', 72, 686, 298),
      run('until the end.', 72, 672, 90),
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe(
      'The quick brown fox jumps over the lazy dog and keeps running until the end.',
    )
    expect(blocks[0]!.lineHeight).toBeCloseTo(14)
  })

  it('keeps a hard break after a short line', () => {
    const blocks = groupTextBlocks([
      run('Dear Sam,', 72, 700, 60),
      run('Thanks for the quick turnaround on the contract draft.', 72, 686, 300),
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe('Dear Sam,\nThanks for the quick turnaround on the contract draft.')
  })

  it('separates a heading from body text by font size', () => {
    const blocks = groupTextBlocks([
      run('Invoice', 72, 720, 110, 28),
      run('Amount due today', 72, 690, 130, 16),
    ])
    expect(blocks.map((block) => block.text)).toEqual(['Invoice', 'Amount due today'])
  })

  it('separates paragraphs with a larger gap between them', () => {
    const blocks = groupTextBlocks([
      run('First paragraph line one continues', 72, 700, 300),
      run('and finishes on line two right here.', 72, 686, 300),
      run('Second paragraph starts after a gap', 72, 650, 300),
    ])
    expect(blocks).toHaveLength(2)
  })

  it('splits side-by-side columns', () => {
    const blocks = groupTextBlocks([run('Left column', 72, 700, 80), run('Right column', 320, 700, 80)])
    expect(blocks.map((block) => block.text)).toEqual(['Left column', 'Right column'])
  })

  it('records where each run starts in the paragraph text', () => {
    const first = run('Hello', 72, 700, 30)
    const second = run('world', 108, 700, 30)
    const [block] = groupTextBlocks([first, second])
    expect(block!.runOffsets[first.id]).toBe(0)
    expect(block!.runOffsets[second.id]).toBe(6)
  })

  it('starts a new paragraph when the font changes between lines', () => {
    const heading = { ...run('Deliverables:', 72, 700, 80), fontKey: 'bold' }
    const item = { ...run('• Monthly status report', 72, 686, 140), fontKey: 'regular' }
    expect(groupTextBlocks([heading, item]).map((block) => block.text)).toEqual([
      'Deliverables:',
      '• Monthly status report',
    ])
  })

  it('breaks the line when a full line is followed by one starting in another style', () => {
    // A "Label: values" list where every line starts with a bold label.
    const runs = [
      { ...run('AI:', 72, 700, 18), fontKey: 'bold' },
      { ...run('LangChain, Retrieval-Augmented Generation, Vector Embeddings', 93, 700, 300), fontKey: 'regular' },
      { ...run('Cloud:', 72, 686, 36), fontKey: 'bold' },
      { ...run('AWS, Git, Postman, Jira, Figma, Mixpanel, Vercel', 111, 686, 250), fontKey: 'regular' },
    ]
    const [block] = groupTextBlocks(runs)
    expect(block!.text).toBe(
      'AI: LangChain, Retrieval-Augmented Generation, Vector Embeddings\nCloud: AWS, Git, Postman, Jira, Figma, Mixpanel, Vercel',
    )
  })

  it('splits the paragraph text by source run', () => {
    const label = { ...run('Languages:', 72, 700, 60), fontKey: 'bold' }
    const value = { ...run('TypeScript, Python', 135, 700, 100), fontKey: 'regular' }
    const [block] = groupTextBlocks([label, value])
    expect(block!.segments).toEqual([
      { runId: label.id, text: 'Languages: ' },
      { runId: value.id, text: 'TypeScript, Python' },
    ])
    expect(block!.segments.map((segment) => segment.text).join('')).toBe(block!.text)
  })

  it('keeps list items on their own lines', () => {
    const blocks = groupTextBlocks([
      run('• Fast delivery on all orders placed', 72, 700, 300),
      run('• Free returns within thirty days', 72, 686, 300),
    ])
    expect(blocks[0]!.text).toBe('• Fast delivery on all orders placed\n• Free returns within thirty days')
  })
})

describe('wrapStyledText', () => {
  it('wraps across styles and keeps each piece in its style', () => {
    // Bold glyphs are twice as wide.
    const measure = (text: string, style: number) => text.length * (style === 1 ? 2 : 1)
    const lines = wrapStyledText(
      [
        { text: 'Lang: ', style: 1 },
        { text: 'ts js py', style: 0 },
      ],
      14,
      0,
      measure,
    )
    expect(lines).toEqual([
      [
        { text: 'Lang: ', style: 1 },
        { text: 'ts', style: 0 },
      ],
      [{ text: 'js py', style: 0 }],
    ])
  })
})

describe('wrapParagraphText', () => {
  const measure = (value: string) => value.length

  it('wraps words greedily to the width', () => {
    expect(wrapParagraphText('aaa bbb ccc ddd', 7, 0, measure)).toEqual(['aaa bbb', 'ccc ddd'])
  })

  it('keeps explicit line breaks', () => {
    expect(wrapParagraphText('one\ntwo', 20, 0, measure)).toEqual(['one', 'two'])
  })

  it('applies the first-line indent', () => {
    expect(wrapParagraphText('aaa bbb', 7, 2, measure)).toEqual(['aaa', 'bbb'])
  })

  it('splits a word longer than the line, even after other words', () => {
    expect(wrapParagraphText('ab cdefghij', 4, 0, measure)).toEqual(['ab', 'cdef', 'ghij'])
  })
})
