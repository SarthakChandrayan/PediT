import type { PDFPageProxy } from 'pdfjs-dist'
import {
  layoutTextItem,
  pdfRectForRunSpan,
  type LaidOutTextItem,
  type PdfRect,
} from './coordinates.ts'
import type { PDFDocumentProxy } from './pdfjs.ts'
import { textRunId, type TextEdit } from './textEdits.ts'

/**
 * Document search is viewer state. It is not a PDF annotation.
 *
 * Matches use PDF user space. Screen position is derived from the viewport
 * only when a highlight is painted. Closing search drops every match.
 *
 * Extracted page text is cached by the caller for one loaded PDF. Text edits
 * are applied on top of that cache: a committed edit or an open draft replaces
 * the run's searchable string, and character spans stay on the original run's
 * PDF advance (the editor draws the replacement inside that box). The PDF
 * bytes are never rewritten. `getTextContent()` is not called again for a
 * keystroke, a case toggle, or a text edit.
 *
 * Limitations:
 * - Character edges assume equal width along the run advance.
 * - Runs are concatenated in PDF.js order. A line break (`hasEOL`) blocks a
 *   match from crossing it. A space is included only when PDF.js extracted one.
 * - Right-to-left reordering and uneven glyph advances can place a span on the
 *   run's advance rather than on each glyph's true outline.
 * - Vertical text is subdivided along its advance. A transform that collapses
 *   the span to zero area drops that rectangle instead of inventing one.
 */

export type SearchMatch = {
  index: number
  pageNumber: number
  text: string
  pdfRects: PdfRect[]
}

export type SearchModel = {
  open: boolean
  query: string
  caseSensitive: boolean
  currentMatchIndex: number
}

export type SearchRun = {
  id: string
  pageNumber: number
  text: string
  hasEOL: boolean
  laidOut: LaidOutTextItem
}

export type SearchPage = {
  pageNumber: number
  runs: SearchRun[]
}

export type VisibleTextEdit = {
  id: string
  editedText: string
}

export type LiveSearchEdit = {
  id: string
  text: string
}

type TextItem = {
  str: string
  dir: string
  transform: number[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

type CharOwner = {
  run: SearchRun
  charIndex: number
} | null

export function createSearchModel(): SearchModel {
  return {
    open: false,
    query: '',
    caseSensitive: false,
    currentMatchIndex: -1,
  }
}

export function openSearch(model: SearchModel): SearchModel {
  return model.open ? model : { ...model, open: true }
}

/** Drops the query, matches, and current hit. The PDF is unchanged. */
export function clearSearch(model: SearchModel): SearchModel {
  if (!model.open && model.query === '' && model.currentMatchIndex === -1) {
    return model
  }
  return createSearchModel()
}

export function setSearchQuery(model: SearchModel, query: string): SearchModel {
  if (model.query === query && model.open) {
    return model
  }
  return {
    ...model,
    open: true,
    query,
    currentMatchIndex: query.length === 0 ? -1 : 0,
  }
}

export function setSearchCaseSensitive(model: SearchModel, caseSensitive: boolean): SearchModel {
  if (model.caseSensitive === caseSensitive) {
    return model
  }
  return {
    ...model,
    caseSensitive,
    currentMatchIndex: model.query.length === 0 ? -1 : 0,
  }
}

export function stepMatchIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) {
    return -1
  }
  const base = current < 0 ? (direction > 0 ? -1 : 0) : current
  return (base + direction + count) % count
}

export function stepSearch(model: SearchModel, count: number, direction: 1 | -1): SearchModel {
  const next = stepMatchIndex(model.currentMatchIndex, count, direction)
  if (next === model.currentMatchIndex) {
    return model
  }
  return { ...model, currentMatchIndex: next }
}

export function selectSearchMatch(model: SearchModel, index: number, count: number): SearchModel {
  if (count <= 0 || index < 0 || index >= count) {
    return model
  }
  if (model.currentMatchIndex === index) {
    return model
  }
  return { ...model, open: true, currentMatchIndex: index }
}

/** A new document or version starts with an empty search. */
export function searchModelForDocument(model: SearchModel, sameDocument: boolean): SearchModel {
  return sameDocument ? model : createSearchModel()
}

export function clampMatchIndex(index: number, count: number): number {
  if (count <= 0) {
    return -1
  }
  if (index < 0) {
    return 0
  }
  return Math.min(index, count - 1)
}

export function searchHitsForPage(
  open: boolean,
  matches: readonly SearchMatch[],
  pageNumber: number,
): readonly SearchMatch[] {
  if (!open) {
    return []
  }
  return matches.filter((match) => match.pageNumber === pageNumber && match.pdfRects.length > 0)
}

/**
 * Replaces cached PDF.js strings with the text the viewer is showing.
 * Geometry stays on the original run. An empty replacement removes the run
 * from search so the covered original word is not found.
 */
