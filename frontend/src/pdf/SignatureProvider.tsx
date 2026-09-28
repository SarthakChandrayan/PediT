import { useMemo, useState, type ReactNode } from 'react'
import { SignatureContext, type SignatureApi } from './SignatureContext.tsx'
import {
  cancelSignatureDialog,
  confirmSignature,
  createSignatureSession,
  openSignatureDialog,
  type SignatureSession,
} from './signatures.ts'

export function SignatureProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SignatureSession>(createSignatureSession)

  const api = useMemo<SignatureApi>(
    () => ({
      signature: session.signature,
      dialogOpen: session.dialogOpen,
      openDialog: () => {
        setSession(openSignatureDialog)
      },
      cancelDialog: () => {
        setSession(cancelSignatureDialog)
      },
      confirm: (signature) => {
        setSession((current) => confirmSignature(current, signature))
      },
    }),
    [session],
  )

  return <SignatureContext.Provider value={api}>{children}</SignatureContext.Provider>
}
