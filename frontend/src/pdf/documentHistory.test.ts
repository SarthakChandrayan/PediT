import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { DrawingAnnotation } from './drawings.ts'
import {
  beginGesture,
  cancelGesture,
  canRedoHistory,
  commitDocument,
  createDocumentHistory,
  endGesture,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  resetHistory,
  shouldWarnOnUnload,
  undoHistory,
  updateGesture,
  withPageOperation,
  type DocumentHistory,
  type DocumentSnapshot,
} from './documentHistory.ts'
import { exportEditedPdf } from './exportPdf.ts'
import type { TextMarkup } from './highlights.ts'
import type { ImageAnnotation } from './images.ts'
import { rotatePage } from './pageOperations.ts'
import {
  beginTextEdit,
  cancelTextEdit,
  commitTextEdit,
  emptyEditorState,
  updateTextDraft,
  type TextEdit,
  type TextEditSource,
} from './textEdits.ts'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('document history', () => {
  it('undoes and redoes one committed text edit, not each keystroke', async () => {
    let history = await openPdf()
    const source: TextEditSource = {
      id: '1:0',
      pageNumber: 1,
      originalText: 'Hello',
      pdfX: 10,
      pdfY: 20,
      width: 40,
      height: 12,
      transform: [12, 0, 0, 12, 10, 20],
    }
    let editor = beginTextEdit(emptyEditorState(), source, 'Hello')
    editor = updateTextDraft(editor, 'H')
    editor = updateTextDraft(editor, 'He')
    editor = updateTextDraft(editor, 'Hi')
    expect(history.past).toHaveLength(0)

    const committed = commitTextEdit(editor)
    const edit = committed.edits[0]
    if (!edit) {
      throw new Error('expected a committed text edit')
    }
    history = commitDocument(history, (snapshot) => ({ ...snapshot, edits: committed.edits }))
    edit.editedText = 'mutated'
    expect(history.past).toHaveLength(1)
    expect(history.future).toHaveLength(0)
    expect(history.present.snapshot.edits[0]?.editedText).toBe('Hi')
    expect(isHistoryDirty(history)).toBe(true)

    history = undoHistory(history)
    expect(history.present.snapshot.edits).toHaveLength(0)
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(1)
    expect(isHistoryDirty(history)).toBe(false)

    const epoch = history.future[0]?.epoch
    history = redoHistory(history)
    expect(history.present.epoch).toBe(epoch)
    expect(history.present.snapshot.edits[0]?.editedText).toBe('Hi')
    expect(history.future).toHaveLength(0)

    let cancelled = beginTextEdit(emptyEditorState(), source, 'Hello')
    cancelled = updateTextDraft(cancelled, 'Nope')
    const dropped = cancelTextEdit(cancelled)
    expect(dropped.active).toBeNull()
    expect(dropped.edits).toEqual(emptyEditorState().edits)
    expect(history.present.snapshot.edits[0]?.editedText).toBe('Hi')
    const unchanged = history
    history = commitDocument(history, (snapshot) => ({ ...snapshot, edits: snapshot.edits }))
    expect(history).toBe(unchanged)
  })

  it('undoes and redoes a highlight', async () => {
    let history = await openPdf()
    const highlight = markup('h1', 'highlight')
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [...snapshot.markups, highlight],
      selectedMarkupId: highlight.id,
    }))
    expect(history.present.snapshot.markups).toHaveLength(1)
    expect(history.present.snapshot.pdfBytes).toBe(history.past[0]?.snapshot.pdfBytes)

    history = undoHistory(history)
    expect(history.present.snapshot.markups).toHaveLength(0)
    history = redoHistory(history)
    expect(history.present.snapshot.markups[0]?.id).toBe('h1')
    expect(history.present.snapshot.markups[0]?.text).toBe('Hello')

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: snapshot.markups.filter((item) => item.id !== 'h1'),
      selectedMarkupId: null,
    }))
    expect(history.present.snapshot.markups).toHaveLength(0)
    history = undoHistory(history)
    expect(history.present.snapshot.markups).toHaveLength(1)
  })

  it('records an image move as one step after many pointer updates', async () => {
    let history = await openPdf()
    const source = pngBytes()
    const inserted = imageAnnotation('img', source, { x: 10, y: 12 })
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      images: [...snapshot.images, inserted],
    }))
    source[0] = (source[0] ?? 0) ^ 0xff
    const stored = history.present.snapshot.images[0]?.bytes
    expect(stored?.[0]).not.toBe(source[0])
    const startX = history.present.snapshot.images[0]?.x

    let dragging = beginGesture(history)
    for (let step = 1; step <= 100; step += 1) {
      dragging = updateGesture(dragging, (snapshot) => ({
        ...snapshot,
        images: snapshot.images.map((image) =>
          image.id === 'img' ? { ...image, x: 10 + step } : image,
        ),
      }))
      expect(dragging.past).toHaveLength(1)
      expect(dragging.future).toHaveLength(0)
    }
    history = endGesture(dragging)
    expect(history.past).toHaveLength(2)
    expect(history.present.snapshot.images[0]?.x).toBe(110)
    expect(sameBytes(history.present.snapshot.images[0]?.bytes ?? new Uint8Array(), stored ?? new Uint8Array())).toBe(
      true,
    )

    history = undoHistory(history)
    expect(history.present.snapshot.images[0]?.x).toBe(startX)
    expect(sameBytes(history.present.snapshot.images[0]?.bytes ?? new Uint8Array(), stored ?? new Uint8Array())).toBe(
      true,
    )
    history = redoHistory(history)
    expect(history.present.snapshot.images[0]?.x).toBe(110)

    let unchanged = beginGesture(history)
    unchanged = updateGesture(unchanged, (snapshot) => ({
      ...snapshot,
      images: snapshot.images.map((image) => ({ ...image })),
    }))
    const before = unchanged.past.length
    unchanged = endGesture(unchanged)
    expect(unchanged.past).toHaveLength(before)

    let abandoned = beginGesture(history)
    abandoned = updateGesture(abandoned, (snapshot) => ({
      ...snapshot,
      images: snapshot.images.map((image) => (image.id === 'img' ? { ...image, x: 1 } : image)),
    }))
    abandoned = cancelGesture(abandoned)
    expect(abandoned.past).toHaveLength(history.past.length)
    expect(abandoned.present.snapshot.images[0]?.x).toBe(110)
  })

  it('undoes and redoes one image resize', async () => {
    let history = await openPdf()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      images: [...snapshot.images, imageAnnotation('img', pngBytes(), { width: 40, height: 40 })],
    }))
    const before = history.present.snapshot.images[0]
    let dragging = beginGesture(history)
    dragging = updateGesture(dragging, (snapshot) => ({
      ...snapshot,
      images: snapshot.images.map((image) =>
        image.id === 'img' ? { ...image, width: 80, height: 80 } : image,
      ),
    }))
    dragging = updateGesture(dragging, (snapshot) => ({
      ...snapshot,
      images: snapshot.images.map((image) =>
        image.id === 'img' ? { ...image, width: 90, height: 90 } : image,
      ),
    }))
    history = endGesture(dragging)
    expect(history.past).toHaveLength(2)
    expect(history.present.snapshot.images[0]?.width).toBe(90)

    history = undoHistory(history)
    expect(history.present.snapshot.images[0]?.width).toBe(before?.width)
    expect(history.present.snapshot.images[0]?.height).toBe(before?.height)
    history = redoHistory(history)
    expect(history.present.snapshot.images[0]?.width).toBe(90)
    expect(history.present.snapshot.images[0]?.height).toBe(90)
  })

  it('undoes and redoes one completed drawing', async () => {
    let history = await openPdf()
    const drawing = rectangle('d1')
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      drawings: [...snapshot.drawings, drawing],
    }))
    drawing.points[0] = { x: 99, y: 99 }
    expect(history.present.snapshot.drawings[0]?.points[0]).toEqual({ x: 1, y: 2 })

    history = undoHistory(history)
    expect(history.present.snapshot.drawings).toHaveLength(0)
    history = redoHistory(history)
    expect(history.present.snapshot.drawings[0]?.kind).toBe('rectangle')

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      drawings: [],
      selectedDrawingId: null,
    }))
    expect(history.present.snapshot.drawings).toHaveLength(0)
    history = undoHistory(history)
    expect(history.present.snapshot.drawings).toHaveLength(1)
  })

  it('undoes and redoes a page rotation without changing earlier PDF bytes', async () => {
    let history = await openPdf()
    const baseline = history.present.snapshot.pdfBytes
    const rotated = await rotatePage(baseline, 0, 90)
    const rotatedFirst = rotated[0]
    history = commitDocument(history, () => withPageOperation(rotated), {
      pdfChanged: true,
    })
    rotated[0] = (rotated[0] ?? 0) ^ 0xff
    expect(history.present.snapshot.pdfBytes[0]).toBe(rotatedFirst)
    expect(history.past[0]?.snapshot.pdfBytes).toBe(baseline)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(90)
    expect(history.present.snapshot.images).toHaveLength(0)

    history = undoHistory(history)
    expect(history.present.snapshot.pdfBytes).toBe(baseline)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(0)
    history = redoHistory(history)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(90)
  })

  it('walks mixed image, markup, drawing, and page steps backward and forward', async () => {
    let history = await openPdf()
    const baseline = history.present.snapshot.pdfBytes
    const png = pngBytes()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      images: [...snapshot.images, imageAnnotation('img', png, { x: 8, y: 9 })],
    }))
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [...snapshot.markups, markup('h1', 'highlight')],
    }))
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      drawings: [...snapshot.drawings, rectangle('box')],
    }))
    history = await bakeAndRotate(history)

    expect(history.present.snapshot.images).toHaveLength(0)
    expect(history.present.snapshot.markups).toHaveLength(0)
    expect(history.present.snapshot.drawings).toHaveLength(0)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(90)
    expect(pdfHasImage(history.present.snapshot.pdfBytes)).toBe(true)

    history = undoHistory(history)
    expect(history.present.snapshot.drawings[0]?.id).toBe('box')
    expect(history.present.snapshot.markups[0]?.id).toBe('h1')
    expect(history.present.snapshot.images[0]?.x).toBe(8)
    expect(history.present.snapshot.pdfBytes).toBe(baseline)

    history = undoHistory(history)
    expect(history.present.snapshot.drawings).toHaveLength(0)
    expect(history.present.snapshot.markups).toHaveLength(1)
    expect(history.present.snapshot.images).toHaveLength(1)

    history = undoHistory(history)
    expect(history.present.snapshot.markups).toHaveLength(0)
    expect(history.present.snapshot.images).toHaveLength(1)

    history = undoHistory(history)
    expect(history.present.snapshot.images).toHaveLength(0)
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(4)
    expect(isHistoryDirty(history)).toBe(false)

    history = redoHistory(history)
    expect(history.present.snapshot.images).toHaveLength(1)
    history = redoHistory(history)
    expect(history.present.snapshot.markups).toHaveLength(1)
    history = redoHistory(history)
    expect(history.present.snapshot.drawings).toHaveLength(1)
    history = redoHistory(history)
    expect(history.future).toHaveLength(0)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(90)
    expect(pdfHasImage(history.present.snapshot.pdfBytes)).toBe(true)
  })

  it('clears the redo stack when a different change follows undo', async () => {
    let history = await openPdf()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [...snapshot.markups, markup('first', 'highlight')],
    }))
    history = undoHistory(history)
    expect(canRedoHistory(history)).toBe(true)

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [...snapshot.markups, markup('second', 'underline')],
    }))
    expect(history.future).toHaveLength(0)
    expect(canRedoHistory(history)).toBe(false)
    expect(redoHistory(history)).toBe(history)
    expect(history.present.snapshot.markups[0]?.id).toBe('second')
  })

  it('uses the saved history position as the clean baseline', async () => {
    const loaded = await blankPdf()
    let history = createDocumentHistory(snapshotOf(loaded))
    const savedByte = loaded[0]
    loaded[0] = (loaded[0] ?? 0) ^ 0xff
    expect(history.present.snapshot.pdfBytes[0]).toBe(savedByte)
    expect(isHistoryDirty(history)).toBe(false)

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      edits: [...snapshot.edits, textEdit('Hi')],
    }))
    expect(isHistoryDirty(history)).toBe(true)

    history = undoHistory(history)
    expect(isHistoryDirty(history)).toBe(false)
    history = redoHistory(history)
    expect(isHistoryDirty(history)).toBe(true)

    const pastBeforeSave = history.past.length
    history = markHistorySaved(history)
    expect(history.past).toHaveLength(pastBeforeSave)
    expect(history.future).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)

    history = undoHistory(history)
    expect(isHistoryDirty(history)).toBe(true)
    history = redoHistory(history)
    expect(isHistoryDirty(history)).toBe(false)

    const replacement = await blankPdf()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [...snapshot.markups, markup('later', 'strikethrough')],
    }))
    history = undoHistory(history)
    history = resetHistory(history, snapshotOf(replacement))
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)
    expect(history.present.snapshot.markups).toHaveLength(0)
    expect(history.present.snapshot.pdfBytes).not.toBe(replacement)
  })

  it('warns on unload only while history is dirty or a text draft is open', async () => {
    let history = await openPdf()
    expect(shouldWarnOnUnload(isHistoryDirty(history), false)).toBe(false)
    expect(shouldWarnOnUnload(isHistoryDirty(history), true)).toBe(true)

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      edits: [...snapshot.edits, textEdit('Hi')],
    }))
    expect(isHistoryDirty(history)).toBe(true)
    expect(shouldWarnOnUnload(isHistoryDirty(history), false)).toBe(true)

    history = undoHistory(history)
    expect(isHistoryDirty(history)).toBe(false)
    expect(shouldWarnOnUnload(isHistoryDirty(history), false)).toBe(false)
  })

  it('does not create a history step or change dirty state when exporting', async () => {
    let history = await openPdf()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      edits: [...snapshot.edits, textEdit('Hi')],
    }))
    const past = history.past.length
    const epoch = history.present.epoch
    const exported = await exportSnapshot(history.present.snapshot)
    expect(exported.byteLength).toBeGreaterThan(0)
    expect(history.past).toHaveLength(past)
    expect(history.present.epoch).toBe(epoch)
    expect(isHistoryDirty(history)).toBe(true)
    expect(history.future).toHaveLength(0)
  })

  it('treats undo back to a saved version as clean so save is a no-op', async () => {
    let history = await openPdf()
    expect(isHistoryDirty(history)).toBe(false)

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [...snapshot.markups, markup('h1', 'highlight')],
    }))
    expect(isHistoryDirty(history)).toBe(true)

    history = markHistorySaved(history)
    expect(isHistoryDirty(history)).toBe(false)

    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      drawings: [...snapshot.drawings, rectangle('box')],
    }))
    expect(isHistoryDirty(history)).toBe(true)

    history = undoHistory(history)
    expect(isHistoryDirty(history)).toBe(false)

    history = redoHistory(history)
    expect(isHistoryDirty(history)).toBe(true)

    const pastBeforeSave = history.past.length
    history = markHistorySaved(history)
    expect(history.past).toHaveLength(pastBeforeSave)
    expect(isHistoryDirty(history)).toBe(false)
  })

  it('keeps an inserted image across a page operation, undo, redo, and export', async () => {
    let history = await openPdf()
    const baseline = history.present.snapshot.pdfBytes
    expect(pdfHasImage(baseline)).toBe(false)
    const png = pngBytes()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      images: [...snapshot.images, imageAnnotation('img', png, { x: 12, y: 18, width: 30, height: 30 })],
    }))
    const imageBytes = history.present.snapshot.images[0]?.bytes
    if (!imageBytes) {
      throw new Error('expected the inserted image')
    }

    let dragging = beginGesture(history)
    dragging = updateGesture(dragging, (snapshot) => ({
      ...snapshot,
      images: snapshot.images.map((image) =>
        image.id === 'img' ? { ...image, x: image.x + 25, y: image.y + 10 } : image,
      ),
    }))
    history = endGesture(dragging)
    const movedX = history.present.snapshot.images[0]?.x
    const movedY = history.present.snapshot.images[0]?.y

    history = await bakeAndRotate(history)
    expect(history.present.snapshot.images).toHaveLength(0)

    history = undoHistory(history)
    const restored = history.present.snapshot.images[0]
    expect(restored?.x).toBe(movedX)
    expect(restored?.y).toBe(movedY)
    expect(sameBytes(restored?.bytes ?? new Uint8Array(), imageBytes)).toBe(true)
    expect(history.present.snapshot.pdfBytes).toBe(baseline)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(0)

    history = redoHistory(history)
    expect(history.present.snapshot.images).toHaveLength(0)
    expect(await pageRotation(history.present.snapshot.pdfBytes)).toBe(90)

    const exported = await exportSnapshot(history.present.snapshot)
    expect(history.present.snapshot.images).toHaveLength(0)
    expect(pdfHasImage(exported)).toBe(true)
    expect(await pageRotation(exported)).toBe(90)
  })
})

