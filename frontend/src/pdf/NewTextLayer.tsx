import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import {
  pageSizeFromViewport,
  pdfRectToViewportBox,
  viewportPointToPdf,
  type PdfPoint,
} from './coordinates.ts'
import { useNewTexts } from './NewTextContext.tsx'
import {
  moveNewText,
  newTextOverlayCss,
  newTextPdfRect,
  resizeNewTextWidth,
  type NewTextAnnotation,
  type NewTextBox,
} from './newTexts.ts'

type NewTextLayerProps = {
  pageNumber: number
  viewport: PageViewport
}

type Gesture = {
  mode: 'move' | 'resize'
  start: PdfPoint
  box: NewTextBox
}

export function NewTextLayer({ pageNumber, viewport }: NewTextLayerProps) {
  const texts = useNewTexts()
  const onPage = texts.texts.filter((item) => item.pageNumber === pageNumber)
  const draft = texts.draft?.pageNumber === pageNumber ? texts.draft : null
  if (!texts.tool && onPage.length === 0 && !draft) {
    return null
  }

  const shown = draft && !onPage.some((item) => item.id === draft.id) ? [...onPage, draft] : onPage

  return (
    <div
      className={texts.tool ? 'new-text-layer new-text-layer--active' : 'new-text-layer'}
      data-new-text-layer={pageNumber}
    >
      {texts.tool ? (
        <div
          className="new-text-capture"
          data-new-text-capture=""
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            texts.commitDraft()
            texts.commitEditing()
            const point = pointerToPdf(event, viewport, event.currentTarget)
            const page = pageSizeFromViewport(viewport)
            texts.createAt(pageNumber, point.x, point.y, page.width, page.height)
          }}
        />
      ) : null}
      {shown.map((item) => (
        <PlacedText
          key={item.id}
          text={item}
          viewport={viewport}
          selected={item.id === texts.selectedId || item.id === texts.draft?.id}
          editing={item.id === texts.editingId || item.id === texts.draft?.id}
          draftText={
            item.id === texts.draft?.id
              ? texts.draft.text
              : item.id === texts.editingId
                ? texts.editingText
                : item.text
          }
          onSelect={() => {
            texts.selectText(item.id)
          }}
          onBeginEdit={() => {
            if (texts.draft?.id === item.id) {
              return
            }
            texts.beginEdit(item.id)
          }}
          onChangeText={(value) => {
            if (texts.draft?.id === item.id) {
              texts.updateDraftText(value)
              return
            }
            texts.updateEditingText(value)
          }}
          onCommit={() => {
            if (texts.draft?.id === item.id) {
              texts.commitDraft()
              return
            }
            texts.commitEditing()
          }}
          onCancel={() => {
            if (texts.draft?.id === item.id) {
              texts.cancelDraft()
              return
            }
            texts.cancelEditing()
          }}
          onChangeBox={(box) => texts.updateTextBox(item.id, box)}
          onGestureStart={texts.beginTextGesture}
          onGestureEnd={texts.endTextGesture}
          onGestureCancel={texts.cancelTextGesture}
        />
      ))}
    </div>
  )
}

function PlacedText({
  text,
  viewport,
  selected,
  editing,
  draftText,
  onSelect,
  onBeginEdit,
  onChangeText,
  onCommit,
  onCancel,
  onChangeBox,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  text: NewTextAnnotation
  viewport: PageViewport
  selected: boolean
  editing: boolean
  draftText: string
  onSelect: () => void
  onBeginEdit: () => void
  onChangeText: (text: string) => void
  onCommit: () => void
  onCancel: () => void
  onChangeBox: (box: NewTextBox) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}) {
  const gesture = useRef<Gesture | null>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const box = pdfRectToViewportBox(viewport, newTextPdfRect(text))
  const style = newTextOverlayCss(text)
  const fontSizePx = cssFontSize(viewport, text.fontSize)

  useEffect(() => {
    if (!editing) {
      return
    }
    const field = fieldRef.current
    if (!field) {
      return
    }
    field.focus()
    field.select()
  }, [editing, text.id])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onSelect()
    if (editing) {
      return
    }
    onGestureStart()
    const handle = (event.target as Element).closest?.('[data-resize-handle]')
    const surface =
      event.currentTarget.offsetParent instanceof HTMLElement
        ? event.currentTarget.offsetParent
        : event.currentTarget
    gesture.current = {
      mode: handle ? 'resize' : 'move',
      start: pointerToPdf(event, viewport, surface),
      box: { pdfX: text.pdfX, pdfY: text.pdfY, width: text.width, height: text.height },
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Moves with the button down still update the box.
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
    const surface =
      event.currentTarget.offsetParent instanceof HTMLElement
        ? event.currentTarget.offsetParent
        : event.currentTarget
    const point = pointerToPdf(event, viewport, surface)
    const page = pageSizeFromViewport(viewport)
    if (active.mode === 'move') {
      onChangeBox(moveNewText(active.box, active.start, point, page.width, page.height))
      return
    }
    onChangeBox(resizeNewTextWidth(active.box, point.x, page.width, page.height))
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

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  const fieldStyle: CSSProperties = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    fontSize: `${fontSizePx}px`,
  }

  return (
    <div
      className="new-text-annotation"
      data-new-text-id={text.id}
      data-new-text-ui=""
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
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
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onBeginEdit()
      }}
    >
      {editing ? (
        <input
          ref={fieldRef}
          className="new-text-field"
          data-new-text-ui=""
          value={draftText}
          spellCheck={false}
          style={fieldStyle}
          onChange={(event) => {
            onChangeText(event.target.value)
          }}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
        />
      ) : (
        <span className="new-text-value" style={fieldStyle}>
          {text.text}
        </span>
      )}
      {selected && !editing ? <span className="new-text-handle" data-resize-handle="e" /> : null}
    </div>
  )
}

function pointerToPdf(
  event: PointerEvent<HTMLElement>,
  viewport: PageViewport,
  element: HTMLElement,
): PdfPoint {
  const bounds = element.getBoundingClientRect()
  return viewportPointToPdf(viewport, {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  })
}

function cssFontSize(viewport: PageViewport, fontSize: number): number {
  const origin = viewport.convertToViewportPoint(0, 0)
  const end = viewport.convertToViewportPoint(0, fontSize)
  return Math.hypot(end[0] - origin[0], end[1] - origin[1])
}
