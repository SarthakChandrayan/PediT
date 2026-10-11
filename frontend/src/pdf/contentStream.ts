/**
 * Removes glyphs from a PDF page content stream.
 *
 * Painting white over edited text hides it, but the old characters stay in
 * the file: they can be selected, searched and copied. This rewrites the text
 * show operators instead. Every glyph whose centre falls inside one of the
 * given regions is replaced by an equal-width TJ adjustment, so nothing else
 * on the line moves. Operators it cannot measure reliably are left untouched;
 * the caller's white cover still hides those.
 *
 * All geometry is PDF user space. Operator semantics follow ISO 32000-1 §9.4.
 */

export type Region = { x0: number; y0: number; x1: number; y1: number }

export type FontMetrics = {
  /** Bytes per character code: 1 for simple fonts, 2 for Identity-H Type0. */
  bytesPerCode: 1 | 2
  /** Advance width of a code in glyph units (1/1000 em). */
  width: (code: number) => number
}

/** Returns metrics for a font resource name, or null when unknown. */
export type FontLookup = (resourceName: string) => FontMetrics | null

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

type PdfString = { kind: 'string'; bytes: Uint8Array }
type PdfName = { kind: 'name'; value: string }
type Value = number | PdfString | PdfName | Value[] | { kind: 'other' }

type Operation = {
  operator: string
  operands: Value[]
  start: number
  end: number
}

/** Result bytes, or null when no glyph was removed. */
export function removeGlyphsInRegions(
  content: Uint8Array,
  regions: readonly Region[],
  fonts: FontLookup,
): { bytes: Uint8Array; removed: number } | null {
  if (regions.length === 0) {
    return null
  }
  const operations = parseOperations(content)
  if (!operations) {
    return null
  }

  const replacements: { start: number; end: number; text: string }[] = []
  let removed = 0

  type State = {
    ctm: Matrix
    tc: number
    tw: number
    th: number
    tl: number
    tfs: number
    trise: number
    font: string | null
  }
  let state: State = { ctm: IDENTITY, tc: 0, tw: 0, th: 1, tl: 0, tfs: 0, trise: 0, font: null }
  const stack: State[] = []
  let tm: Matrix = IDENTITY
  let tlm: Matrix = IDENTITY
  // True after showing text whose advance could not be measured: the current
  // position is unknown until the next absolute or line move.
  let uncertain = false

  const moveLine = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm)
    tm = tlm
    uncertain = false
  }

  const show = (operation: Operation, items: Value[], prefix: string) => {
    const metrics = state.font ? fonts(state.font) : null
    if (!metrics) {
      uncertain = true
      return
    }
    const canRewrite = !uncertain && state.tfs !== 0 && state.th !== 0
    const output: (number | number[])[] = []
    let pendingCodes: number[] = []
    let changed = false
    const flushCodes = () => {
      if (pendingCodes.length > 0) {
        output.push(pendingCodes)
        pendingCodes = []
      }
    }
    const pushNumber = (value: number) => {
      flushCodes()
      const last = output[output.length - 1]
      if (typeof last === 'number') {
        output[output.length - 1] = last + value
      } else {
        output.push(value)
      }
    }

    for (const item of items) {
      if (typeof item === 'number') {
        tm = multiply([1, 0, 0, 1, -(item / 1000) * state.tfs * state.th, 0], tm)
        pushNumber(item)
        continue
      }
      if (!isString(item)) {
        continue
      }
      const codes = splitCodes(item.bytes, metrics.bytesPerCode)
      for (const code of codes) {
        const w = metrics.width(code) / 1000
        const advance =
          (w * state.tfs +
            state.tc +
            (metrics.bytesPerCode === 1 && code === 32 ? state.tw : 0)) *
          state.th
        const render = multiply([state.tfs * state.th, 0, 0, state.tfs, 0, state.trise], multiply(tm, state.ctm))
        const centre = apply(render, w / 2, 0.35)
        if (canRewrite && regions.some((region) => inside(region, centre))) {
          // Same advance, expressed as a TJ adjustment in thousandths of an em.
          pushNumber(-(advance / state.th) * (1000 / state.tfs))
          changed = true
          removed += 1
        } else {
          pendingCodes.push(code)
        }
        tm = multiply([1, 0, 0, 1, advance, 0], tm)
      }
    }
    flushCodes()

    if (changed) {
      const array = output
        .map((entry) =>
          typeof entry === 'number' ? formatNumber(entry) : `<${hexCodes(entry, metrics.bytesPerCode)}>`,
        )
        .join(' ')
      replacements.push({
        start: operation.start,
        end: operation.end,
        text: `${prefix}[${array}] TJ`,
      })
    }
  }

  for (const operation of operations) {
    const { operator, operands } = operation
    const num = (index: number) => {
      const value = operands[index]
      return typeof value === 'number' ? value : 0
    }
    switch (operator) {
      case 'q':
        stack.push({ ...state })
        break
      case 'Q':
        state = stack.pop() ?? state
        break
      case 'cm':
        state = { ...state, ctm: multiply(readMatrix(operands), state.ctm) }
        break
      case 'BT':
        tm = IDENTITY
        tlm = IDENTITY
        uncertain = false
        break
      case 'Tm':
        tlm = readMatrix(operands)
        tm = tlm
        uncertain = false
        break
      case 'Td':
        moveLine(num(0), num(1))
        break
      case 'TD':
        state = { ...state, tl: -num(1) }
        moveLine(num(0), num(1))
        break
      case 'T*':
        moveLine(0, -state.tl)
        break
      case 'Tc':
        state = { ...state, tc: num(0) }
        break
      case 'Tw':
        state = { ...state, tw: num(0) }
        break
      case 'Tz':
        state = { ...state, th: num(0) / 100 }
        break
      case 'TL':
        state = { ...state, tl: num(0) }
        break
      case 'Ts':
        state = { ...state, trise: num(0) }
        break
      case 'Tf': {
        const name = operands[0]
        state = {
          ...state,
          font: isName(name) ? name.value : null,
          tfs: num(1),
        }
        break
      }
      case 'Tj':
        show(operation, [operands[0] ?? { kind: 'other' }], '')
        break
      case 'TJ': {
        const array = operands[0]
        show(operation, Array.isArray(array) ? array : [], '')
        break
      }
      case "'":
        moveLine(0, -state.tl)
        show(operation, [operands[0] ?? { kind: 'other' }], 'T* ')
        break
      case '"': {
        const aw = num(0)
        const ac = num(1)
        state = { ...state, tw: aw, tc: ac }
        moveLine(0, -state.tl)
        show(
          operation,
          [operands[2] ?? { kind: 'other' }],
          `${formatNumber(aw)} Tw ${formatNumber(ac)} Tc T* `,
        )
        break
      }
      default:
        break
    }
  }

  if (replacements.length === 0) {
    return null
  }

  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  let cursor = 0
  for (const replacement of replacements) {
    parts.push(content.subarray(cursor, replacement.start))
    parts.push(encoder.encode(replacement.text))
    cursor = replacement.end
  }
  parts.push(content.subarray(cursor))
  const size = parts.reduce((total, part) => total + part.length, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return { bytes, removed }
}

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32])
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37])

