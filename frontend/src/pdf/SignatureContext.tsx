import { createContext, useContext } from 'react'
import type { Signature } from './signatures.ts'

export type SignatureApi = {
  /** The last confirmed signature, kept for this editor session only. */
  signature: Signature | null
  dialogOpen: boolean
  openDialog: () => void
  cancelDialog: () => void
  confirm: (signature: Signature) => void
}

export const SignatureContext = createContext<SignatureApi | null>(null)

export function useSignature(): SignatureApi {
  const value = useContext(SignatureContext)
  if (!value) {
    throw new Error('Signatures are only available inside the editor.')
  }
  return value
}