export function applyVisibleText(
  pages: readonly SearchPage[],
  edits: readonly VisibleTextEdit[],
  live: LiveSearchEdit | null,
): SearchPage[] {
  if (edits.length === 0 && !live) {
    return pages as SearchPage[]
  }
  const visible = new Map<string, string>()
  for (const edit of edits) {
    visible.set(edit.id, edit.editedText)
  }
  if (live) {
    visible.set(live.id, live.text)
  }
  return pages.map((page) => ({
    pageNumber: page.pageNumber,
    runs: page.runs.flatMap((run) => {
      const next = visible.get(run.id)
      if (next === undefined) {
        return [run]
      }
      if (next.length === 0) {
        return []
      }
      if (next === run.text) {
        return [run]
      }
      return [{ ...run, text: next }]
    }),
  }))
}

export function findTextMatches(
  pages: readonly SearchPage[],
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  if (query.length === 0) {
    return []
  }
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: SearchMatch[] = []
  for (const page of pages) {
    const indexed = indexPage(page)
    const haystack = caseSensitive ? indexed.text : indexed.text.toLowerCase()
    let from = 0
    while (from <= haystack.length - needle.length) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) {
        break
      }
      const pdfRects = rectsForRange(indexed.owners, at, at + needle.length)
      if (pdfRects.length > 0) {
        matches.push({
          index: matches.length,
          pageNumber: page.pageNumber,
          text: indexed.text.slice(at, at + query.length),
          pdfRects,
        })
      }
      from = at + needle.length
    }
  }
  return matches
}

export async function extractSearchDocument(pdf: PDFDocumentProxy): Promise<SearchPage[]> {
  const pages: SearchPage[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    pages.push(await extractSearchPage(page, pageNumber))
  }
  return pages
}

export async function extractSearchPage(
  page: PDFPageProxy,
  pageNumber: number,
): Promise<SearchPage> {
  const viewport = page.getViewport({ scale: 1 })
  const textContent = await page.getTextContent()
  const runs: SearchRun[] = []
  textContent.items.forEach((item, index) => {
    if (!isTextItem(item) || item.str.length === 0) {
      return
    }
    const style = textContent.styles[item.fontName]
    const laidOut = layoutTextItem(viewport, item, {
      ascent: style?.ascent,
      descent: style?.descent,
      vertical: style?.vertical,
      fontFamily: style?.fontFamily,
    })
    if (!laidOut) {
      return
    }
    runs.push({
      id: textRunId(pageNumber, index),
      pageNumber,
      text: item.str,
      hasEOL: item.hasEOL === true,
      laidOut,
    })
  })
  return { pageNumber, runs }
}

export function editsAsVisible(edits: readonly TextEdit[]): VisibleTextEdit[] {
  return edits.map((edit) => ({ id: edit.id, editedText: edit.editedText }))
}

type FindKeyEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Ctrl+F / Cmd+F without Shift or Alt. Undo and redo shortcuts are not find. */
export function isFindShortcut(event: FindKeyEvent): boolean {
  if (event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) {
    return false
  }
  return event.key.toLowerCase() === 'f'
}

export function shouldCloseSearchOnEscape(
  event: { key: string; defaultPrevented: boolean },
  searchOpen: boolean,
  target: EventTarget | null,
): boolean {
  if (!searchOpen || event.key !== 'Escape' || event.defaultPrevented) {
    return false
  }
  return !(target instanceof HTMLTextAreaElement)
}

function indexPage(page: SearchPage): { text: string; owners: CharOwner[] } {
  let text = ''
  const owners: CharOwner[] = []
  for (const run of page.runs) {
    for (let charIndex = 0; charIndex < run.text.length; charIndex += 1) {
      text += run.text[charIndex] ?? ''
      owners.push({ run, charIndex })
    }
    if (run.hasEOL) {
      text += '\n'
      owners.push(null)
    }
  }
  return { text, owners }
}

function rectsForRange(owners: readonly CharOwner[], start: number, end: number): PdfRect[] {
  const groups: { run: SearchRun; start: number; end: number }[] = []
  for (let index = start; index < end; index += 1) {
    const owner = owners[index]
    if (!owner) {
      continue
    }
    const last = groups[groups.length - 1]
    if (last && last.run === owner.run && last.end === owner.charIndex) {
      last.end = owner.charIndex + 1
      continue
    }
    groups.push({ run: owner.run, start: owner.charIndex, end: owner.charIndex + 1 })
  }

  const rects: PdfRect[] = []
  for (const group of groups) {
    const length = group.run.text.length
    if (length <= 0) {
      continue
    }
    const rect = pdfRectForRunSpan(group.run.laidOut, group.start / length, group.end / length)
    if (rect) {
      rects.push(rect)
    }
  }
  return rects
}

export function viewportForSearchRemoved(): void {
  return undefined
}

function isTextItem(item: unknown): item is TextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof item.str === 'string' &&
    'transform' in item &&
    Array.isArray(item.transform) &&
    'width' in item &&
    typeof item.width === 'number' &&
    'height' in item &&
    typeof item.height === 'number' &&
    'fontName' in item &&
    typeof item.fontName === 'string'
  )
}
