import {
  captureSignatureImage,
  type SignatureCaptureCanvas,
  type SignaturePad,
  type SignaturePadSize,
} from './signaturePad.ts'

/**
 * A handwritten signature created in this editor session.
 *
 * `dataUrl` is a PNG with a transparent background, cropped to the ink.
 * `width` and `height` are the cropped size in CSS pixels as drawn, so a
 * placement can keep the aspect ratio. The signature lives in frontend memory
 * only: it is not uploaded, saved, or written into the PDF.
 */
export type Signature = {
  id: string
  dataUrl: string
  width: number
  height: number
}

/**
 * Signature state for one editor session. It is separate from document
 * history, so opening, cancelling, or confirming never adds an undo step or
 * marks the document dirty.
 */
export type SignatureSession = {
  signature: Signature | null
  dialogOpen: boolean
}

export function createSignatureSession(): SignatureSession {
  return { signature: null, dialogOpen: false }
}

export function openSignatureDialog(session: SignatureSession): SignatureSession {
  return session.dialogOpen ? session : { ...session, dialogOpen: true }
}

/** Closes the dialog and keeps any signature confirmed earlier. */
export function cancelSignatureDialog(session: SignatureSession): SignatureSession {
  return session.dialogOpen ? { ...session, dialogOpen: false } : session
}

/** Stores the new signature, replacing any earlier one, and closes the dialog. */
export function confirmSignature(session: SignatureSession, signature: Signature): SignatureSession {
  return { ...session, signature, dialogOpen: false }
}

export function captureSignature(
  pad: SignaturePad,
  size: SignaturePadSize,
  createCanvas: () => SignatureCaptureCanvas,
): Signature | null {
  const image = captureSignatureImage(pad, size, createCanvas)
  if (!image) {
    return null
  }
  return { id: crypto.randomUUID(), ...image }
}

export function isSignatureCancelKey(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape'
}
