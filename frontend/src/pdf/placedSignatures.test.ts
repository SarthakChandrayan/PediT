import { PDFDocument } from 'pdf-lib'
import type { PageViewport } from 'pdfjs-dist'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { pageSizeFromViewport, pdfRectToViewportBox, viewportPointToPdf } from './coordinates.ts'
import {
  beginGesture,
  canRedoHistory,
  canUndoHistory,
  commitDocument,
  createDocumentHistory,
  emptyDocumentSnapshot,
  endGesture,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  selectInHistory,
  undoHistory,
  updateGesture,
  withPageOperation,
  type DocumentHistory,
  type DocumentSnapshot,
} from './documentHistory.ts'
import { exportDocumentSnapshot } from './exportPdf.ts'
import {
  dragSignature,
  MIN_SIGNATURE_LONG_SIDE,
  MIN_SIGNATURE_SHORT_SIDE,
  DEFAULT_SIGNATURE_MAX_HEIGHT,
  DEFAULT_SIGNATURE_MAX_WIDTH,
  placeSignature,
  pngDataUrlToBytes,
  signatureAspectRatio,
  signatureRect,
  startSignatureGesture,
  withoutSignature,
  withPlacedSignature,
  withSignatureBox,
  type PageSize,
  type SignatureAnnotation,
  type SignatureBox,
} from './placedSignatures.ts'
import {
  cancelSignatureDialog,
  confirmSignature,
  createSignatureSession,
  openSignatureDialog,
  type Signature,
} from './signatures.ts'

GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href

const CSS_PER_POINT = 96 / 72
const PAGE: PageSize = { width: 300, height: 400 }
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const SIGNATURE: Signature = {
  id: 'sig-a',
  dataUrl: `data:image/png;base64,${PNG_BASE64}`,
  width: 300,
  height: 100,
}

let viewports: (zoom: number, rotation?: number) => PageViewport

beforeAll(async () => {
  const doc = await PDFDocument.create()
  doc.addPage([PAGE.width, PAGE.height])
  const pdf = await getDocument({ data: await doc.save() }).promise
  const page = await pdf.getPage(1)
  viewports = (zoom, rotation = 0) =>
    page.getViewport({ scale: zoom * CSS_PER_POINT, rotation })
})