/** Splits content into operations, or returns null on malformed input. */
export function parseOperations(content: Uint8Array): Operation[] | null {
  const operations: Operation[] = []
  let position = 0
  let operands: Value[] = []
  let operandStart = -1
  const length = content.length

  const skipSpace = () => {
    while (position < length) {
      const byte = content[position]!
      if (WHITESPACE.has(byte)) {
        position += 1
      } else if (byte === 37) {
        while (position < length && content[position] !== 10 && content[position] !== 13) {
          position += 1
        }
      } else {
        break
      }
    }
  }

  const readValue = (): Value | string | null => {
    const byte = content[position]!
    if (byte === 40) {
      return readLiteralString()
    }
    if (byte === 60) {
      if (content[position + 1] === 60) {
        return readDictionary()
      }
      return readHexString()
    }
    if (byte === 91) {
      position += 1
      const items: Value[] = []
      for (;;) {
        skipSpace()
        if (position >= length) {
          return null
        }
        if (content[position] === 93) {
          position += 1
          return items
        }
        const item = readValue()
        if (item === null || typeof item === 'string') {
          return null
        }
        items.push(item)
      }
    }
    if (byte === 47) {
      position += 1
      const start = position
      while (position < length && !WHITESPACE.has(content[position]!) && !DELIMITERS.has(content[position]!)) {
        position += 1
      }
      return { kind: 'name', value: decodeName(content.subarray(start, position)) }
    }
    const start = position
    while (position < length && !WHITESPACE.has(content[position]!) && !DELIMITERS.has(content[position]!)) {
      position += 1
    }
    if (position === start) {
      // A stray delimiter such as ')' or '}'.
      return null
    }
    const word = latin1(content.subarray(start, position))
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      return Number(word)
    }
    if (word === 'true' || word === 'false' || word === 'null') {
      return { kind: 'other' }
    }
    return word
  }

  const readLiteralString = (): PdfString | null => {
    position += 1
    const bytes: number[] = []
    let depth = 1
    while (position < length) {
      const byte = content[position]!
      position += 1
      if (byte === 92) {
        const next = content[position]
        if (next === undefined) {
          return null
        }
        position += 1
        const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 }
        if (escapes[next] !== undefined) {
          bytes.push(escapes[next]!)
        } else if (next >= 48 && next <= 55) {
          let value = next - 48
          for (let count = 0; count < 2; count += 1) {
            const digit = content[position]
            if (digit === undefined || digit < 48 || digit > 55) {
              break
            }
            value = value * 8 + (digit - 48)
            position += 1
          }
          bytes.push(value & 0xff)
        } else if (next === 13) {
          if (content[position] === 10) {
            position += 1
          }
        } else if (next !== 10) {
          bytes.push(next)
        }
        continue
      }
      if (byte === 40) {
        depth += 1
      } else if (byte === 41) {
        depth -= 1
        if (depth === 0) {
          return { kind: 'string', bytes: Uint8Array.from(bytes) }
        }
      }
      bytes.push(byte)
    }
    return null
  }

  const readHexString = (): PdfString | null => {
    position += 1
    let digits = ''
    while (position < length && content[position] !== 62) {
      const byte = content[position]!
      if (!WHITESPACE.has(byte)) {
        digits += String.fromCharCode(byte)
      }
      position += 1
    }
    if (position >= length) {
      return null
    }
    position += 1
    if (!/^[0-9a-fA-F]*$/.test(digits)) {
      return null
    }
    if (digits.length % 2 === 1) {
      digits += '0'
    }
    const bytes = new Uint8Array(digits.length / 2)
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = parseInt(digits.slice(index * 2, index * 2 + 2), 16)
    }
    return { kind: 'string', bytes }
  }

  const readDictionary = (): Value | null => {
    position += 2
    for (;;) {
      skipSpace()
      if (position >= length) {
        return null
      }
      if (content[position] === 62 && content[position + 1] === 62) {
        position += 2
        return { kind: 'other' }
      }
      const item = readValue()
      if (item === null || typeof item === 'string') {
        return null
      }
    }
  }

  for (;;) {
    skipSpace()
    if (position >= length) {
      break
    }
    const tokenStart = position
    const value = readValue()
    if (value === null) {
      return null
    }
    if (typeof value === 'string') {
      if (value === 'BI') {
        // Inline image: dictionary, ID, raw data, EI. Kept verbatim.
        const end = findInlineImageEnd(content, position)
        if (end < 0) {
          return null
        }
        operations.push({ operator: 'BI', operands: [], start: tokenStart, end })
        position = end
        operands = []
        operandStart = -1
        continue
      }
      operations.push({
        operator: value,
        operands,
        start: operandStart >= 0 ? operandStart : tokenStart,
        end: position,
      })
      operands = []
      operandStart = -1
      continue
    }
    if (operandStart < 0) {
      operandStart = tokenStart
    }
    operands.push(value)
  }
  return operations
}

