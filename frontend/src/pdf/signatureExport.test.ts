import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  StandardFonts,
} from 'pdf-lib'
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { deflate } from 'pako'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessTokenProvider } from '../api/accessToken.ts'
import { saveDocumentVersion } from '../api/saveDocumentVersion.ts'
import { pdfRectToViewportBox, pdfPointToViewport, type PdfRect } from './coordinates.ts'
import {
  commitDocument,
  createDocumentHistory,
  emptyDocumentSnapshot,
  endGesture,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  resetHistory,
  undoHistory,
  withPageOperation,
  type DocumentHistory,
  type DocumentSnapshot,
} from './documentHistory.ts'
import { exportDocumentSnapshot } from './exportPdf.ts'
import type { ImageAnnotation } from './images.ts'
import { createNewText } from './newTexts.ts'
import { duplicatePage, rotatePage } from './pageOperations.ts'
import {
  dragSignature,
  placeSignature,
  signatureAspectRatio,
  signatureRect,
  startSignatureGesture,
  withPlacedSignature,
  withSignatureBox,
  type SignatureAnnotation,
} from './placedSignatures.ts'
import type { Signature } from './signatures.ts'
import type { TextEdit } from './textEdits.ts'

GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href

const CSS_PER_POINT = 96 / 72
const PAGE = { width: 300, height: 400 }
const INK = { r: 20, g: 30, b: 140 }

/** 6×3 pixels: the left half is ink, the right half is fully transparent. */
const SIGNATURE_A: Signature = {
  id: 'sig-a',
  dataUrl: pngDataUrl(
    rgbaPng(6, 3, (x) => (x < 3 ? [INK.r, INK.g, INK.b, 255] : [0, 0, 0, 0])),
  ),
  width: 120,
  height: 60,
}

/** A different signature: 4×4 pixels with a transparent top half. */
const SIGNATURE_B: Signature = {
  id: 'sig-b',
  dataUrl: pngDataUrl(rgbaPng(4, 4, (_x, y) => (y >= 2 ? [200, 0, 0, 255] : [0, 0, 0, 0]))),
  width: 80,
  height: 80,
}

/** PDF.js adds a graphics state that clears any soft-mask group around each image paint. */
const ALLOWED_SIGNATURE_OPS = new Set<number>([
  OPS.save,
  OPS.restore,
  OPS.transform,
  OPS.paintImageXObject,
  OPS.dependency,
  OPS.setGState,
])

describe('exporting with no signatures', () => {
  it('returns an identical copy when there are no overlays', async () => {
    const original = await basePdf()
    const snapshot = snapshotOf(original)
    const exported = await exportDocumentSnapshot(snapshot)
    expect(exported).not.toBe(snapshot.pdfBytes)
    expect(Array.from(exported)).toEqual(Array.from(original))
    expect(await imagePaints(exported, 1)).toEqual([])
  })

  it('still paints inserted images exactly as before', async () => {
    const snapshot = { ...snapshotOf(await basePdf()), images: [insertedImage()] }
    const exported = await exportDocumentSnapshot(snapshot)
    const paints = await imagePaints(exported, 1)
    expect(paints).toHaveLength(1)
    expectRect(paints[0]?.rect, { x: 12, y: 18, width: 40, height: 20 })
    expect(pageImageXObjects(await PDFDocument.load(exported), 0)).toHaveLength(1)
  })
})

