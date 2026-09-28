import { useRef, type CSSProperties, type PointerEvent } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import {
  pageSizeFromViewport,
  pdfRectToViewportBox,
  viewportPointToPdf,
  type ViewportPoint,
} from './coordinates.ts'
import { usePlacedSignatures } from './PlacedSignatureContext.tsx'
import {
  dragSignature,
  signatureRect,
  startSignatureGesture,
  type SignatureAnnotation,
  type SignatureBox,
  type SignatureGesture,
} from './placedSignatures.ts'

type SignatureLayerProps = {
  pageNumber: number
  viewport: PageViewport
}

export function SignatureLayer({ pageNumber, viewport }: SignatureLayerProps) {
  const signatures = usePlacedSignatures()
  const onPage = signatures.signatures.filter((item) => item.pageNumber === pageNumber)
  const placing = signatures.placing !== null
  if (!placing && onPage.length === 0) {
    return null
  }

  return (
    <div
      className={placing ? 'signature-layer signature-layer--placing' : 'signature-layer'}
      data-signature-layer={pageNumber}
    >
      {onPage.map((item) => (
        <PlacedSignature
          key={item.id}
          signature={item}
          viewport={viewport}
          selected={item.id === signatures.selectedId}
          onSelect={() => signatures.selectSignature(item.id)}
          onChange={(box) => signatures.updateSignature(item.id, box)}
          onGestureStart={signatures.beginSignatureGesture}
          onGestureEnd={signatures.endSignatureGesture}
          onGestureCancel={signatures.cancelSignatureGesture}
        />
      ))}
      {placing ? (
        <div
          className="signature-capture"
          data-signature-capture=""
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            const center = viewportPointToPdf(viewport, localPoint(event, event.currentTarget))
            signatures.placeAt(pageNumber, center, pageSizeFromViewport(viewport))
          }}
        />
      ) : null}
    </div>
  )
}

function PlacedSignature({
  signature,
  viewport,
  selected,
  onSelect,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  signature: SignatureAnnotation
  viewport: PageViewport
  selected: boolean
  onSelect: () => void
  onChange: (box: SignatureBox) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}) {
  const gesture = useRef<SignatureGesture | null>(null)
  const box = pdfRectToViewportBox(viewport, signatureRect(signature))

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onSelect()
    onGestureStart()
    const onHandle = (event.target as Element).closest?.('[data-resize-handle]') != null
    gesture.current = startSignatureGesture(
      onHandle ? 'resize' : 'move',
      signature,
      surfacePoint(event),
      viewport,
    )
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is unavailable for this event. Moves with the button down still update the signature.
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active) {
      return
    }
    if (!event.currentTarget.hasPointerCapture(event.pointerId) && event.buttons === 0) {
      return
    }
    onChange(dragSignature(active, surfacePoint(event), viewport))
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const hadGesture = gesture.current !== null
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!hadGesture) {
      return
    }
    if (commit) {
      onGestureEnd()
      return
    }
    onGestureCancel()
  }

  return (
    <div
      className="signature-annotation"
      data-signature-id={signature.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        finishPointer(event, true)
      }}
      onPointerCancel={(event) => {
        finishPointer(event, false)
      }}
    >
      <img
        src={signature.dataUrl}
        alt="Signature"
        draggable={false}
        style={rotatedImageStyle(box.width, box.height, viewport.rotation)}
      />
      {selected ? (
        <span className="signature-handle" data-resize-handle="se" />
      ) : null}
    </div>
  )
}

/**
 * The image is upright in PDF space, so it turns with the page. On a quarter
 * turn the element's box is the rotated size, and the image is laid out at the
 * unrotated size before it is turned.
 */
function rotatedImageStyle(width: number, height: number, rotation: number): CSSProperties {
  const turn = ((rotation % 360) + 360) % 360
  if (turn === 0) {
    return {}
  }
  if (turn === 180) {
    return { transform: 'rotate(180deg)' }
  }
  return {
    width: `${height}px`,
    height: `${width}px`,
    left: `${(width - height) / 2}px`,
    top: `${(height - width) / 2}px`,
    transform: `rotate(${turn}deg)`,
  }
}

function surfacePoint(event: PointerEvent<HTMLDivElement>): ViewportPoint {
  const element = event.currentTarget
  const surface = element.offsetParent instanceof HTMLElement ? element.offsetParent : element
  return localPoint(event, surface)
}

function localPoint(event: PointerEvent<HTMLElement>, element: HTMLElement): ViewportPoint {
  const bounds = element.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}