function findInlineImageEnd(content: Uint8Array, from: number): number {
  // Find "ID" followed by one whitespace byte, then the data, then "EI".
  let position = from
  while (position + 1 < content.length) {
    if (
      content[position] === 73 &&
      content[position + 1] === 68 &&
      WHITESPACE.has(content[position - 1] ?? 32) &&
      WHITESPACE.has(content[position + 2] ?? 32)
    ) {
      position += 3
      break
    }
    position += 1
  }
  while (position + 1 < content.length) {
    if (
      content[position] === 69 &&
      content[position + 1] === 73 &&
      WHITESPACE.has(content[position - 1] ?? 32) &&
      (position + 2 >= content.length || WHITESPACE.has(content[position + 2]!))
    ) {
      return position + 2
    }
    position += 1
  }
  return -1
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isString(value: Value | undefined): value is PdfString {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'string'
}

function isName(value: Value | undefined): value is PdfName {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'name'
}

function readMatrix(operands: Value[]): Matrix {
  const values = operands.slice(0, 6).map((value) => (typeof value === 'number' ? value : 0))
  while (values.length < 6) {
    values.push(0)
  }
  return values as Matrix
}

/** a × b in PDF's row-vector convention: apply a, then b. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

function inside(region: Region, point: { x: number; y: number }): boolean {
  return point.x >= region.x0 && point.x <= region.x1 && point.y >= region.y0 && point.y <= region.y1
}

function splitCodes(bytes: Uint8Array, bytesPerCode: 1 | 2): number[] {
  const codes: number[] = []
  if (bytesPerCode === 1) {
    bytes.forEach((byte) => codes.push(byte))
    return codes
  }
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    codes.push((bytes[index]! << 8) | bytes[index + 1]!)
  }
  return codes
}

function hexCodes(codes: number[], bytesPerCode: 1 | 2): string {
  return codes.map((code) => code.toString(16).padStart(bytesPerCode * 2, '0')).join('')
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  const fixed = value.toFixed(3)
  return fixed.replace(/\.?0+$/, '') || '0'
}

function latin1(bytes: Uint8Array): string {
  let text = ''
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte)
  })
  return text
}

function decodeName(bytes: Uint8Array): string {
  return latin1(bytes).replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
}