describe('exporting one signature', () => {
  it('embeds the signature as an image XObject at its PDF-space box', async () => {
    const original = await basePdf()
    const placed = place(SIGNATURE_A, 1, { x: 150, y: 200 })
    const snapshot = withPlacedSignature(snapshotOf(original), placed)

    const exported = await exportDocumentSnapshot(snapshot)

    const doc = await PDFDocument.load(exported)
    expect(doc.getPageCount()).toBe(2)
    const [xobject, ...others] = pageImageXObjects(doc, 0)
    expect(others).toHaveLength(0)
    expect(xobject).toMatchObject({ width: 6, height: 3, hasSoftMask: true })
    expect(pageImageXObjects(doc, 1)).toHaveLength(0)

    const paints = await imagePaints(exported, 1)
    expect(paints).toHaveLength(1)
    expectRect(paints[0]?.rect, signatureRect(placed))
    expect(await imagePaints(exported, 2)).toEqual([])
  })

  it('does not change the working PDF bytes', async () => {
    const original = await basePdf()
    const before = Array.from(original)
    const snapshot = withPlacedSignature(snapshotOf(original), place(SIGNATURE_A, 1))
    await exportDocumentSnapshot(snapshot)
    expect(Array.from(snapshot.pdfBytes)).toEqual(before)
    expect(await imagePaints(snapshot.pdfBytes, 1)).toEqual([])
  })

  it('keeps the transparent background and adds no filled rectangle', async () => {
    const original = await basePdf()
    const placed = place(SIGNATURE_A, 1, { x: 150, y: 200 })
    const exported = await exportDocumentSnapshot(
      withPlacedSignature(snapshotOf(original), placed),
    )

    const pixels = await paintedImagePixels(exported, 1)
    expect(pixels.width).toBe(6)
    expect(pixels.height).toBe(3)
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const [r, g, b, a] = pixels.at(x, y)
        if (x < 3) {
          expect([r, g, b, a]).toEqual([INK.r, INK.g, INK.b, 255])
        } else {
          expect(a).toBe(0)
        }
      }
    }

    const added = await addedOperators(original, exported, 1)
    expect(added.filter((fn) => !ALLOWED_SIGNATURE_OPS.has(fn))).toEqual([])
  })

  it('uses the moved and resized box, keeping the aspect ratio', async () => {
    const original = await basePdf()
    const viewport = await viewportOf(original, 1, 1.5)
    const placed = place(SIGNATURE_A, 1, { x: 150, y: 200 })

    const view = pdfRectToViewportBox(viewport, signatureRect(placed))
    const move = startSignatureGesture('move', placed, { x: view.left + 4, y: view.top + 4 }, viewport)
    const moved = { ...placed, ...dragSignature(move, { x: view.left - 30, y: view.top + 60 }, viewport) }
    const movedView = pdfRectToViewportBox(viewport, signatureRect(moved))
    const handle = { x: movedView.left + movedView.width, y: movedView.top + movedView.height }
    const resize = startSignatureGesture('resize', moved, handle, viewport)
    const box = dragSignature(resize, { x: handle.x + 90, y: handle.y + 20 }, viewport)
    const snapshot = withSignatureBox(withPlacedSignature(snapshotOf(original), placed), placed.id, box)

    const exported = await exportDocumentSnapshot(snapshot)

    const [paint] = await imagePaints(exported, 1)
    expect(box.width).toBeGreaterThan(placed.width)
    expect(box.pdfX).not.toBeCloseTo(placed.pdfX)
    expectRect(paint?.rect, signatureRect(box))
    expect((paint?.rect.width ?? 0) / (paint?.rect.height ?? 1)).toBeCloseTo(
      signatureAspectRatio(placed),
      6,
    )
  })

  it('lands where the editor shows it on a rotated page, turned with the page', async () => {
    const rotated = await rotatePage(await basePdf(), 0, 90)
    const viewport = await viewportOf(rotated, 1, 1)
    expect(viewport.rotation).toBe(90)
    const placed = place(SIGNATURE_A, 1, { x: 100, y: 250 })

    const exported = await exportDocumentSnapshot(withPlacedSignature(snapshotOf(rotated), placed))

    const doc = await PDFDocument.load(exported)
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    const [paint] = await imagePaints(exported, 1)
    expectRect(paint?.rect, signatureRect(placed))

    const exportedViewport = await viewportOf(exported, 1, 1)
    const editorBox = pdfRectToViewportBox(viewport, signatureRect(placed))
    const shown = viewportCorners(exportedViewport, paint?.matrix ?? [])
    expectClose(shown.left, editorBox.left)
    expectClose(shown.top, editorBox.top)
    expectClose(shown.width, editorBox.width)
    expectClose(shown.height, editorBox.height)
    // CSS rotate(90deg) in the editor puts the image's top-left corner at the box's top-right.
    const imageTopLeft = pdfPointToViewport(exportedViewport, apply(paint?.matrix ?? [], 0, 1))
    expectClose(imageTopLeft.x, editorBox.left + editorBox.width)
    expectClose(imageTopLeft.y, editorBox.top)
  })

  it('paints above edited text and below created text, as in the editor', async () => {
    const original = await basePdf()
    const placed = place(SIGNATURE_A, 1, { x: 60, y: 350 })
    const created = createNewText({
      pageNumber: 1,
      pdfX: 40,
      pdfY: 340,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      text: 'Signed',
    })
    const snapshot: DocumentSnapshot = {
      ...withPlacedSignature(snapshotOf(original), placed),
      edits: [textEdit()],
      texts: [created],
    }
    const exported = await exportDocumentSnapshot(snapshot)
    const ops = await operatorList(exported, 1)
    const imageAt = ops.fnArray.indexOf(OPS.paintImageXObject)
    const texts = ops.fnArray.flatMap((fn, index) => (fn === OPS.showText ? [index] : []))
    expect(texts.length).toBeGreaterThanOrEqual(3)
    expect(imageAt).toBeGreaterThan(texts[texts.length - 2] ?? Infinity)
    expect(imageAt).toBeLessThan(texts[texts.length - 1] ?? -1)
  })

  it('rejects a signature on a page that is not in the PDF', async () => {
    const snapshot = withPlacedSignature(snapshotOf(await basePdf()), place(SIGNATURE_A, 3))
    await expect(exportDocumentSnapshot(snapshot)).rejects.toThrow('page 3')
  })
})