describe('placing a signature', () => {
  it('creates one overlay centered on the clicked PDF point', () => {
    const placed = placeSignature({
      signature: SIGNATURE,
      pageNumber: 2,
      center: { x: 150, y: 200 },
      page: PAGE,
    })
    expect(placed.pageNumber).toBe(2)
    expect(placed.pdfX + placed.width / 2).toBeCloseTo(150)
    expect(placed.pdfY + placed.height / 2).toBeCloseTo(200)
    expect(placed.dataUrl).toBe(SIGNATURE.dataUrl)
    expect(placed.id).toMatch(/^[0-9a-f-]{36}$/)

    const history = commitDocument(openHistory(), (snapshot) =>
      withPlacedSignature(snapshot, placed),
    )
    expect(history.present.snapshot.signatures).toEqual([placed])
    expect(history.present.snapshot.selectedSignatureId).toBe(placed.id)
    expect(history.past).toHaveLength(1)
  })

  it('converts a zoomed viewport click into PDF user space', () => {
    const viewport = viewports(2)
    const center = viewportPointToPdf(viewport, { x: 400, y: 200 })
    expect(center.x).toBeCloseTo(400 / (2 * CSS_PER_POINT))
    expect(center.y).toBeCloseTo(PAGE.height - 200 / (2 * CSS_PER_POINT))
    const placed = placeSignature({
      signature: SIGNATURE,
      pageNumber: 1,
      center,
      page: pageSizeFromViewport(viewport),
    })
    expect(placed.pdfX + placed.width / 2).toBeCloseTo(center.x)
    expect(placed.pdfY + placed.height / 2).toBeCloseTo(center.y)
  })

  it('keeps the captured aspect ratio', () => {
    for (const [width, height] of [
      [300, 100],
      [80, 240],
      [1000, 20],
      [37, 37],
    ] as const) {
      const placed = place({ ...SIGNATURE, width, height }, { x: 150, y: 200 })
      expect(placed.width / placed.height).toBeCloseTo(width / height, 6)
      expect(signatureAspectRatio(placed)).toBeCloseTo(width / height, 6)
    }
  })

  it('uses a sensible default size with min and max bounds', () => {
    const large = place({ ...SIGNATURE, width: 2000, height: 600 }, { x: 150, y: 200 })
    expect(large.width).toBeLessThanOrEqual(DEFAULT_SIGNATURE_MAX_WIDTH + 1e-9)
    expect(large.height).toBeLessThanOrEqual(DEFAULT_SIGNATURE_MAX_HEIGHT + 1e-9)

    const tiny = place({ ...SIGNATURE, width: 10, height: 5 }, { x: 150, y: 200 })
    expect(Math.max(tiny.width, tiny.height)).toBeGreaterThanOrEqual(MIN_SIGNATURE_LONG_SIDE - 1e-9)
    expect(Math.min(tiny.width, tiny.height)).toBeGreaterThanOrEqual(MIN_SIGNATURE_SHORT_SIDE - 1e-9)

    const smallPage = placeSignature({
      signature: SIGNATURE,
      pageNumber: 1,
      center: { x: 10, y: 10 },
      page: { width: 40, height: 20 },
    })
    expect(smallPage.width).toBeLessThanOrEqual(40)
    expect(smallPage.height).toBeLessThanOrEqual(20)
  })

  it('moves an edge placement inward so the whole signature is on the page', () => {
    for (const center of [
      { x: 0, y: 0 },
      { x: PAGE.width, y: PAGE.height },
      { x: -50, y: 500 },
      { x: 299, y: 1 },
    ]) {
      expectInsidePage(place(SIGNATURE, center))
    }
  })
})

describe('moving a signature', () => {
  it('follows the pointer on screen at every zoom and rotation', () => {
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    for (const zoom of [0.5, 1, 2, 3]) {
      for (const rotation of [0, 90]) {
        const viewport = viewports(zoom, rotation)
        const before = pdfRectToViewportBox(viewport, signatureRect(placed))
        const start = { x: before.left + 5, y: before.top + 5 }
        const gesture = startSignatureGesture('move', placed, start, viewport)
        const moved = dragSignature(gesture, { x: start.x + 12, y: start.y + 8 }, viewport)
        const after = pdfRectToViewportBox(viewport, signatureRect(moved))
        expect(after.left - before.left).toBeCloseTo(12, 6)
        expect(after.top - before.top).toBeCloseTo(8, 6)
        expect(moved.width).toBe(placed.width)
        expect(moved.height).toBe(placed.height)
      }
    }
  })

  it('converts viewport pixels to PDF points', () => {
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    const viewport = viewports(2)
    const gesture = startSignatureGesture('move', placed, { x: 300, y: 300 }, viewport)
    const moved = dragSignature(gesture, { x: 340, y: 280 }, viewport)
    const pixelsPerPoint = 2 * CSS_PER_POINT
    expect(moved.pdfX - placed.pdfX).toBeCloseTo(40 / pixelsPerPoint, 6)
    expect(moved.pdfY - placed.pdfY).toBeCloseTo(20 / pixelsPerPoint, 6)
  })

  it('stops at the page edges', () => {
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    const viewport = viewports(1)
    const gesture = startSignatureGesture('move', placed, { x: 200, y: 260 }, viewport)
    expectInsidePage(dragSignature(gesture, { x: -5000, y: -5000 }, viewport))
    expectInsidePage(dragSignature(gesture, { x: 5000, y: 5000 }, viewport))
  })
})

