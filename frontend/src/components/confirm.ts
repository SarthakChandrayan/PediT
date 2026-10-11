import { createContext, useContext } from 'react'

export type ConfirmRequest = {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>

export const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    throw new Error('useConfirm must be used inside ConfirmProvider.')
  }
  return confirm
}
