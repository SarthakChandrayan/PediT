import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type ConfirmRequest } from './confirm.ts'

type Pending = ConfirmRequest & { resolve: (confirmed: boolean) => void }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const confirm = useCallback((request: ConfirmRequest) => {
    pendingRef.current?.resolve(false)
    return new Promise<boolean>((resolve) => {
      const next = { ...request, resolve }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(confirmed)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmDialog request={pending} onSettle={settle} /> : null}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog({
  request,
  onSettle,
}: {
  request: ConfirmRequest
  onSettle: (confirmed: boolean) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const danger = request.tone === 'danger'

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) {
      dialog.showModal()
    }
    // Destructive prompts default to the safe choice.
    ;(danger ? cancelRef : confirmRef).current?.focus()

    // Keep editor shortcuts (delete, undo, find) from acting behind the dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Node && dialog.contains(event.target)) {
        return
      }
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (dialog.open) {
        dialog.close()
      }
      if (returnFocus?.isConnected) {
        returnFocus.focus()
      }
    }
  }, [danger])

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--confirm"
      aria-labelledby="confirm-title"
      aria-describedby={request.body ? 'confirm-body' : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onSettle(false)
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onSettle(false)
        }
      }}
    >
      <div className="dialog__body">
        <h2 id="confirm-title" className="dialog__title">
          {request.title}
        </h2>
        {request.body ? (
          <p id="confirm-body" className="dialog__text">
            {request.body}
          </p>
        ) : null}
      </div>
      <div className="dialog__footer">
        <button
          ref={cancelRef}
          type="button"
          className="button button--secondary"
          onClick={() => onSettle(false)}
        >
          {request.cancelLabel ?? 'Cancel'}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={danger ? 'button button--danger' : 'button button--primary'}
          onClick={() => onSettle(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
