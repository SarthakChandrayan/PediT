/**
 * Groups horizontal PDF text runs into paragraphs ("blocks") so text can be
 * edited the way a word processor edits it: one wrapping box per paragraph
 * instead of one fixed-width box per run.
 *
 * PDFs have no paragraph structure; this infers it from geometry. All values
 * are PDF user space: x grows right, y (baselines) grows up.
 */

export type BlockRunInput = {
  id: string
  str: string
  /** Baseline start, PDF user space. */
  x: number
  baseline: number
  /** Advance width along the baseline. */
  width: number
  /** Em size. */
  fontSize: number
  /** Font identity; a line in a different font starts a new paragraph. */
  fontKey?: string
}

export type TextBlockLine = {
  runIds: string[]
  left: number
  right: number
  baseline: number
  text: string
}

export type TextBlock = {
  /** Stable for a page: derived from the first run. */
  id: string
  runIds: string[]
  /** Paragraph text. Soft wraps become spaces; likely hard breaks stay "\n". */
  text: string
  /** Where each run's first character sits in `text`. */
  runOffsets: Record<string, number>
  /**
   * `text` split by source run, in order; joined they equal `text`. Spaces and
   * line breaks added between runs belong to the run before them.
   */
  segments: { runId: string; text: string }[]
  lines: TextBlockLine[]
  left: number
  width: number
  firstBaseline: number
  lastBaseline: number
  /** Baseline-to-baseline distance. */
  lineHeight: number
  fontSize: number
  /** First-line indent relative to `left`, never negative. */
  indent: number
}

/** Wrap width multiplier so text that filled the original line still fits. */
export const BLOCK_WRAP_SLACK = 1.015

/** Same baseline when closer than this fraction of the em size. */
const BASELINE_TOLERANCE = 0.3
/** A gap wider than this many ems splits a line into separate columns. */
const COLUMN_GAP = 2.5
/** Gap, in ems, above which neighbouring runs are joined with a space. */
const WORD_GAP = 0.18
/** Line spacing, in ems, that still reads as the same paragraph. */
const MIN_LEADING = 0.85
const MAX_LEADING = 1.9

export function groupTextBlocks(runs: readonly BlockRunInput[]): TextBlock[] {
  const usable = runs.filter(
    (run) =>
      run.str.length > 0 &&
      Number.isFinite(run.x) &&
      Number.isFinite(run.baseline) &&
      run.fontSize > 0 &&
      run.width >= 0,
  )
  const lines = buildLines(usable)
  return buildBlocks(lines, usable)
}

type WorkingLine = TextBlockLine & {
  fontSize: number
  fontKey: string | undefined
  runs: BlockRunInput[]
}

function buildLines(runs: readonly BlockRunInput[]): WorkingLine[] {
  const sorted = [...runs].sort((a, b) => b.baseline - a.baseline || a.x - b.x)
  const rows: BlockRunInput[][] = []
  for (const run of sorted) {
    const row = rows[rows.length - 1]
    const anchor = row?.[0]
    if (
      row &&
      anchor &&
      Math.abs(anchor.baseline - run.baseline) <= BASELINE_TOLERANCE * Math.max(anchor.fontSize, run.fontSize) &&
      similarSize(anchor.fontSize, run.fontSize, 0.3)
    ) {
      row.push(run)
    } else {
      rows.push([run])
    }
  }

  const lines: WorkingLine[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let current: BlockRunInput[] = []
    const flush = () => {
      if (current.length > 0) {
        lines.push(makeLine(current))
      }
      current = []
    }
    for (const run of row) {
      const previous = current[current.length - 1]
      if (previous) {
        const gap = run.x - (previous.x + previous.width)
        if (gap > COLUMN_GAP * Math.max(previous.fontSize, run.fontSize)) {
          flush()
        }
      }
      current.push(run)
    }
    flush()
  }
  return lines
}

function makeLine(runs: BlockRunInput[]): WorkingLine {
  let text = ''
  let right = Number.NEGATIVE_INFINITY
  let previous: BlockRunInput | null = null
  for (const run of runs) {
    if (previous && needsSpace(previous, run, text)) {
      text += ' '
    }
    text += run.str
    right = Math.max(right, run.x + run.width)
    previous = run
  }
  const first = runs[0]!
  return {
    runIds: runs.map((run) => run.id),
    runs,
    left: first.x,
    right,
    baseline: median(runs.map((run) => run.baseline)),
    fontSize: median(runs.map((run) => run.fontSize)),
    fontKey: first.fontKey,
    text: text.replace(/\s+$/, ''),
  }
}

