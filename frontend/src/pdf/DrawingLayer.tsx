import type { PointerEvent } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import {
  pdfPointToViewport,
  pdfRectToViewportBox,
  viewportPointToPdf,
  type PdfPoint,
} from './coordinates.ts'
import { useDrawing } from './DrawingContext.tsx'
import {
  arrowGeometry,
  boundsFromPoints,
  DRAWING_COLOR,
  DRAWING_OPACITY,
  DRAWING_THICKNESS,
  drawingBounds,
  type DrawingAnnotation,
  type DrawingDraft,
} from './drawings.ts'

type DrawingLayerProps = {
  pageNumber: number
  viewport: PageViewport
}

export function DrawingLayer({ pageNumber, viewport }: DrawingLayerProps) {
  const drawing = useDrawing()
  const onPage = drawing.drawings.filter((item) => item.pageNumber === pageNumber)
  const draft = drawing.draft?.pageNumber === pageNumber ? drawing.draft : null
  if (!drawing.tool && onPage.length === 0 && !draft) {
    return null
  }

  const preview = draft ? draftAnnotation(draft) : null

  return (
    <svg
      className={drawing.tool ? 'drawing-layer drawing-layer--active' : 'drawing-layer'}
      data-drawing-layer={pageNumber}
      width={viewport.width}
      height={viewport.height}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    >
      {drawing.tool ? (
        <rect
          className="drawing-capture"
          x={0}
          y={0}
          width={viewport.width}
          height={viewport.height}
          onPointerDown={(event) => {
            startStroke(event, pageNumber, viewport, drawing.tool, drawing.beginStroke)
          }}
          onPointerMove={(event) => {
            const tracking =
              event.currentTarget.hasPointerCapture(event.pointerId) || event.buttons > 0
            if (tracking) {
              drawing.extendStroke(pointerToPdf(event, viewport, event.currentTarget))
            }
          }}
          onPointerUp={(event) => {
            release(event)
            drawing.finishStroke()
          }}
          onPointerCancel={(event) => {
            release(event)
            drawing.finishStroke()
          }}
        />
      ) : null}
      {onPage.map((item) => (
        <DrawingShape
          key={item.id}
          drawing={item}
          viewport={viewport}
          selected={item.id === drawing.selectedId}
          onSelect={drawing.tool ? undefined : () => drawing.selectDrawing(item.id)}
        />
      ))}
      {preview ? <DrawingShape drawing={preview} viewport={viewport} selected={false} /> : null}
    </svg>
  )
}

function DrawingShape({
  drawing,
  viewport,
  selected,
  onSelect,
}: {
  drawing: DrawingAnnotation
  viewport: PageViewport
  selected: boolean
  onSelect?: () => void
}) {
  const bounds = drawingBounds(drawing)
  const box = bounds ? pdfRectToViewportBox(viewport, bounds) : null
  const thickness = cssThickness(viewport, drawing.thickness)
  return (
    <g data-drawing-id={drawing.id} data-drawing-kind={drawing.kind}>
      {box && onSelect ? (
        <rect
          className="drawing-hit"
          x={box.left}
          y={box.top}
          width={box.width}
          height={box.height}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSelect()
          }}
        />
      ) : null}
      <ShapeGraphic drawing={drawing} viewport={viewport} thickness={thickness} />
      {selected && box ? (
        <rect
          className="drawing-selection"
          x={box.left}
          y={box.top}
          width={box.width}
          height={box.height}
        />
      ) : null}
    </g>
  )
}

function ShapeGraphic({
  drawing,
  viewport,
  thickness,
}: {
  drawing: DrawingAnnotation
  viewport: PageViewport
  thickness: number
}) {
  const stroke = {
    stroke: drawing.color,
    strokeWidth: thickness,
    strokeOpacity: drawing.opacity,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (drawing.kind === 'rectangle' || drawing.kind === 'ellipse') {
    const bounds = boundsFromPoints(drawing.points)
    if (!bounds) {
      return null
    }
    const box = pdfRectToViewportBox(viewport, bounds)
    if (drawing.kind === 'ellipse') {
      return (
        <ellipse
          className="drawing-shape"
          cx={box.left + box.width / 2}
          cy={box.top + box.height / 2}
          rx={Math.max(box.width / 2, 0)}
          ry={Math.max(box.height / 2, 0)}
          {...stroke}
        />
      )
    }
    return (
      <rect
        className="drawing-shape"
        x={box.left}
        y={box.top}
        width={box.width}
        height={box.height}
        {...stroke}
      />
    )
  }

  if (drawing.kind === 'arrow') {
    const start = drawing.points[0]
    const end = drawing.points[1]
    if (!start || !end) {
      return null
    }
    const arrow = arrowGeometry(start, end, drawing.thickness)
    if (!arrow) {
      return <polyline className="drawing-shape" points={polyline(viewport, [start, end])} {...stroke} />
    }
    const head = arrow.head.map((point) => pdfPointToViewport(viewport, point))
    return (
      <g>
        <line
          className="drawing-shape"
          {...endpoints(viewport, start, arrow.shaftEnd)}
          {...stroke}
        />
        <polygon
          className="drawing-arrow-head"
          points={head.map((point) => `${point.x},${point.y}`).join(' ')}
          fill={drawing.color}
          fillOpacity={drawing.opacity}
          stroke="none"
        />
      </g>
    )
  }

  return (
    <polyline
      className="drawing-shape"
      points={polyline(viewport, drawing.points)}
      {...stroke}
    />
  )
}

function startStroke(
  event: PointerEvent<SVGRectElement>,
  pageNumber: number,
  viewport: PageViewport,
  tool: DrawingAnnotation['kind'] | null,
  beginStroke: (pageNumber: number, kind: DrawingAnnotation['kind'], point: PdfPoint) => void,
): void {
  if (!tool) {
    return
  }
  event.preventDefault()
  beginStroke(pageNumber, tool, pointerToPdf(event, viewport, event.currentTarget))
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // Some pointer events cannot be captured. Moves with the button down still extend the stroke.
  }
}

function release(event: PointerEvent<SVGRectElement>): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

function pointerToPdf(
  event: PointerEvent<SVGRectElement>,
  viewport: PageViewport,
  element: Element,
): PdfPoint {
  const box = element.getBoundingClientRect()
  return viewportPointToPdf(viewport, {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
  })
}

function cssThickness(viewport: PageViewport, thickness: number): number {
  const origin = pdfPointToViewport(viewport, { x: 0, y: 0 })
  const end = pdfPointToViewport(viewport, { x: thickness, y: 0 })
  return Math.hypot(end.x - origin.x, end.y - origin.y)
}

function polyline(viewport: PageViewport, points: readonly PdfPoint[]): string {
  return points
    .map((point) => {
      const view = pdfPointToViewport(viewport, point)
      return `${view.x},${view.y}`
    })
    .join(' ')
}

function endpoints(
  viewport: PageViewport,
  start: PdfPoint,
  end: PdfPoint,
): { x1: number; y1: number; x2: number; y2: number } {
  const from = pdfPointToViewport(viewport, start)
  const to = pdfPointToViewport(viewport, end)
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y }
}

function draftAnnotation(draft: DrawingDraft): DrawingAnnotation {
  return {
    id: 'draft',
    pageNumber: draft.pageNumber,
    kind: draft.kind,
    points: draft.points,
    color: DRAWING_COLOR,
    opacity: DRAWING_OPACITY,
    thickness: DRAWING_THICKNESS,
  }
}