describe('exporting several signatures', () => {
  it('embeds every placement at its own box on its own page', async () => {
    const original = await basePdf()
    const first = place(SIGNATURE_A, 1, { x: 80, y: 100 })
    const second = place(SIGNATURE_A, 1, { x: 200, y: 300 })
    const onPageTwo = place(SIGNATURE_A, 2, { x: 150, y: 200 })
    const different = place(SIGNATURE_B, 2, { x: 100, y: 80 })
    let snapshot = snapshotOf(original)
    for (const placed of [first, second, onPageTwo, different]) {
      snapshot = withPlacedSignature(snapshot, placed)
    }
    snapshot = withSignatureBox(snapshot, second.id, {
      ...signatureRect(second),
      pdfX: second.pdfX - 20,
      pdfY: second.pdfY,
      width: second.width * 0.75,
      height: second.height * 0.75,
    })
    const resizedSecond = snapshot.signatures[1] as SignatureAnnotation

    const exported = await exportDocumentSnapshot(snapshot)

    const pageOne = await imagePaints(exported, 1)
    expect(pageOne).toHaveLength(2)
    expectRect(pageOne[0]?.rect, signatureRect(first))
    expectRect(pageOne[1]?.rect, signatureRect(resizedSecond))

    const pageTwo = await imagePaints(exported, 2)
    expect(pageTwo).toHaveLength(2)
    expectRect(pageTwo[0]?.rect, signatureRect(onPageTwo))
    expectRect(pageTwo[1]?.rect, signatureRect(different))

    const doc = await PDFDocument.load(exported)
    const pageOneImages = pageImageXObjects(doc, 0)
    const pageTwoImages = pageImageXObjects(doc, 1)
    expect(new Set(pageOneImages.map((image) => image.ref)).size).toBe(1)
    expect(pageTwoImages.map((image) => `${image.width}x${image.height}`).sort()).toEqual([
      '4x4',
      '6x3',
    ])
    expect([...pageOneImages, ...pageTwoImages].every((image) => image.hasSoftMask)).toBe(true)
    expect(new Set([...pageOneImages, ...pageTwoImages].map((image) => image.ref)).size).toBe(2)
  })
})