async function openPdf(): Promise<DocumentHistory> {
  return createDocumentHistory(snapshotOf(await blankPdf()))
}

async function blankPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([300, 400])
  return pdf.save()
}

async function bakeAndRotate(history: DocumentHistory): Promise<DocumentHistory> {
  const baked = await exportSnapshot(history.present.snapshot)
  const rotated = await rotatePage(baked, 0, 90)
  return commitDocument(history, () => withPageOperation(rotated), {
    pdfChanged: true,
  })
}

async function exportSnapshot(snapshot: DocumentSnapshot): Promise<Uint8Array> {
  if (
    snapshot.edits.length === 0 &&
    snapshot.markups.length === 0 &&
    snapshot.drawings.length === 0 &&
    snapshot.images.length === 0
  ) {
    const copy = new Uint8Array(snapshot.pdfBytes.byteLength)
    copy.set(snapshot.pdfBytes)
    return copy
  }
  const copy = new ArrayBuffer(snapshot.pdfBytes.byteLength)
  new Uint8Array(copy).set(snapshot.pdfBytes)
  return exportEditedPdf(
    copy,
    snapshot.edits,
    snapshot.markups,
    snapshot.drawings,
    snapshot.images,
  )
}

async function pageRotation(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPage(0).getRotation().angle
}