describe('resizing a signature', () => {
  it('keeps the aspect ratio and the on-screen top-left corner', () => {
    const placed = place(SIGNATURE, { x: 120, y: 200 })
    for (const rotation of [0, 90]) {
      const viewport = viewports(1.5, rotation)
      const before = pdfRectToViewportBox(viewport, signatureRect(placed))
      const handle = { x: before.left + before.width, y: before.top + before.height }
      const gesture = startSignatureGesture('resize', placed, handle, viewport)
      const resized = dragSignature(gesture, { x: handle.x + 60, y: handle.y + 10 }, viewport)
      const after = pdfRectToViewportBox(viewport, signatureRect(resized))
      expect(resized.width / resized.height).toBeCloseTo(signatureAspectRatio(placed), 6)
      expect(resized.width).toBeGreaterThan(placed.width)
      expect(after.left).toBeCloseTo(before.left, 6)
      expect(after.top).toBeCloseTo(before.top, 6)
    }
  })

  it('stops at the minimum size', () => {
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    const viewport = viewports(1)
    const before = pdfRectToViewportBox(viewport, signatureRect(placed))
    const handle = { x: before.left + before.width, y: before.top + before.height }
    const gesture = startSignatureGesture('resize', placed, handle, viewport)
    const resized = dragSignature(gesture, { x: -1000, y: -1000 }, viewport)
    expect(resized.width).toBeCloseTo(MIN_SIGNATURE_LONG_SIDE, 6)
    expect(resized.width / resized.height).toBeCloseTo(signatureAspectRatio(placed), 6)
  })

  it('stays inside the page when dragged past the edge', () => {
    const placed = place(SIGNATURE, { x: 200, y: 100 })
    for (const rotation of [0, 90]) {
      const viewport = viewports(1, rotation)
      const before = pdfRectToViewportBox(viewport, signatureRect(placed))
      const handle = { x: before.left + before.width, y: before.top + before.height }
      const gesture = startSignatureGesture('resize', placed, handle, viewport)
      const resized = dragSignature(gesture, { x: 5000, y: 5000 }, viewport)
      expectInsidePage(resized)
      expect(resized.width / resized.height).toBeCloseTo(signatureAspectRatio(placed), 6)
    }
  })
})

describe('deleting and multiple signatures', () => {
  it('deletes only the chosen signature', () => {
    const first = place(SIGNATURE, { x: 100, y: 100 })
    const second = place(SIGNATURE, { x: 200, y: 300 }, 2)
    let snapshot = withPlacedSignature(withPlacedSignature(emptyDocumentSnapshot(), first), second)
    snapshot = withoutSignature(snapshot, first.id)
    expect(snapshot.signatures).toEqual([second])
    expect(snapshot.selectedSignatureId).toBe(second.id)
    snapshot = withoutSignature(snapshot, second.id)
    expect(snapshot.signatures).toEqual([])
    expect(snapshot.selectedSignatureId).toBeNull()
  })

  it('keeps each placed copy independent', () => {
    let history = openHistory()
    const onPageOne = place(SIGNATURE, { x: 100, y: 100 }, 1)
    const onPageTwo = place(SIGNATURE, { x: 100, y: 100 }, 2)
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, onPageOne))
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, onPageTwo))
    expect(onPageOne.id).not.toBe(onPageTwo.id)

    history = moveBy(history, onPageOne.id, { pdfX: 5, pdfY: 5, width: 60, height: 20 })
    const [first, second] = history.present.snapshot.signatures
    expect(first?.pdfX).toBe(5)
    expect(second).toEqual(onPageTwo)
  })

  it('keeps placed signatures when the reusable signature is replaced', () => {
    let session = confirmSignature(openSignatureDialog(createSignatureSession()), SIGNATURE)
    const placed = place(session.signature ?? SIGNATURE, { x: 150, y: 200 })

    const replacement: Signature = {
      id: 'sig-b',
      dataUrl: 'data:image/png;base64,REPLACED',
      width: 100,
      height: 100,
    }
    session = confirmSignature(openSignatureDialog(session), replacement)
    expect(session.signature).toBe(replacement)
    expect(placed.dataUrl).toBe(SIGNATURE.dataUrl)
    expect(placed.width / placed.height).toBeCloseTo(3, 6)

    const next = place(session.signature ?? SIGNATURE, { x: 150, y: 200 })
    expect(next.dataUrl).toBe(replacement.dataUrl)
  })
})

