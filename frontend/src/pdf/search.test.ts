import { PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { layoutTextItem, pdfRectForRun, pdfRectForRunSpan } from './coordinates.ts'
import {
  commitDocument,
  createDocumentHistory,
  emptyDocumentSnapshot,
  isHistoryDirty,
  redoHistory,
  undoHistory,
  type DocumentHistory,
  type DocumentSnapshot,
} from './documentHistory.ts'
import { exportEditedPdf } from './exportPdf.ts'
import {
  applyVisibleText,
  clearSearch,
  createSearchModel,
  editsAsVisible,
  extractSearchDocument,
  findTextMatches,
  isFindShortcut,
  openSearch,
  searchHitsForPage,
  searchModelForDocument,
  setSearchCaseSensitive,
  setSearchQuery,
  shouldCloseSearchOnEscape,
  stepSearch,
  type SearchMatch,
  type SearchModel,
  type SearchPage,
  type SearchRun,
} from './search.ts'
import { textRunId, type TextEdit } from './textEdits.ts'

GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href

const viewport = {
  scale: 1,
  convertToViewportPoint(x: number, y: number) {
    return [x, 800 - y]
  },
} as PageViewport

describe('text search', () => {
  it('finds Invoice and returns that match', () => {
    const pages = invoicePages()
    const matches = findTextMatches(pages, 'Invoice', false)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      index: 0,
      pageNumber: 1,
      text: 'Invoice',
    })
    expect(matches[0]?.pdfRects.length).toBeGreaterThan(0)
  })

  it('matches Invoice when the query is invoice', () => {
    const matches = findTextMatches(invoicePages(), 'invoice', false)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.text).toBe('Invoice')
  })

  it('does not match Invoice when the query is invoice and case-sensitive', () => {
    expect(findTextMatches(invoicePages(), 'invoice', true)).toEqual([])
    expect(findTextMatches(invoicePages(), 'Invoice', true)).toHaveLength(1)
  })

  it('returns every occurrence on one page', () => {
    const pages: SearchPage[] = [
      {
        pageNumber: 1,
        runs: [
          run(1, 0, 'Invoice', 72, 700),
          run(1, 1, 'see Invoice again', 72, 680),
        ],
      },
    ]
    const matches = findTextMatches(pages, 'Invoice', false)

    expect(matches).toHaveLength(2)
    expect(matches.map((match) => match.text)).toEqual(['Invoice', 'Invoice'])
    expect(matches.map((match) => match.index)).toEqual([0, 1])
    expect(matches.every((match) => match.pageNumber === 1)).toBe(true)
    expect(matches[0]?.pdfRects[0]?.y).not.toBe(matches[1]?.pdfRects[0]?.y)
  })

  it('records the page number of matches on different pages', () => {
    const pages: SearchPage[] = [
      { pageNumber: 1, runs: [run(1, 0, 'Invoice', 72, 700)] },
      { pageNumber: 2, runs: [run(2, 0, 'Invoice', 72, 700)] },
      { pageNumber: 3, runs: [run(3, 0, 'Notes', 72, 700)] },
    ]
    const matches = findTextMatches(pages, 'Invoice', false)

    expect(matches.map((match) => match.pageNumber)).toEqual([1, 2])
  })

  it('steps to the next and previous match and wraps at both ends', () => {
    const count = 3
    let model = setSearchQuery(createSearchModel(), 'Invoice')
    expect(model.currentMatchIndex).toBe(0)

    model = stepSearch(model, count, 1)
    expect(model.currentMatchIndex).toBe(1)
    model = stepSearch(model, count, 1)
    expect(model.currentMatchIndex).toBe(2)
    model = stepSearch(model, count, 1)
    expect(model.currentMatchIndex).toBe(0)

    model = stepSearch(model, count, -1)
    expect(model.currentMatchIndex).toBe(2)
    model = stepSearch(model, count, -1)
    expect(model.currentMatchIndex).toBe(1)
    model = stepSearch(model, count, -1)
    expect(model.currentMatchIndex).toBe(0)
  })

  it('builds PDF-space rectangles on the matched text runs', () => {
    const full = run(1, 0, 'Invoice', 72, 700)
    const partial = run(1, 1, 'Invoice total', 72, 640)
    const matches = findTextMatches(
      [{ pageNumber: 1, runs: [full, partial] }],
      'Invoice',
      true,
    )

    expect(matches).toHaveLength(2)
    expect(matches[0]?.pdfRects).toEqual([pdfRectForRun(full.laidOut)])
    expect(matches[1]?.pdfRects).toEqual([
      pdfRectForRunSpan(partial.laidOut, 0, 'Invoice'.length / partial.text.length),
    ])

    for (const match of matches) {
      expect(validPdfRects(match)).toBe(true)
    }

    const fullRect = matches[0]?.pdfRects[0]
    const partialRect = matches[1]?.pdfRects[0]
    const partialRun = pdfRectForRun(partial.laidOut)
    expect(fullRect?.width).toBeGreaterThan(0)
    expect(partialRect && fullRect && partialRect.width).toBeLessThan(partialRun.width)
    expect(partialRect?.x).toBeCloseTo(partialRun.x)
    expect(partialRect?.y).toBeCloseTo(partialRun.y)
    expect(partialRect?.height).toBeCloseTo(partialRun.height)
  })

  it('shows search hits only while search is open and never as text markup', () => {
    const matches = findTextMatches(invoicePages(), 'Invoice', false)
    let model = setSearchQuery(openSearch(createSearchModel()), 'Invoice')

    expect(searchHitsForPage(model.open, matches, 1)).toEqual(matches)
    expect(searchHitsForPage(model.open, matches, 2)).toEqual([])

    model = clearSearch(model)
    expect(model).toEqual(createSearchModel())
    expect(searchHitsForPage(model.open, matches, 1)).toEqual([])

    for (const match of matches) {
      expect(isTextMarkup(match)).toBe(false)
    }
    expect(emptyDocumentSnapshot().markups).toEqual([])
  })

  it('does not mark the document dirty when search opens or the query changes', () => {
    const history = createDocumentHistory()
    const before = fingerprint(history)

    let model = openSearch(createSearchModel())
    model = setSearchQuery(model, 'Invoice')
    model = setSearchCaseSensitive(model, true)
    model = stepSearch(model, 2, 1)
    model = clearSearch(model)

    expect(model.open).toBe(false)
    expect(fingerprint(history)).toEqual(before)
    expect(isHistoryDirty(history)).toBe(false)
    expect(history.present.snapshot).toEqual(emptyDocumentSnapshot())
  })

  it('does not push undo or redo entries when searching', () => {
    let history = commitDocument(createDocumentHistory(), (snapshot) => ({
      ...snapshot,
      edits: [textEdit('1:0', 'Receipt')],
    }))
    const before = fingerprint(history)

    let model = setSearchQuery(createSearchModel(), 'Receipt')
    model = stepSearch(model, 4, 1)
    model = stepSearch(model, 4, -1)
    clearSearch(model)

    expect(fingerprint(history)).toEqual(before)
    expect(history.past).toHaveLength(1)
    expect(history.future).toHaveLength(0)

    history = undoHistory(history)
    expect(history.present.snapshot.edits).toEqual([])
    expect(history.future).toHaveLength(1)

    history = redoHistory(history)
    expect(history.present.snapshot.edits[0]?.editedText).toBe('Receipt')
    expect(history.past).toHaveLength(1)
    expect(isHistoryDirty(history)).toBe(true)
  })

  it('leaves PDF bytes unchanged and omits search hits from export', async () => {
    const bytes = await invoicePdf()
    const original = bytes.slice()
    const pdf = await openPdf(bytes)
    try {
      const pages = await extractSearchDocument(pdf)
      const matches = findTextMatches(pages, 'Invoice', false)
      expect(matches.length).toBeGreaterThan(0)

      let model: SearchModel = setSearchQuery(createSearchModel(), 'Invoice')
      model = stepSearch(model, matches.length, 1)
      clearSearch(model)

      expect(sameBytes(bytes, original)).toBe(true)

      const exported = await exportEditedPdf(copyBuffer(bytes), [])
      expect(sameBytes(exported, bytes)).toBe(true)

      const withMarkup = await exportEditedPdf(copyBuffer(bytes), [], [
        {
          id: 'markup-1',
          kind: 'highlight',
          pageNumber: 1,
          text: 'Invoice',
          pdfRects: matches[0]?.pdfRects ?? [],
          color: '#ffe14a',
          opacity: 0.45,
          thickness: 0,
        },
      ])
      expect(sameBytes(withMarkup, bytes)).toBe(false)
    } finally {
      await pdf.destroy()
    }
  })

  it('clears search when another document or version is opened', () => {
    const open = setSearchQuery(setSearchCaseSensitive(createSearchModel(), true), 'Invoice')
    expect(open.open).toBe(true)
    expect(open.caseSensitive).toBe(true)

    expect(searchModelForDocument(open, true)).toBe(open)
    expect(searchModelForDocument(open, false)).toEqual(createSearchModel())

    const otherDocument = findTextMatches(
      [{ pageNumber: 1, runs: [run(1, 0, 'Notes', 72, 700)] }],
      open.query,
      open.caseSensitive,
    )
    expect(otherDocument).toEqual([])
  })

  it('searches the working text overlay and leaves the extracted cache and PDF bytes alone', () => {
    const pages = invoicePages()
    const cached = pages[0]?.runs[0]?.text
    expect(cached).toBe('Invoice')

    const edited = applyVisibleText(pages, [{ id: textRunId(1, 0), editedText: 'Receipt' }], null)
    expect(pages[0]?.runs[0]?.text).toBe('Invoice')
    expect(edited[0]?.runs[0]?.text).toBe('Receipt')
    expect(edited[0]?.runs[0]?.laidOut).toBe(pages[0]?.runs[0]?.laidOut)

    expect(findTextMatches(edited, 'Receipt', false).map((match) => match.text)).toEqual(['Receipt'])
    expect(findTextMatches(edited, 'Invoice', false)).toEqual([])

    const rect = findTextMatches(edited, 'Receipt', true)[0]?.pdfRects
    expect(rect).toEqual([
      pdfRectForRunSpan(
        pages[0]!.runs[0]!.laidOut,
        0,
        'Receipt'.length / 'Receipt'.length,
      ),
    ])

    const drafted = applyVisibleText(
      pages,
      [{ id: textRunId(1, 0), editedText: 'Receipt' }],
      { id: textRunId(1, 0), text: 'Drafted' },
    )
    expect(findTextMatches(drafted, 'Drafted', true)).toHaveLength(1)
    expect(findTextMatches(drafted, 'Receipt', true)).toEqual([])

    const removed = applyVisibleText(pages, [{ id: textRunId(1, 0), editedText: '' }], null)
    expect(removed[0]?.runs).toEqual([])
    expect(findTextMatches(removed, 'Invoice', false)).toEqual([])

    const fromHistory = editsAsVisible([textEdit(textRunId(1, 0), 'Receipt')])
    expect(findTextMatches(applyVisibleText(pages, fromHistory, null), 'Receipt', true)).toHaveLength(1)
  })

  it('opens on Ctrl+F or Cmd+F, closes on Escape, and leaves undo and redo keys alone', () => {
    expect(isFindShortcut(key('f', { ctrlKey: true }))).toBe(true)
    expect(isFindShortcut(key('F', { metaKey: true }))).toBe(true)
    expect(isFindShortcut(key('f', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isFindShortcut(key('f', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(isFindShortcut(key('f'))).toBe(false)
    expect(isFindShortcut(key('z', { ctrlKey: true }))).toBe(false)
    expect(isFindShortcut(key('y', { ctrlKey: true }))).toBe(false)
    expect(isFindShortcut(key('z', { metaKey: true, shiftKey: true }))).toBe(false)

    installTextAreaGlobal()
    const textarea = new globalThis.HTMLTextAreaElement()
    expect(
      shouldCloseSearchOnEscape({ key: 'Escape', defaultPrevented: false }, true, null),
    ).toBe(true)
    expect(
      shouldCloseSearchOnEscape({ key: 'Escape', defaultPrevented: false }, false, null),
    ).toBe(false)
    expect(
      shouldCloseSearchOnEscape({ key: 'Escape', defaultPrevented: true }, true, null),
    ).toBe(false)
    expect(
      shouldCloseSearchOnEscape({ key: 'Escape', defaultPrevented: false }, true, textarea),
    ).toBe(false)
    expect(
      shouldCloseSearchOnEscape({ key: 'z', defaultPrevented: false }, true, null),
    ).toBe(false)

    const history = commitDocument(createDocumentHistory(), (snapshot) => ({
      ...snapshot,
      edits: [textEdit('1:0', 'Hi')],
    }))
    const before = fingerprint(history)
    let model = openSearch(createSearchModel())
    model = setSearchQuery(model, 'I')
    model = setSearchQuery(model, 'In')
    model = setSearchQuery(model, 'Invoice')
    expect(model.query).toBe('Invoice')
    expect(fingerprint(history)).toEqual(before)
    expect(undoHistory(history).present.snapshot.edits).toEqual([])
  })
})

describe('real PDF search', () => {
  it('searches a multi-page PDF, follows edits on the overlay, and exports without search hits', async () => {
    const bytes = await invoicePdf()
    const original = bytes.slice()
    let history = createDocumentHistory(snapshotWith(bytes))
    const pdf = await openPdf(bytes)

    try {
      const pages = await extractSearchDocument(pdf)
      expect(pages.length).toBe(2)

      let model = openSearch(createSearchModel())
      model = setSearchQuery(model, 'Invoice')
      let matches = findTextMatches(pages, model.query, model.caseSensitive)
      expect(matches).toHaveLength(3)
      expect(matches.map((match) => match.pageNumber)).toEqual([1, 1, 2])
      expect(matches.every((match) => validPdfRects(match))).toBe(true)

      const pagesSeen: number[] = []
      for (let step = 0; step < matches.length; step += 1) {
        pagesSeen.push(matches[model.currentMatchIndex]?.pageNumber ?? -1)
        model = stepSearch(model, matches.length, 1)
      }
      expect(pagesSeen).toEqual([1, 1, 2])
      expect(model.currentMatchIndex).toBe(0)

      const backward: number[] = []
      for (let step = 0; step < matches.length; step += 1) {
        model = stepSearch(model, matches.length, -1)
        backward.push(matches[model.currentMatchIndex]?.pageNumber ?? -1)
      }
      expect(backward).toEqual([2, 1, 1])
      expect(model.currentMatchIndex).toBe(0)

      model = setSearchCaseSensitive(model, true)
      expect(findTextMatches(pages, 'invoice', true)).toEqual([])
      expect(findTextMatches(pages, 'Invoice', true)).toHaveLength(3)
      model = setSearchCaseSensitive(model, false)
      expect(findTextMatches(pages, 'invoice', model.caseSensitive)).toHaveLength(3)

      const target = pages[0]?.runs.find((item) => item.text.includes('Invoice'))
      expect(target).toBeTruthy()
      const editedPages = applyVisibleText(
        pages,
        [{ id: target!.id, editedText: target!.text.replace('Invoice', 'Receipt') }],
        null,
      )
      expect(pages[0]?.runs.some((item) => item.text.includes('Invoice'))).toBe(true)
      matches = findTextMatches(editedPages, 'Receipt', false)
      expect(matches).toHaveLength(1)
      expect(matches[0]?.pageNumber).toBe(1)
      expect(findTextMatches(editedPages, 'Invoice', false)).toHaveLength(2)

      const live = applyVisibleText(pages, [], { id: target!.id, text: 'Drafted copy' })
      expect(findTextMatches(live, 'Drafted', false)).toHaveLength(1)
      expect(findTextMatches(live, 'Invoice', false)).toHaveLength(2)

      model = clearSearch(model)
      expect(model).toEqual(createSearchModel())
      expect(searchHitsForPage(model.open, matches, 1)).toEqual([])
      expect(matches.every((match) => isTextMarkup(match))).toBe(false)

      expect(isHistoryDirty(history)).toBe(false)
      expect(history.past).toEqual([])
      expect(history.future).toEqual([])
      expect(sameBytes(history.present.snapshot.pdfBytes, bytes)).toBe(true)
      expect(sameBytes(bytes, original)).toBe(true)

      const exported = await exportEditedPdf(copyBuffer(history.present.snapshot.pdfBytes), [])
      expect(sameBytes(exported, bytes)).toBe(true)
      const exportedPdf = await PDFDocument.load(exported)
      for (const page of exportedPdf.getPages()) {
        expect(page.node.Annots()?.size() ?? 0).toBe(0)
      }

      history = undoHistory(history)
      history = redoHistory(history)
      expect(isHistoryDirty(history)).toBe(false)
      expect(history.past).toEqual([])
      expect(history.future).toEqual([])
    } finally {
      await pdf.destroy()
    }
  })
})

function invoicePages(): SearchPage[] {
  return [{ pageNumber: 1, runs: [run(1, 0, 'Invoice', 72, 700)] }]
}

function run(
  pageNumber: number,
  index: number,
  text: string,
  x: number,
  y: number,
  hasEOL = false,
): SearchRun {
  const fontSize = 12
  const laidOut = layoutTextItem(
    viewport,
    {
      str: text,
      dir: 'ltr',
      transform: [fontSize, 0, 0, fontSize, x, y],
      width: text.length * 7,
      height: fontSize,
      fontName: 'Helvetica',
      hasEOL,
    },
    { ascent: 0.8, descent: -0.2, fontFamily: 'Helvetica' },
  )
  if (!laidOut) {
    throw new Error(`Could not lay out "${text}".`)
  }
  return {
    id: textRunId(pageNumber, index),
    pageNumber,
    text,
    hasEOL,
    laidOut,
  }
}

function validPdfRects(match: SearchMatch): boolean {
  return match.pdfRects.every(
    (rect) =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0,
  )
}

function isTextMarkup(match: SearchMatch): boolean {
  const record = match as SearchMatch & { kind?: unknown; id?: unknown; color?: unknown }
  return record.kind !== undefined || record.id !== undefined || record.color !== undefined
}

function fingerprint(history: DocumentHistory) {
  return {
    past: history.past.length,
    future: history.future.length,
    epoch: history.present.epoch,
    savedEpoch: history.savedEpoch,
    nextEpoch: history.nextEpoch,
    dirty: isHistoryDirty(history),
    edits: history.present.snapshot.edits,
    markups: history.present.snapshot.markups,
    drawings: history.present.snapshot.drawings,
    images: history.present.snapshot.images,
    pdfBytes: history.present.snapshot.pdfBytes,
  }
}

function textEdit(id: string, editedText: string): TextEdit {
  return {
    id,
    pageNumber: 1,
    originalText: 'Invoice',
    editedText,
    pdfX: 72,
    pdfY: 700,
    width: 49,
    height: 12,
    transform: [12, 0, 0, 12, 72, 700],
  }
}

function key(
  keyName: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
) {
  return {
    key: keyName,
    ctrlKey: modifiers.ctrlKey === true,
    metaKey: modifiers.metaKey === true,
    altKey: modifiers.altKey === true,
    shiftKey: modifiers.shiftKey === true,
  }
}

function installTextAreaGlobal(): void {
  if (typeof globalThis.HTMLTextAreaElement === 'function') {
    return
  }
  const TextArea = class HTMLTextAreaElement {}
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', {
    value: TextArea,
    configurable: true,
  })
}

function snapshotWith(pdfBytes: Uint8Array): DocumentSnapshot {
  return { ...emptyDocumentSnapshot(), pdfBytes }
}

async function invoicePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([612, 792])
  first.drawText('Invoice', { x: 72, y: 700, size: 18, font })
  first.drawText('Invoice', { x: 72, y: 660, size: 18, font })
  const second = pdf.addPage([612, 792])
  second.drawText('Invoice', { x: 72, y: 700, size: 18, font })
  return pdf.save()
}

async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes.slice() }).promise
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}