describe('export and save do not duplicate signatures', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let uploads: Uint8Array[] = []

  beforeEach(() => {
    uploads = []
    vi.stubGlobal('fetch', fetchMock)
    setAccessTokenProvider(() => Promise.resolve('token'))
    fetchMock.mockImplementation(async (_url, init) => {
      const file = (init?.body as FormData).get('file') as File
      uploads.push(new Uint8Array(await file.arrayBuffer()))
      return Response.json(
        {
          id: `version-${uploads.length + 1}`,
          documentId: 'doc-1',
          version: uploads.length + 1,
          fileUrl: `/documents/doc-1/versions/${uploads.length + 1}/file`,
          createdAt: new Date().toISOString(),
        },
        { status: 201 },
      )
    })
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    setAccessTokenProvider(null)
  })

  it('exports the same single signature every time', async () => {
    let history = createDocumentHistory(snapshotOf(await basePdf()))
    const placed = place(SIGNATURE_A, 1)
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))

    const first = await exportView(history)
    const second = await exportView(history)
    expect(await imagePaints(first, 1)).toHaveLength(1)
    expect(await imagePaints(second, 1)).toHaveLength(1)
    expect(history.present.snapshot.signatures).toEqual([placed])
  })

  it('saves a new version containing the signature and reloads it from the PDF alone', async () => {
    const original = await basePdf()
    const versionOne = Array.from(original)
    let history = createDocumentHistory(snapshotOf(original))
    const placed = place(SIGNATURE_A, 1, { x: 120, y: 90 })
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))
    expect(isHistoryDirty(history)).toBe(true)

    history = await save(history)
    expect(isHistoryDirty(history)).toBe(false)
    expect(uploads).toHaveLength(1)
    const saved = uploads[0] as Uint8Array
    const savedPaints = await imagePaints(saved, 1)
    expect(savedPaints).toHaveLength(1)
    expectRect(savedPaints[0]?.rect, signatureRect(placed))
    expect(Array.from(original)).toEqual(versionOne)
    expect(await imagePaints(original, 1)).toEqual([])

    const reopened = resetHistory(history, snapshotOf(saved))
    expect(reopened.present.snapshot.signatures).toEqual([])
    const paints = await imagePaints(reopened.present.snapshot.pdfBytes, 1)
    expect(paints).toHaveLength(1)
    expectRect(paints[0]?.rect, signatureRect(placed))
    const pixels = await paintedImagePixels(reopened.present.snapshot.pdfBytes, 1)
    expect(pixels.at(0, 0)).toEqual([INK.r, INK.g, INK.b, 255])
    expect(pixels.at(5, 0)[3]).toBe(0)

    expect(await imagePaints(await exportView(reopened), 1)).toHaveLength(1)
  })

  it('does not embed twice when saving after export or exporting after save', async () => {
    let history = createDocumentHistory(snapshotOf(await basePdf()))
    history = commitDocument(history, (snapshot) =>
      withPlacedSignature(snapshot, place(SIGNATURE_A, 1)),
    )

    const exported = await exportView(history)
    history = await save(history)
    const exportedAfterSave = await exportView(history)
    history = commitDocument(history, (snapshot) =>
      withPlacedSignature(snapshot, place(SIGNATURE_A, 2)),
    )
    history = await save(history)

    expect(await imagePaints(exported, 1)).toHaveLength(1)
    expect(await imagePaints(uploads[0] as Uint8Array, 1)).toHaveLength(1)
    expect(await imagePaints(exportedAfterSave, 1)).toHaveLength(1)
    const second = uploads[1] as Uint8Array
    expect(await imagePaints(second, 1)).toHaveLength(1)
    expect(await imagePaints(second, 2)).toHaveLength(1)
    expect(isHistoryDirty(history)).toBe(false)
  })

  it('bakes once through a page operation, then saves and exports without a second copy', async () => {
    let history = createDocumentHistory(snapshotOf(await basePdf()))
    const placed = place(SIGNATURE_A, 1, { x: 90, y: 120 })
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, placed))

    history = await runPageOperation(history, (bytes) => duplicatePage(bytes, 0))
    expect(history.present.snapshot.signatures).toEqual([])
    expect(await imagePaints(history.present.snapshot.pdfBytes, 1)).toHaveLength(1)
    expect(await imagePaints(history.present.snapshot.pdfBytes, 2)).toHaveLength(1)

    history = await runPageOperation(history, (bytes) => rotatePage(bytes, 0, 90))
    const exported = await exportView(history)
    history = await save(history)
    for (const bytes of [exported, uploads[0] as Uint8Array]) {
      const pageOne = await imagePaints(bytes, 1)
      expect(pageOne).toHaveLength(1)
      expectRect(pageOne[0]?.rect, signatureRect(placed))
      expect(await imagePaints(bytes, 2)).toHaveLength(1)
      expect(await imagePaints(bytes, 3)).toHaveLength(0)
    }

    const extra = place(SIGNATURE_B, 3)
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, extra))
    const withExtra = await exportView(history)
    expect(await imagePaints(withExtra, 1)).toHaveLength(1)
    expect(await imagePaints(withExtra, 2)).toHaveLength(1)
    expect(await imagePaints(withExtra, 3)).toHaveLength(1)

    history = undoHistory(undoHistory(undoHistory(history)))
    expect(history.present.snapshot.signatures).toEqual([placed])
    const restored = await exportView(history)
    expect(await imagePaints(restored, 1)).toHaveLength(1)
    expect(await imagePaints(restored, 2)).toHaveLength(0)
  })

  it('exports only what undo and redo leave in place', async () => {
    let history = createDocumentHistory(snapshotOf(await basePdf()))
    const first = place(SIGNATURE_A, 1, { x: 80, y: 100 })
    const second = place(SIGNATURE_B, 1, { x: 200, y: 300 })
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, first))
    history = commitDocument(history, (snapshot) => withPlacedSignature(snapshot, second))

    history = undoHistory(history)
    const afterUndo = await imagePaints(await exportView(history), 1)
    expect(afterUndo).toHaveLength(1)
    expectRect(afterUndo[0]?.rect, signatureRect(first))

    history = undoHistory(history)
    expect(await imagePaints(await exportView(history), 1)).toHaveLength(0)

    history = redoHistory(redoHistory(history))
    expect(await imagePaints(await exportView(history), 1)).toHaveLength(2)
  })

  async function save(history: DocumentHistory): Promise<DocumentHistory> {
    const settled = endGesture(history)
    const exported = await exportDocumentSnapshot(settled.present.snapshot)
    await saveDocumentVersion('doc-1', exported)
    return markHistorySaved(settled)
  }
})