describe('signature history and dirty state', () => {
  it('adds, moves, resizes, and deletes as one undoable step each', () => {
    let history = openHistory()
    const placed = place(SIGNATURE, { x: 150, y: 200 })

    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))
    expect(history.past).toHaveLength(1)

    history = gesture(history, placed.id, 25, (step) => ({
      ...box(placed),
      pdfX: placed.pdfX + step,
      pdfY: placed.pdfY + step,
    }))
    expect(history.past).toHaveLength(2)
    const moved = signatureOf(history)

    history = gesture(history, placed.id, 25, (step) => ({
      ...box(moved),
      width: moved.width + step * 3,
      height: (moved.width + step * 3) / signatureAspectRatio(moved),
    }))
    expect(history.past).toHaveLength(3)
    const resized = signatureOf(history)

    history = commitDocument(history, (snapshot) => withoutSignature(snapshot, placed.id))
    expect(history.past).toHaveLength(4)
    expect(history.present.snapshot.signatures).toHaveLength(0)

    history = undoHistory(history)
    expect(signatureOf(history)).toEqual(resized)
    history = undoHistory(history)
    expect(signatureOf(history)).toEqual(moved)
    history = undoHistory(history)
    expect(signatureOf(history)).toEqual(placed)
    history = undoHistory(history)
    expect(history.present.snapshot.signatures).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)

    history = redoHistory(history)
    expect(signatureOf(history)).toEqual(placed)
    history = redoHistory(history)
    expect(signatureOf(history)).toEqual(moved)
    history = redoHistory(history)
    expect(signatureOf(history)).toEqual(resized)
    history = redoHistory(history)
    expect(history.present.snapshot.signatures).toHaveLength(0)
    expect(canRedoHistory(history)).toBe(false)
  })

  it('records one step per completed move or resize, not per pointer move', () => {
    let history = openHistory()
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))

    let dragging = beginGesture(history)
    for (let step = 1; step <= 60; step += 1) {
      dragging = updateGesture(dragging, (snapshot) =>
        withSignatureBox(snapshot, placed.id, { ...box(placed), pdfX: placed.pdfX + step / 10 }),
      )
      expect(dragging.past).toHaveLength(1)
    }
    history = endGesture(dragging)
    expect(history.past).toHaveLength(2)
  })

  it('records nothing for a click that does not move the signature', () => {
    let history = openHistory()
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    history = markHistorySaved(
      commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed)),
    )
    const clicked = endGesture(
      updateGesture(beginGesture(history), (snapshot) =>
        withSignatureBox(snapshot, placed.id, box(placed)),
      ),
    )
    expect(clicked.past).toHaveLength(history.past.length)
    expect(isHistoryDirty(clicked)).toBe(false)
  })

  it('does not record selection or deselection', () => {
    let history = openHistory()
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    history = markHistorySaved(
      commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed)),
    )
    const past = history.past.length
    history = selectInHistory(history, { selectedSignatureId: null })
    expect(history.present.snapshot.selectedSignatureId).toBeNull()
    history = selectInHistory(history, { selectedSignatureId: placed.id })
    expect(history.present.snapshot.selectedSignatureId).toBe(placed.id)
    history = selectInHistory(history, { selectedImageId: 'other', selectedSignatureId: null })
    expect(history.past).toHaveLength(past)
    expect(history.future).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)
  })

  it('opening the signature dialog or entering placement leaves the document clean', () => {
    const history = openHistory()
    let session = openSignatureDialog(createSignatureSession())
    session = cancelSignatureDialog(session)
    session = confirmSignature(openSignatureDialog(session), SIGNATURE)
    expect(session.signature).toBe(SIGNATURE)
    expect(isHistoryDirty(history)).toBe(false)
    expect(canUndoHistory(history)).toBe(false)
  })

  it('marks the document dirty for add, move, resize, and delete', () => {
    let history = openHistory()
    const placed = place(SIGNATURE, { x: 150, y: 200 })

    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))
    expect(isHistoryDirty(history)).toBe(true)

    history = markHistorySaved(history)
    history = moveBy(history, placed.id, { ...box(placed), pdfX: placed.pdfX + 10 })
    expect(isHistoryDirty(history)).toBe(true)

    history = markHistorySaved(history)
    const moved = signatureOf(history)
    history = moveBy(history, placed.id, {
      ...box(moved),
      width: moved.width * 1.5,
      height: moved.height * 1.5,
    })
    expect(isHistoryDirty(history)).toBe(true)

    history = markHistorySaved(history)
    history = commitDocument(history, (snapshot) => withoutSignature(snapshot, placed.id))
    expect(isHistoryDirty(history)).toBe(true)
  })

  it('bakes signatures into the PDF on a page operation, and undo restores them', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([PAGE.width, PAGE.height])
    let history = createDocumentHistory({ ...emptyDocumentSnapshot(), pdfBytes: await doc.save() })
    const placed = place(SIGNATURE, { x: 150, y: 200 })
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))

    const snapshot = history.present.snapshot
    const baked = await exportDocumentSnapshot(snapshot)
    expect(pdfHasImage(baked)).toBe(true)
    expect(pdfHasImage(snapshot.pdfBytes)).toBe(false)

    history = commitDocument(history, () => withPageOperation(baked), { pdfChanged: true })
    expect(history.present.snapshot.signatures).toHaveLength(0)
    history = undoHistory(history)
    expect(signatureOf(history)).toEqual(placed)
    expect(pdfHasImage(history.present.snapshot.pdfBytes)).toBe(false)
  })

  it('decodes the PNG data URL', () => {
    const bytes = pngDataUrlToBytes(SIGNATURE.dataUrl)
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(() => pngDataUrlToBytes('data:image/jpeg;base64,AAAA')).toThrow()
  })
})