function needsSpace(previous: BlockRunInput, next: BlockRunInput, soFar: string): boolean {
  if (/\s$/.test(soFar) || /^\s/.test(next.str)) {
    return false
  }
  const gap = next.x - (previous.x + previous.width)
  const em = Math.max(previous.fontSize, next.fontSize)
  if (gap > WORD_GAP * em) {
    return true
  }
  // "Tools:" then "AWS": run widths are often measured a little wide, so after
  // punctuation even a small gap before a letter is a word space.
  if (!(gap > 0.02 * em)) {
    return false
  }
  if (/\.$/.test(previous.str)) {
    // "3." + "14" is a number; "end." + "Next" is a new sentence.
    return /^\p{L}/u.test(next.str)
  }
  return /[:;,!?)\]]$/.test(previous.str) && /^[\p{L}\p{N}(]/u.test(next.str)
}

function buildBlocks(lines: WorkingLine[], runs: readonly BlockRunInput[]): TextBlock[] {
  const order = new Map(runs.map((run, index) => [run.id, index]))
  const groups: WorkingLine[][] = []

  for (const line of lines) {
    let target: WorkingLine[] | null = null
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index]!
      if (continuesParagraph(group, line)) {
        target = group
        break
      }
    }
    if (target) {
      target.push(line)
    } else {
      groups.push([line])
    }
  }

  const blocks = groups.map((group) => toBlock(group))
  // Keep reading order stable: by the content-stream position of the first run.
  return blocks.sort(
    (a, b) => (order.get(a.runIds[0]!) ?? 0) - (order.get(b.runIds[0]!) ?? 0),
  )
}

function continuesParagraph(group: WorkingLine[], line: WorkingLine): boolean {
  const last = group[group.length - 1]!
  const size = last.fontSize
  if (!similarSize(size, line.fontSize, 0.12) || line.fontKey !== last.fontKey) {
    return false
  }
  const leading = last.baseline - line.baseline
  if (leading < MIN_LEADING * size || leading > MAX_LEADING * size) {
    return false
  }
  if (group.length >= 2) {
    const previous = group[group.length - 2]!
    const established = previous.baseline - last.baseline
    if (Math.abs(leading - established) > 0.2 * size) {
      return false
    }
  }
  const left = Math.min(...group.slice(group.length > 1 ? 1 : 0).map((item) => item.left))
  const right = Math.max(...group.map((item) => item.right))
  // Same column: aligned left edge (allowing a first-line indent) and overlap.
  const aligned =
    Math.abs(line.left - left) <= 1.5 * size ||
    (group.length === 1 && line.left < last.left && last.left - line.left <= 4 * size)
  return aligned && line.left < right && line.right > left
}

function toBlock(group: WorkingLine[]): TextBlock {
  const left = Math.min(...group.map((line) => line.left))
  const right = Math.max(...group.map((line) => line.right))
  const width = Math.max(right - left, 1)
  const first = group[0]!
  const last = group[group.length - 1]!
  const fontSize = median(group.map((line) => line.fontSize))
  const lineHeight =
    group.length > 1 ? (first.baseline - last.baseline) / (group.length - 1) : fontSize * 1.2

  let text = ''
  const runOffsets: Record<string, number> = {}
  const segments: { runId: string; text: string }[] = []
  const append = (value: string) => {
    text += value
    const last = segments[segments.length - 1]
    if (last) {
      last.text += value
    }
  }
  group.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      append(lineBreak(group[lineIndex - 1]!, line, right, width, fontSize, text))
    }
    let previous: BlockRunInput | null = null
    for (const run of line.runs) {
      if (previous && needsSpace(previous, run, text)) {
        append(' ')
      }
      runOffsets[run.id] = text.length
      text += run.str
      segments.push({ runId: run.id, text: run.str })
      previous = run
    }
    // Drop trailing spaces at the end of the line from both views.
    const trimmed = text.replace(/[ \t]+$/, '')
    let excess = text.length - trimmed.length
    text = trimmed
    for (let index = segments.length - 1; index >= 0 && excess > 0; index -= 1) {
      const segment = segments[index]!
      const cut = Math.min(excess, segment.text.length)
      segment.text = segment.text.slice(0, segment.text.length - cut)
      excess -= cut
    }
  })

  return {
    id: `block:${first.runIds[0]}`,
    runIds: group.flatMap((line) => line.runIds),
    text,
    runOffsets,
    segments: segments.filter((segment) => segment.text.length > 0),
    lines: group.map(({ runIds, left: l, right: r, baseline, text: t }) => ({
      runIds,
      left: l,
      right: r,
      baseline,
      text: t,
    })),
    left,
    width,
    firstBaseline: first.baseline,
    lastBaseline: last.baseline,
    lineHeight,
    fontSize,
    indent: Math.max(0, first.left - left),
  }
}

