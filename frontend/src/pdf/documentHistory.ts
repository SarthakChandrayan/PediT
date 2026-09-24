import type { DrawingAnnotation } from './drawings.ts'
import type { TextMarkup } from './highlights.ts'
import type { ImageAnnotation } from './images.ts'
import type { TextEdit } from './textEdits.ts'

/**
 * Complete editable document state.
 *
 * Snapshots are immutable values. PDF bytes are copied when they change and
 * shared only while later steps leave the same bytes in place. Image bytes are
 * copied into every stored snapshot so a later edit cannot overwrite history.
 */
export type DocumentSnapshot = {
  pdfBytes: Uint8Array
  edits: readonly TextEdit[]
  markups: readonly TextMarkup[]
  drawings: readonly DrawingAnnotation[]
  images: readonly ImageAnnotation[]
  selectedMarkupId: string | null
  selectedDrawingId: string | null
  selectedImageId: string | null
}

export type HistoryEntry = {
  epoch: number
  snapshot: DocumentSnapshot
}

export type SelectionPatch = {
  selectedMarkupId?: string | null
  selectedDrawingId?: string | null
  selectedImageId?: string | null
}

export type CommitOptions = {
  /** True when this step replaces the PDF bytes, such as a page operation. */
  pdfChanged?: boolean
}

type Gesture = {
  baseline: DocumentSnapshot
  live: DocumentSnapshot
}

/**
 * Working-document history. Backend versions are not stored here.
 * `savedEpoch` is the clean baseline. Undo and redo move entries; they do not
 * allocate a new epoch.
 */
export type DocumentHistory = {
  past: HistoryEntry[]
  present: HistoryEntry
  future: HistoryEntry[]
  savedEpoch: number
  nextEpoch: number
  restoreId: number
  gesture: Gesture | null
}

export function emptyDocumentSnapshot(): DocumentSnapshot {
  return {
    pdfBytes: new Uint8Array(),
    edits: [],
    markups: [],
    drawings: [],
    images: [],
    selectedMarkupId: null,
    selectedDrawingId: null,
    selectedImageId: null,
  }
}

export function createDocumentHistory(
  snapshot: DocumentSnapshot = emptyDocumentSnapshot(),
): DocumentHistory {
  return {
    past: [],
    present: { epoch: 1, snapshot: cloneSnapshot(snapshot, true) },
    future: [],
    savedEpoch: 1,
    nextEpoch: 2,
    restoreId: 0,
    gesture: null,
  }
}

export function clonePdfBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

