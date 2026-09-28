import { createContext, useContext } from 'react'
import type { PdfPoint } from './coordinates.ts'
import type { PageSize, SignatureAnnotation, SignatureBox } from './placedSignatures.ts'
import type { Signature } from './signatures.ts'

export type PlacedSignatureApi = {
  signatures: readonly SignatureAnnotation[]
  selectedId: string | null
  /** The reusable signature being placed, or null when placement is off. */
  placing: Signature | null
  selectSignature: (id: string | null) => void
  /** Adds the signature being placed, centered on `center`, as one history step. */
  placeAt: (pageNumber: number, center: PdfPoint, page: PageSize) => void
  /** Live position or size. This does not record history. */
  updateSignature: (id: string, box: SignatureBox) => void
  beginSignatureGesture: () => void
  /** One history step when the box changed, otherwise none. */
  endSignatureGesture: () => void
  /** Drops the in-progress move or resize without recording history. */
  cancelSignatureGesture: () => void
}

export const PlacedSignatureContext = createContext<PlacedSignatureApi | null>(null)

export function usePlacedSignatures(): PlacedSignatureApi {
  const value = useContext(PlacedSignatureContext)
  if (!value) {
    throw new Error('Placed signatures are only available inside the PDF viewer.')
  }
  return value
}