function openHistory(): DocumentHistory {
  return createDocumentHistory()
}

function place(signature: Signature, center: { x: number; y: number }, pageNumber = 1): SignatureAnnotation {
  return placeSignature({ signature, pageNumber, center, page: PAGE })
}

function box(signature: SignatureAnnotation): SignatureBox {
  return {
    pdfX: signature.pdfX,
    pdfY: signature.pdfY,
    width: signature.width,
    height: signature.height,
  }
}

function signatureOf(history: DocumentHistory): SignatureAnnotation {
  const signature = history.present.snapshot.signatures[0]
  if (!signature) {
    throw new Error('expected a placed signature')
  }
  return signature
}

function moveBy(history: DocumentHistory, id: string, next: SignatureBox): DocumentHistory {
  return gesture(history, id, 1, () => next)
}

function gesture(
  history: DocumentHistory,
  id: string,
  steps: number,
  boxAt: (step: number) => SignatureBox,
): DocumentHistory {
  let dragging = beginGesture(history)
  for (let step = 1; step <= steps; step += 1) {
    dragging = updateGesture(dragging, (snapshot: DocumentSnapshot) =>
      withSignatureBox(snapshot, id, boxAt(step)),
    )
  }
  return endGesture(dragging)
}

function expectInsidePage(item: SignatureBox) {
  expect(item.pdfX).toBeGreaterThanOrEqual(-1e-9)
  expect(item.pdfY).toBeGreaterThanOrEqual(-1e-9)
  expect(item.pdfX + item.width).toBeLessThanOrEqual(PAGE.width + 1e-9)
  expect(item.pdfY + item.height).toBeLessThanOrEqual(PAGE.height + 1e-9)
}

function pdfHasImage(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes)
  return text.includes('/Subtype /Image') || text.includes('/Subtype/Image')
}
