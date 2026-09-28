import { describe, expect, it } from 'vitest'
import {
  canRedoHistory,
  canUndoHistory,
  commitDocument,
  createDocumentHistory,
  isHistoryDirty,
  markHistorySaved,
  type DocumentHistory,
} from './documentHistory.ts'
import {
  clearSignaturePad,
  emptySignaturePad,
  isSignaturePadEmpty,
  signaturePointerDown,
  signaturePointerMove,
  signaturePointerUp,
  type SignatureCaptureCanvas,
  type SignaturePad,
} from './signaturePad.ts'
import {
  cancelSignatureDialog,
  captureSignature,
  confirmSignature,
  createSignatureSession,
  isSignatureCancelKey,
  openSignatureDialog,
  type Signature,
  type SignatureSession,
} from './signatures.ts'

const SIZE = { width: 400, height: 200 }

describe('signature session', () => {
  it('opens the signature dialog without a signature', () => {
    const session = openSignatureDialog(createSignatureSession())
    expect(session.dialogOpen).toBe(true)
    expect(session.signature).toBeNull()
    expect(openSignatureDialog(session)).toBe(session)
  })

  it('cannot use a signature from an empty canvas', () => {
    const pad = emptySignaturePad()
    expect(isSignaturePadEmpty(pad)).toBe(true)
    expect(captureSignature(pad, SIZE, fakeCanvas)).toBeNull()
  })

  it('can use a signature once something is drawn', () => {
    const pad = scribble()
    expect(isSignaturePadEmpty(pad)).toBe(false)
    expect(captureSignature(pad, SIZE, fakeCanvas)).not.toBeNull()
  })

  it('clear returns the canvas to empty so it cannot be used', () => {
    const cleared = clearSignaturePad(scribble())
    expect(isSignaturePadEmpty(cleared)).toBe(true)
    expect(captureSignature(cleared, SIZE, fakeCanvas)).toBeNull()
  })

  it('confirm captures the drawing as a PNG signature and closes the dialog', () => {
    const open = openSignatureDialog(createSignatureSession())
    const signature = captureSignature(scribble(), SIZE, fakeCanvas)
    if (!signature) {
      throw new Error('expected a captured signature')
    }
    expect(signature.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(signature.dataUrl.startsWith('data:image/png')).toBe(true)
    expect(signature.width).toBeGreaterThan(0)
    expect(signature.height).toBeGreaterThan(0)

    const confirmed = confirmSignature(open, signature)
    expect(confirmed.dialogOpen).toBe(false)
    expect(confirmed.signature).toBe(signature)
  })

  it('cancel discards the drawing and keeps the earlier signature', () => {
    const earlier = sampleSignature('earlier')
    let session = confirmSignature(openSignatureDialog(createSignatureSession()), earlier)

    session = openSignatureDialog(session)
    scribble()
    session = cancelSignatureDialog(session)
    expect(session.dialogOpen).toBe(false)
    expect(session.signature).toBe(earlier)
    expect(cancelSignatureDialog(session)).toBe(session)
  })

  it('a new signature replaces the earlier one for the session', () => {
    const first = sampleSignature('first')
    const second = sampleSignature('second')
    let session = confirmSignature(openSignatureDialog(createSignatureSession()), first)
    session = confirmSignature(openSignatureDialog(session), second)
    expect(session.signature).toBe(second)
  })

  it('escape cancels the dialog', () => {
    expect(isSignatureCancelKey({ key: 'Escape' })).toBe(true)
    expect(isSignatureCancelKey({ key: 'Enter' })).toBe(false)
    expect(isSignatureCancelKey({ key: 'z' })).toBe(false)

    const open = openSignatureDialog(createSignatureSession())
    expect(cancelSignatureDialog(open).dialogOpen).toBe(false)
  })
})

describe('signature creation and document history', () => {
  it('does not add an undo step or mark a clean document dirty', () => {
    const history = createDocumentHistory()
    runSignatureFlows(createSignatureSession())

    expect(canUndoHistory(history)).toBe(false)
    expect(canRedoHistory(history)).toBe(false)
    expect(isHistoryDirty(history)).toBe(false)
    expect(history.past).toHaveLength(0)
  })

  it('leaves an edited document history untouched', () => {
    let history: DocumentHistory = createDocumentHistory()
    history = commitDocument(history, (snapshot) => ({
      ...snapshot,
      markups: [
        {
          id: 'h1',
          kind: 'highlight',
          pageNumber: 1,
          text: 'Hello',
          pdfRects: [{ x: 10, y: 20, width: 40, height: 12 }],
          color: '#ffe14a',
          opacity: 0.45,
          thickness: 0,
        },
      ],
    }))
    history = markHistorySaved(history)
    const before = history
    const epoch = history.present.epoch

    runSignatureFlows(createSignatureSession())

    expect(history).toBe(before)
    expect(history.present.epoch).toBe(epoch)
    expect(history.past).toHaveLength(1)
    expect(history.future).toHaveLength(0)
    expect(isHistoryDirty(history)).toBe(false)
  })
})

/** Open, draw, clear, cancel; then open, draw, confirm. */
function runSignatureFlows(start: SignatureSession): SignatureSession {
  let session = openSignatureDialog(start)
  clearSignaturePad(scribble())
  session = cancelSignatureDialog(session)
  session = openSignatureDialog(session)
  const signature = captureSignature(scribble(), SIZE, fakeCanvas)
  if (!signature) {
    throw new Error('expected a captured signature')
  }
  session = confirmSignature(session, signature)
  expect(session.signature).toBe(signature)
  expect(session.dialogOpen).toBe(false)
  return session
}

function scribble(): SignaturePad {
  let pad = signaturePointerDown(emptySignaturePad(), {
    pointerId: 1,
    button: 0,
    x: 40,
    y: 120,
    ...SIZE,
  })
  for (const [x, y] of [
    [60, 90],
    [80, 130],
    [110, 80],
    [140, 125],
  ] as const) {
    pad = signaturePointerMove(pad, { pointerId: 1, pressed: true, x, y, ...SIZE })
  }
  return signaturePointerUp(pad, 1)
}

function sampleSignature(id: string): Signature {
  return { id, dataUrl: 'data:image/png;base64,AAAA', width: 120, height: 40 }
}

function fakeCanvas(): SignatureCaptureCanvas {
  const noop = () => {}
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      strokeStyle: '',
      fillStyle: '',
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      quadraticCurveTo: noop,
      arc: noop,
      fill: noop,
      stroke: noop,
      setTransform: noop,
    }),
    toDataURL: (type) => `data:${type};base64,FAKE`,
  }
}