/** Page operations bake overlays into new PDF bytes and clear the overlay lists. */
export function withPageOperation(pdfBytes: Uint8Array): DocumentSnapshot {
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

export function isHistoryDirty(history: DocumentHistory): boolean {
  if (history.present.epoch !== history.savedEpoch) {
    return true
  }
  if (!history.gesture) {
    return false
  }
  return !sameContent(history.gesture.baseline, history.gesture.live)
}

export function shouldWarnOnUnload(historyDirty: boolean, uncommitted = false): boolean {
  return historyDirty || uncommitted
}

export function canUndoHistory(history: DocumentHistory): boolean {
  if (history.past.length > 0) {
    return true
  }
  return history.gesture !== null && !sameContent(history.gesture.baseline, history.gesture.live)
}

export function canRedoHistory(history: DocumentHistory): boolean {
  if (history.gesture && !sameContent(history.gesture.baseline, history.gesture.live)) {
    return false
  }
  return history.future.length > 0
}

export function currentSnapshot(history: DocumentHistory): DocumentSnapshot {
  return history.gesture?.live ?? history.present.snapshot
}

export function commitDocument(
  history: DocumentHistory,
  recipe: (snapshot: DocumentSnapshot) => DocumentSnapshot,
  options?: CommitOptions,
): DocumentHistory {
  const settled = endGesture(history)
  const base = settled.present.snapshot
  const drafted = recipe(base)
  const pdfChanged = options?.pdfChanged === true
  if (!pdfChanged && sameContent(base, drafted)) {
    if (sameSelection(base, drafted)) {
      return settled
    }
    return {
      ...settled,
      present: {
        ...settled.present,
        snapshot: { ...drafted, pdfBytes: base.pdfBytes },
      },
    }
  }

  const snapshot = cloneSnapshot(
    { ...drafted, pdfBytes: pdfChanged ? drafted.pdfBytes : base.pdfBytes },
    pdfChanged,
  )
  return {
    past: [...settled.past, settled.present],
    present: { epoch: settled.nextEpoch, snapshot },
    future: [],
    savedEpoch: settled.savedEpoch,
    nextEpoch: settled.nextEpoch + 1,
    restoreId: settled.restoreId,
    gesture: null,
  }
}

export function beginGesture(history: DocumentHistory): DocumentHistory {
  if (history.gesture) {
    return history
  }
  return {
    ...history,
    gesture: {
      baseline: history.present.snapshot,
      live: history.present.snapshot,
    },
  }
}

export function updateGesture(
  history: DocumentHistory,
  recipe: (snapshot: DocumentSnapshot) => DocumentSnapshot,
): DocumentHistory {
  const started = history.gesture ? history : beginGesture(history)
  const gesture = started.gesture
  if (!gesture) {
    return started
  }
  return {
    ...started,
    gesture: {
      baseline: gesture.baseline,
      live: recipe(gesture.live),
    },
  }
}

export function endGesture(history: DocumentHistory): DocumentHistory {
  if (!history.gesture) {
    return history
  }
  const { baseline, live } = history.gesture
  if (sameContent(baseline, live)) {
    return { ...history, gesture: null }
  }
  const snapshot = cloneSnapshot(
    { ...live, pdfBytes: history.present.snapshot.pdfBytes },
    false,
  )
  return {
    past: [...history.past, history.present],
    present: { epoch: history.nextEpoch, snapshot },
    future: [],
    savedEpoch: history.savedEpoch,
    nextEpoch: history.nextEpoch + 1,
    restoreId: history.restoreId,
    gesture: null,
  }
}

/** Drops an in-progress drag or resize without recording history. */
export function cancelGesture(history: DocumentHistory): DocumentHistory {
  if (!history.gesture) {
    return history
  }
  return { ...history, gesture: null }
}

export function undoHistory(history: DocumentHistory): DocumentHistory {
  const settled = endGesture(history)
  const previous = settled.past[settled.past.length - 1]
  if (!previous) {
    return settled
  }
  return {
    past: settled.past.slice(0, -1),
    present: previous,
    future: [settled.present, ...settled.future],
    savedEpoch: settled.savedEpoch,
    nextEpoch: settled.nextEpoch,
    restoreId: settled.restoreId + 1,
    gesture: null,
  }
}

export function redoHistory(history: DocumentHistory): DocumentHistory {
  const settled = endGesture(history)
  const next = settled.future[0]
  if (!next) {
    return settled
  }
  return {
    past: [...settled.past, settled.present],
    present: next,
    future: settled.future.slice(1),
    savedEpoch: settled.savedEpoch,
    nextEpoch: settled.nextEpoch,
    restoreId: settled.restoreId + 1,
    gesture: null,
  }
}

/** Marks the current committed state clean without dropping undo or redo. */
export function markHistorySaved(history: DocumentHistory): DocumentHistory {
  const settled = endGesture(history)
  if (settled.savedEpoch === settled.present.epoch) {
    return settled
  }
  return { ...settled, savedEpoch: settled.present.epoch }
}

/** Replaces history with a loaded document or backend version as the clean baseline. */
export function resetHistory(
  history: DocumentHistory,
  snapshot: DocumentSnapshot,
): DocumentHistory {
  return {
    past: [],
    present: { epoch: 1, snapshot: cloneSnapshot(snapshot, true) },
    future: [],
    savedEpoch: 1,
    nextEpoch: 2,
    restoreId: history.restoreId + 1,
    gesture: null,
  }
}

export function selectInHistory(
  history: DocumentHistory,
  patch: SelectionPatch,
): DocumentHistory {
  const current = history.present.snapshot
  const gesture = history.gesture
  if (!selectionChanges(current, patch) && !gestureSelectionChanges(gesture, patch)) {
    return history
  }
  return {
    ...history,
    present: {
      ...history.present,
      snapshot: applySelection(current, patch),
    },
    gesture: gesture
      ? {
          baseline: applySelection(gesture.baseline, patch),
          live: applySelection(gesture.live, patch),
        }
      : null,
  }
}

function cloneSnapshot(snapshot: DocumentSnapshot, copyPdf: boolean): DocumentSnapshot {
  return {
    pdfBytes: copyPdf ? clonePdfBytes(snapshot.pdfBytes) : snapshot.pdfBytes,
    edits: snapshot.edits.map(cloneEdit),
    markups: snapshot.markups.map(cloneMarkup),
    drawings: snapshot.drawings.map(cloneDrawing),
    images: snapshot.images.map(cloneImage),
    selectedMarkupId: snapshot.selectedMarkupId,
    selectedDrawingId: snapshot.selectedDrawingId,
    selectedImageId: snapshot.selectedImageId,
  }
}

function cloneEdit(edit: TextEdit): TextEdit {
  return {
    ...edit,
    transform: [...edit.transform],
    appearance: edit.appearance
      ? {
          ...edit.appearance,
          color: edit.appearance.color ? { ...edit.appearance.color } : undefined,
        }
      : undefined,
  }
}

function cloneMarkup(markup: TextMarkup): TextMarkup {
  return {
    ...markup,
    pdfRects: markup.pdfRects.map((rect) => ({ ...rect })),
  }
}

function cloneDrawing(drawing: DrawingAnnotation): DrawingAnnotation {
  return {
    ...drawing,
    points: drawing.points.map((point) => ({ x: point.x, y: point.y })),
  }
}

function cloneImage(image: ImageAnnotation): ImageAnnotation {
  return { ...image, bytes: clonePdfBytes(image.bytes) }
}

function applySelection(snapshot: DocumentSnapshot, patch: SelectionPatch): DocumentSnapshot {
  return {
    ...snapshot,
    selectedMarkupId:
      patch.selectedMarkupId !== undefined ? patch.selectedMarkupId : snapshot.selectedMarkupId,
    selectedDrawingId:
      patch.selectedDrawingId !== undefined
        ? patch.selectedDrawingId
        : snapshot.selectedDrawingId,
    selectedImageId:
      patch.selectedImageId !== undefined ? patch.selectedImageId : snapshot.selectedImageId,
  }
}

function selectionChanges(snapshot: DocumentSnapshot, patch: SelectionPatch): boolean {
  return (
    (patch.selectedMarkupId !== undefined &&
      patch.selectedMarkupId !== snapshot.selectedMarkupId) ||
    (patch.selectedDrawingId !== undefined &&
      patch.selectedDrawingId !== snapshot.selectedDrawingId) ||
    (patch.selectedImageId !== undefined && patch.selectedImageId !== snapshot.selectedImageId)
  )
}

function gestureSelectionChanges(gesture: Gesture | null, patch: SelectionPatch): boolean {
  if (!gesture) {
    return false
  }
  return selectionChanges(gesture.live, patch) || selectionChanges(gesture.baseline, patch)
}

function sameSelection(left: DocumentSnapshot, right: DocumentSnapshot): boolean {
  return (
    left.selectedMarkupId === right.selectedMarkupId &&
    left.selectedDrawingId === right.selectedDrawingId &&
    left.selectedImageId === right.selectedImageId
  )
}

function sameContent(left: DocumentSnapshot, right: DocumentSnapshot): boolean {
  return (
    sameEdits(left.edits, right.edits) &&
    sameMarkups(left.markups, right.markups) &&
    sameDrawings(left.drawings, right.drawings) &&
    sameImages(left.images, right.images)
  )
}

function sameEdits(left: readonly TextEdit[], right: readonly TextEdit[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) {
      return false
    }
    if (
      a.id !== b.id ||
      a.pageNumber !== b.pageNumber ||
      a.originalText !== b.originalText ||
      a.editedText !== b.editedText ||
      a.pdfX !== b.pdfX ||
      a.pdfY !== b.pdfY ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.fontName !== b.fontName ||
      !sameNumbers(a.transform, b.transform) ||
      !sameAppearance(a.appearance, b.appearance)
    ) {
      return false
    }
  }
  return true
}