/**
 * A line that stops well short of the paragraph's right edge, ends with a
 * colon, or is followed by a list marker is a real line break. Anything else
 * is a soft wrap and becomes a space, so edited text can reflow.
 */
function lineBreak(
  previous: WorkingLine,
  next: WorkingLine,
  right: number,
  width: number,
  fontSize: number,
  soFar: string,
): string {
  const short = right - previous.right > Math.max(3 * fontSize, 0.18 * width)
  const listItem = /^\s*([•\-–·*]|\d+[.)]|[a-z][.)])\s/i.test(next.text)
  // A wrapped line continues in the style it ended in. A line that starts in
  // another style ("Label:" in bold after regular text) is a new line.
  const endFont = previous.runs[previous.runs.length - 1]?.fontKey
  const startFont = next.runs[0]?.fontKey
  const styleChange = endFont !== undefined && startFont !== undefined && endFont !== startFont
  if (short || styleChange || /:\s*$/.test(previous.text) || listItem) {
    return '\n'
  }
  if (/-$/.test(soFar)) {
    return ''
  }
  return ' '
}

function similarSize(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(a, b)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** A run of text in one style; `style` indexes the block's style list. */
export type StyledPiece = { text: string; style: number }

/**
 * Greedy word wrap for styled text. `measure` returns the advance width of a
 * string in a style, in the same units as `width`. Explicit "\n" always
 * breaks; a word longer than the line is split by characters.
 */
export function wrapStyledText(
  pieces: readonly StyledPiece[],
  width: number,
  firstLineIndent: number,
  measure: (text: string, style: number) => number,
): StyledPiece[][] {
  type Char = { char: string; style: number }
  const chars: Char[] = []
  for (const piece of pieces) {
    for (const char of piece.text) {
      chars.push({ char: char === '\r' ? '\n' : char, style: piece.style })
    }
  }

  const lines: Char[][] = []
  const available = () => width - (lines.length === 0 ? firstLineIndent : 0)
  const widthOf = (items: readonly Char[]) => measureChars(items, measure)

  let paragraph: Char[] = []
  const paragraphs: Char[][] = []
  for (const item of chars) {
    if (item.char === '\n') {
      paragraphs.push(paragraph)
      paragraph = []
    } else {
      paragraph.push(item)
    }
  }
  paragraphs.push(paragraph)

  for (const items of paragraphs) {
    // Words keep the space before them so a line can drop it when wrapping.
    const words: { space: Char[]; word: Char[] }[] = []
    let space: Char[] = []
    let word: Char[] = []
    for (const item of items) {
      if (item.char === ' ') {
        if (word.length > 0) {
          words.push({ space, word })
          space = []
          word = []
        }
        space.push(item)
      } else {
        word.push(item)
      }
    }
    if (word.length > 0 || words.length === 0) {
      words.push({ space, word })
    }

    let current: Char[] = []
    for (const entry of words) {
      if (current.length > 0) {
        const candidate = [...current, ...entry.space, ...entry.word]
        if (widthOf(candidate) <= available()) {
          current = candidate
          continue
        }
        lines.push(current)
        current = []
      }
      // Leading spaces only survive at the start of a paragraph.
      const lead = current.length === 0 && entry === words[0] ? entry.space : []
      const start = [...lead, ...entry.word]
      if (widthOf(start) <= available() || entry.word.length <= 1) {
        current = start
        continue
      }
      // Split an over-long word so it never runs past the paragraph edge.
      for (const item of start) {
        if (current.length > 0 && widthOf([...current, item]) > available()) {
          lines.push(current)
          current = []
        }
        current.push(item)
      }
    }
    lines.push(current)
  }

  return lines.map((line) => mergePieces(line))
}

function measureChars(
  items: readonly { char: string; style: number }[],
  measure: (text: string, style: number) => number,
): number {
  return mergePieces(items).reduce((total, piece) => total + measure(piece.text, piece.style), 0)
}

function mergePieces(items: readonly { char: string; style: number }[]): StyledPiece[] {
  const merged: StyledPiece[] = []
  for (const item of items) {
    const last = merged[merged.length - 1]
    if (last && last.style === item.style) {
      last.text += item.char
    } else {
      merged.push({ text: item.char, style: item.style })
    }
  }
  return merged
}

/** Plain-text form of `wrapStyledText`. */
export function wrapParagraphText(
  text: string,
  width: number,
  firstLineIndent: number,
  measure: (value: string) => number,
): string[] {
  return wrapStyledText([{ text, style: 0 }], width, firstLineIndent, (value) => measure(value)).map(
    (line) => line.map((piece) => piece.text).join(''),
  )
}
