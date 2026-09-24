import { clipPdfRect, type HighlightRunRecord, type SelectedTextPiece } from './highlights.ts'

/**
 * Reads the browser selection inside the viewer and maps it onto PDF.js text runs.
 *
 * A run is included when the selection intersects it. For ordinary left-to-right
 * lines, a partial selection is the same fraction of that run's PDF glyph box.
 * The fraction comes from the selection's position inside the run, whose width
 * is the PDF advance. Rotated runs and failed measurements use the whole run.
 */
export function collectSelectedPieces(
  root: HTMLElement,
  runs: ReadonlyMap<string, HighlightRunRecord>,
): SelectedTextPiece[] {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return []
  }

  const anchor = selection.anchorNode
  if (!anchor || !root.contains(anchor)) {
    return []
  }

  const range = selection.getRangeAt(0)
  const pieces: SelectedTextPiece[] = []
  for (const node of root.querySelectorAll<HTMLElement>('[data-text-run]')) {
    const id = node.dataset.textRun
    if (!id) {
      continue
    }
    const record = runs.get(id)
    if (!record) {
      continue
    }
    if (!intersects(range, node)) {
      continue
    }

    const glyphs = node.querySelector<HTMLElement>('.text-layer__glyphs')
    const selected = glyphs ? textInside(range, glyphs) : ''
    const text = selected.length > 0 ? selected : record.text
    if (text.length === 0) {
      continue
    }

    const pdfRect =
      record.subdivide && glyphs && selected.length > 0 && selected !== record.text
        ? partialRect(range, node, glyphs, record) ?? record.pdfRect
        : record.pdfRect
    if (pdfRect.width <= 0 || pdfRect.height <= 0) {
      continue
    }

    pieces.push({
      pageNumber: record.pageNumber,
      text,
      hasEOL: record.hasEOL,
      pdfRect,
    })
  }
  return pieces
}

function partialRect(
  range: Range,
  host: HTMLElement,
  glyphs: HTMLElement,
  record: HighlightRunRecord,
): SelectedTextPiece['pdfRect'] | null {
  const slice = sliceTo(range, glyphs)
  if (!slice) {
    return null
  }
  const selected = slice.getBoundingClientRect()
  const box = host.getBoundingClientRect()
  if (box.width < 1 || selected.width < 0.5) {
    return null
  }
  const left = (selected.left - box.left) / box.width
  const width = selected.width / box.width
  if (left < -0.05 || left > 1.05 || width <= 0) {
    return null
  }
  if (width >= 0.98 && left <= 0.02) {
    return record.pdfRect
  }
  return clipPdfRect(record.pdfRect, left, width)
}

function textInside(range: Range, glyphs: HTMLElement): string {
  const slice = sliceTo(range, glyphs)
  return slice ? slice.toString() : ''
}

function sliceTo(range: Range, node: Node): Range | null {
  try {
    if (!range.intersectsNode(node)) {
      return null
    }
    const nodeRange = document.createRange()
    nodeRange.selectNodeContents(node)
    const slice = range.cloneRange()
    if (slice.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) {
      slice.setStart(nodeRange.startContainer, nodeRange.startOffset)
    }
    if (slice.compareBoundaryPoints(Range.END_TO_END, nodeRange) > 0) {
      slice.setEnd(nodeRange.endContainer, nodeRange.endOffset)
    }
    return slice
  } catch {
    return null
  }
}

function intersects(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}