function snapshotOf(pdfBytes: Uint8Array): DocumentSnapshot {
  return {
    pdfBytes,
    edits: [],
    markups: [],
    drawings: [],
    images: [],
    selectedMarkupId: null,
    selectedDrawingId: null,
    selectedImageId: null,
  }
}

function pngBytes(): Uint8Array {
  const binary = atob(PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function textEdit(editedText: string): TextEdit {
  return {
    id: '1:0',
    pageNumber: 1,
    originalText: 'Hello',
    editedText,
    pdfX: 10,
    pdfY: 20,
    width: 40,
    height: 12,
    transform: [12, 0, 0, 12, 10, 20],
  }
}

function markup(id: string, kind: TextMarkup['kind']): TextMarkup {
  return {
    id,
    kind,
    pageNumber: 1,
    text: 'Hello',
    pdfRects: [{ x: 10, y: 20, width: 40, height: 12 }],
    color: kind === 'highlight' ? '#ffe14a' : '#000000',
    opacity: kind === 'highlight' ? 0.45 : 1,
    thickness: kind === 'highlight' ? 0 : 1,
  }
}

function rectangle(id: string): DrawingAnnotation {
  return {
    id,
    pageNumber: 1,
    kind: 'rectangle',
    points: [
      { x: 1, y: 2 },
      { x: 30, y: 40 },
    ],
    color: '#000000',
    opacity: 1,
    thickness: 2,
  }
}

function imageAnnotation(
  id: string,
  bytes: Uint8Array,
  box: { x?: number; y?: number; width?: number; height?: number },
): ImageAnnotation {
  return {
    id,
    pageNumber: 1,
    x: box.x ?? 10,
    y: box.y ?? 10,
    width: box.width ?? 40,
    height: box.height ?? 40,
    originalWidth: 1,
    originalHeight: 1,
    format: 'png',
    bytes,
  }
}

function pdfHasImage(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes)
  return text.includes('/Subtype /Image') || text.includes('/Subtype/Image')
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