async function exportView(history: DocumentHistory): Promise<Uint8Array> {
  return exportDocumentSnapshot(history.gesture?.live ?? history.present.snapshot)
}

async function runPageOperation(
  history: DocumentHistory,
  operate: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<DocumentHistory> {
  const settled = endGesture(history)
  const base = await exportDocumentSnapshot(settled.present.snapshot)
  const next = await operate(base)
  return commitDocument(settled, () => withPageOperation(next), { pdfChanged: true })
}

function place(
  signature: Signature,
  pageNumber: number,
  center = { x: 150, y: 200 },
): SignatureAnnotation {
  return placeSignature({ signature, pageNumber, center, page: PAGE })
}

function snapshotOf(pdfBytes: Uint8Array): DocumentSnapshot {
  return { ...emptyDocumentSnapshot(), pdfBytes }
}

async function basePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const label of ['Page one', 'Page two']) {
    const page = pdf.addPage([PAGE.width, PAGE.height])
    page.drawText(label, { x: 36, y: 340, size: 14, font })
  }
  return pdf.save()
}

function insertedImage(): ImageAnnotation {
  const bytes = pngBytes(SIGNATURE_A.dataUrl)
  return {
    id: 'image-1',
    pageNumber: 1,
    x: 12,
    y: 18,
    width: 40,
    height: 20,
    originalWidth: 6,
    originalHeight: 3,
    format: 'png',
    bytes,
  }
}

function textEdit(): TextEdit {
  return {
    id: '1:0',
    pageNumber: 1,
    originalText: 'Page one',
    editedText: 'Page 1',
    pdfX: 36,
    pdfY: 340,
    width: 56,
    height: 14,
    fontName: 'Helvetica',
    transform: [14, 0, 0, 14, 36, 340],
  }
}

type Matrix = number[]

type ImagePaint = { objId: string; matrix: Matrix; rect: PdfRect }

async function withPdfJs<T>(bytes: Uint8Array, read: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const pdf = await getDocument({ data: bytes.slice() }).promise
  try {
    return await read(pdf)
  } finally {
    await pdf.destroy()
  }
}

async function operatorList(bytes: Uint8Array, pageNumber: number) {
  return withPdfJs(bytes, async (pdf) => (await pdf.getPage(pageNumber)).getOperatorList())
}

async function viewportOf(bytes: Uint8Array, pageNumber: number, zoom: number): Promise<PageViewport> {
  return withPdfJs(bytes, async (pdf) =>
    (await pdf.getPage(pageNumber)).getViewport({ scale: zoom * CSS_PER_POINT }),
  )
}

/** Image paints on a page with the user-space matrix that maps the unit image square. */
async function imagePaints(bytes: Uint8Array, pageNumber: number): Promise<ImagePaint[]> {
  const ops = await operatorList(bytes, pageNumber)
  const stack: Matrix[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const paints: ImagePaint[] = []
  for (let index = 0; index < ops.fnArray.length; index += 1) {
    const fn = ops.fnArray[index]
    const args = (ops.argsArray[index] ?? []) as unknown[]
    if (fn === OPS.save) {
      stack.push(ctm)
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, args as number[])
    } else if (fn === OPS.paintImageXObject) {
      paints.push({ objId: String(args[0]), matrix: ctm, rect: unitSquareBounds(ctm) })
    } else if (fn === OPS.paintImageXObjectRepeat) {
      const [objId, scaleX, scaleY, positions] = args as [string, number, number, number[]]
      for (let at = 0; at < positions.length; at += 2) {
        const matrix = multiply(ctm, [scaleX, 0, 0, scaleY, positions[at] ?? 0, positions[at + 1] ?? 0])
        paints.push({ objId, matrix, rect: unitSquareBounds(matrix) })
      }
    }
  }
  return paints
}

