import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import {
  clearSignaturePad,
  emptySignaturePad,
  isSignaturePadEmpty,
  paintSignatureStrokes,
  signaturePointerDown,
  signaturePointerMove,
  signaturePointerUp,
  type SignaturePad,
  type SignaturePadSize,
} from '../pdf/signaturePad.ts'
import { captureSignature, isSignatureCancelKey, type Signature } from '../pdf/signatures.ts'

/**
 * Modal for drawing a signature. Mount it only while open: unmounting drops
 * the drawing, so cancel always discards it.
 */
export function SignatureDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (signature: Signature) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const padRef = useRef<SignaturePad>(emptySignaturePad())
  const sizeRef = useRef<SignaturePadSize>({ width: 0, height: 0 })
  const frameRef = useRef<number | null>(null)
  const onCancelRef = useRef(onCancel)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    onCancelRef.current = onCancel
  })

  const paint = useCallback(() => {
    frameRef.current = null
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return
    }
    const { width, height } = sizeRef.current
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (width <= 0 || height <= 0) {
      return
    }
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
    paintSignatureStrokes(context, padRef.current.strokes)
  }, [])

  const schedulePaint = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(paint)
    }
  }, [paint])

  const update = useCallback(
    (next: SignaturePad) => {
      if (next === padRef.current) {
        return
      }
      padRef.current = next
      setHasInk(!isSignaturePadEmpty(next))
      schedulePaint()
    },
    [schedulePaint],
  )

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) {
      dialog.showModal()
    }
    cancelButtonRef.current?.focus()
    return () => {
      if (dialog.open) {
        dialog.close()
      }
      if (returnFocus?.isConnected) {
        returnFocus.focus()
      }
    }
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      sizeRef.current = { width: rect.width, height: rect.height }
      const width = Math.max(1, Math.round(rect.width * ratio))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      paint()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    // Browser zoom changes devicePixelRatio without resizing the canvas box.
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [paint])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    // Capture on window so editor shortcuts (undo, delete, find) never see
    // keys meant for the dialog, even when focus is not inside it.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (isSignatureCancelKey(event)) {
        event.preventDefault()
        onCancelRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    update(
      signaturePointerDown(padRef.current, {
        pointerId: event.pointerId,
        button: event.button,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      }),
    )
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (padRef.current.pointerId !== event.pointerId) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const native = event.nativeEvent
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const samples = coalesced.length > 0 ? coalesced : [native]
    let next = padRef.current
    for (const sample of samples) {
      next = signaturePointerMove(next, {
        pointerId: event.pointerId,
        pressed: (sample.buttons & 1) === 1,
        x: sample.clientX - rect.left,
        y: sample.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    update(next)
  }

  function handlePointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    update(signaturePointerUp(padRef.current, event.pointerId))
  }

  function handleConfirm() {
    const signature = captureSignature(padRef.current, sizeRef.current, () =>
      document.createElement('canvas'),
    )
    if (signature) {
      onConfirm(signature)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="signature-dialog"
      aria-labelledby="signature-dialog-title"
      aria-describedby="signature-dialog-hint"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
    >
      <div className="signature-dialog__panel">
        <h2 id="signature-dialog-title" className="signature-dialog__title">
          Create signature
        </h2>
        <p id="signature-dialog-hint" className="signature-dialog__hint">
          Draw your signature
        </p>
        <div className="signature-dialog__pad">
          <canvas
            ref={canvasRef}
            className="signature-dialog__canvas"
            role="img"
            aria-label="Signature drawing area"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onPointerLeave={handlePointerEnd}
          />
        </div>
        <div className="signature-dialog__actions">
          <button
            type="button"
            className="button button--ghost"
            aria-label="Clear signature"
            onClick={() => {
              update(clearSignaturePad(padRef.current))
            }}
          >
            Clear
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            className="button button--secondary signature-dialog__cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!hasInk}
            onClick={handleConfirm}
          >
            Use signature
          </button>
        </div>
      </div>
    </dialog>
  )
}
