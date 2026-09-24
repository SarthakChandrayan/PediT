import { useMemo, useRef, type PointerEvent } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import {
  pageSizeFromViewport,
  pdfRectToViewportBox,
  viewportPointToPdf,
  type PdfPoint,
} from './coordinates.ts'
import { useImages } from './ImageContext.tsx'
import {
  moveImageBox,
  resizeImageBox,
  type ImageAnnotation,
  type ImageBox,
  type ImageResizeHandle,
} from './images.ts'

type ImageLayerProps = {
  pageNumber: number
  viewport: PageViewport
}

type Gesture = {
  mode: 'move' | ImageResizeHandle
  start: PdfPoint
  box: ImageBox
  ratio: number
}

const HANDLES: ImageResizeHandle[] = ['nw', 'ne', 'se', 'sw']

export function ImageLayer({ pageNumber, viewport }: ImageLayerProps) {
  const images = useImages()
  const onPage = images.images.filter((image) => image.pageNumber === pageNumber)
  if (onPage.length === 0) {
    return null
  }

  return (
    <div className="image-layer" data-image-layer={pageNumber}>
      {onPage.map((image) => (
        <PlacedImage
          key={image.id}
          image={image}
          viewport={viewport}
          selected={image.id === images.selectedId}
          onSelect={() => images.selectImage(image.id)}
          onChange={(box) => images.updateImage(image.id, box)}
          onGestureStart={images.beginImageGesture}
          onGestureEnd={images.endImageGesture}
          onGestureCancel={images.cancelImageGesture}
        />
      ))}
    </div>
  )
}

function PlacedImage({
  image,
  viewport,
  selected,
  onSelect,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  image: ImageAnnotation
  viewport: PageViewport
  selected: boolean
  onSelect: () => void
  onChange: (box: ImageBox) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}) {
  const gesture = useRef<Gesture | null>(null)
  const preview = useImageSource(image.bytes, image.format === 'png' ? 'image/png' : 'image/jpeg')
  const box = pdfRectToViewportBox(viewport, image)

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onSelect()
    onGestureStart()
    const handle = (event.target as Element).closest?.('[data-resize-handle]')
    const name = handle?.getAttribute('data-resize-handle')
    const mode = isHandle(name) ? name : 'move'
    gesture.current = {
      mode,
      start: pointerToPdf(event, viewport, event.currentTarget),
      box: { x: image.x, y: image.y, width: image.width, height: image.height },
      ratio: image.originalWidth / image.originalHeight,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is unavailable for this event. Moves with the button down still update the image.
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
    const point = pointerToPdf(event, viewport, event.currentTarget)
    if (active.mode === 'move') {
      const page = pageSizeFromViewport(viewport)
      onChange(moveImageBox(active.box, active.start, point, page.width, page.height))
      return
    }
    onChange(resizeImageBox(active.box, active.mode, point, active.ratio))
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
      className="image-annotation"
      data-image-id={image.id}
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
      {preview ? (
        <img src={preview} alt="" draggable={false} />
      ) : null}
      {selected
        ? HANDLES.map((handle) => (
            <span key={handle} className="image-handle" data-resize-handle={handle} />
          ))
        : null}
    </div>
  )
}

function useImageSource(bytes: Uint8Array, mime: string): string {
  return useMemo(() => `data:${mime};base64,${bytesToBase64(bytes)}`, [bytes, mime])
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    const slice = bytes.subarray(index, index + 0x8000)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function pointerToPdf(
  event: PointerEvent<HTMLDivElement>,
  viewport: PageViewport,
  element: HTMLDivElement,
): PdfPoint {
  const surface = element.offsetParent instanceof HTMLElement ? element.offsetParent : element
  const bounds = surface.getBoundingClientRect()
  return viewportPointToPdf(viewport, {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  })
}

function isHandle(value: string | null | undefined): value is ImageResizeHandle {
  return value === 'nw' || value === 'ne' || value === 'se' || value === 'sw'
}