/** Operator codes present in `after` beyond those in `before`, in order. */
async function addedOperators(before: Uint8Array, after: Uint8Array, pageNumber: number): Promise<number[]> {
  const original = (await operatorList(before, pageNumber)).fnArray
  const next = (await operatorList(after, pageNumber)).fnArray
  const remaining = new Map<number, number>()
  for (const fn of original) {
    remaining.set(fn, (remaining.get(fn) ?? 0) + 1)
  }
  return next.filter((fn) => {
    const count = remaining.get(fn) ?? 0
    if (count > 0) {
      remaining.set(fn, count - 1)
      return false
    }
    return true
  })
}

/** RGBA pixels of the first image painted on a page, as PDF.js decodes it with its soft mask. */
async function paintedImagePixels(
  bytes: Uint8Array,
  pageNumber: number,
): Promise<{ width: number; height: number; at: (x: number, y: number) => number[] }> {
  return withPdfJs(bytes, async (pdf) => {
    const page = await pdf.getPage(pageNumber)
    const ops = await page.getOperatorList()
    const index = ops.fnArray.indexOf(OPS.paintImageXObject)
    const objId = String((ops.argsArray[index] as unknown[])[0])
    const store = objId.startsWith('g_') ? page.commonObjs : page.objs
    const image = await new Promise<{ width: number; height: number; kind: number; data: Uint8ClampedArray }>(
      (resolve) => {
        store.get(objId, resolve)
      },
    )
    expect(image.kind).toBe(3)
    return {
      width: image.width,
      height: image.height,
      at: (x: number, y: number) => {
        const offset = (y * image.width + x) * 4
        return Array.from(image.data.slice(offset, offset + 4))
      },
    }
  })
}

function pageImageXObjects(
  doc: PDFDocument,
  pageIndex: number,
): Array<{ ref: string; width: number; height: number; hasSoftMask: boolean }> {
  const resources = doc.getPage(pageIndex).node.Resources()
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xobjects) {
    return []
  }
  return xobjects.entries().flatMap(([, value]) => {
    const stream = doc.context.lookup(value)
    if (!(stream instanceof PDFStream) || stream.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) {
      return []
    }
    return [
      {
        ref: value instanceof PDFRef ? value.toString() : '',
        width: stream.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
        height: stream.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(),
        hasSoftMask: stream.dict.get(PDFName.of('SMask')) instanceof PDFRef,
      },
    ]
  })
}

function multiply(outer: Matrix, inner: Matrix): Matrix {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = outer
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = inner
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ]
}

function apply(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

function unitSquareBounds(matrix: Matrix): PdfRect {
  const corners = [apply(matrix, 0, 0), apply(matrix, 1, 0), apply(matrix, 1, 1), apply(matrix, 0, 1)]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function viewportCorners(viewport: PageViewport, matrix: Matrix) {
  const corners = [apply(matrix, 0, 0), apply(matrix, 1, 0), apply(matrix, 1, 1), apply(matrix, 0, 1)].map(
    (point) => pdfPointToViewport(viewport, point),
  )
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function expectRect(actual: PdfRect | undefined, expected: PdfRect) {
  expect(actual).toBeDefined()
  expectClose(actual?.x ?? NaN, expected.x)
  expectClose(actual?.y ?? NaN, expected.y)
  expectClose(actual?.width ?? NaN, expected.width)
  expectClose(actual?.height ?? NaN, expected.height)
}

function expectClose(actual: number, expected: number) {
  expect(actual).toBeCloseTo(expected, 3)
}

function pngBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function pngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/** An 8-bit RGBA PNG. */
function rgbaPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      raw.set(pixel(x, y), row + 1 + x * 4)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflate(raw)),
    pngChunk('IEND', new Uint8Array()),
  ])
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([Uint8Array.from(type, (char) => char.charCodeAt(0)), data])
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(typed, 4)
  view.setUint32(8 + data.length, crc32(typed))
  return chunk
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