function sameAppearance(
  left: TextEdit['appearance'],
  right: TextEdit['appearance'],
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return !left && !right
  }
  return (
    left.pdfFontName === right.pdfFontName &&
    left.fallbackFamily === right.fallbackFamily &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.fontSize === right.fontSize &&
    left.horizontalScale === right.horizontalScale &&
    left.ascent === right.ascent &&
    left.descent === right.descent &&
    left.vertical === right.vertical &&
    left.color?.r === right.color?.r &&
    left.color?.g === right.color?.g &&
    left.color?.b === right.color?.b &&
    !!left.color === !!right.color
  )
}

function sameMarkups(left: readonly TextMarkup[], right: readonly TextMarkup[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) {
      return false
    }
    if (
      a.id !== b.id ||
      a.kind !== b.kind ||
      a.pageNumber !== b.pageNumber ||
      a.text !== b.text ||
      a.color !== b.color ||
      a.opacity !== b.opacity ||
      a.thickness !== b.thickness ||
      !sameRects(a.pdfRects, b.pdfRects)
    ) {
      return false
    }
  }
  return true
}

function sameDrawings(
  left: readonly DrawingAnnotation[],
  right: readonly DrawingAnnotation[],
): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) {
      return false
    }
    if (
      a.id !== b.id ||
      a.kind !== b.kind ||
      a.pageNumber !== b.pageNumber ||
      a.color !== b.color ||
      a.opacity !== b.opacity ||
      a.thickness !== b.thickness ||
      !samePoints(a.points, b.points)
    ) {
      return false
    }
  }
  return true
}

function sameImages(left: readonly ImageAnnotation[], right: readonly ImageAnnotation[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) {
      return false
    }
    if (
      a.id !== b.id ||
      a.pageNumber !== b.pageNumber ||
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.originalWidth !== b.originalWidth ||
      a.originalHeight !== b.originalHeight ||
      a.format !== b.format ||
      !sameBytes(a.bytes, b.bytes)
    ) {
      return false
    }
  }
  return true
}

function sameRects(
  left: readonly { x: number; y: number; width: number; height: number }[],
  right: readonly { x: number; y: number; width: number; height: number }[],
): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) {
      return false
    }
  }
  return true
}

function samePoints(
  left: readonly { x: number; y: number }[],
  right: readonly { x: number; y: number }[],
): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b || a.x !== b.x || a.y !== b.y) {
      return false
    }
  }
  return true
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) {
    return true
  }
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
