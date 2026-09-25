import { useState } from 'react'
import { parsePageJump } from '../pdf/pageNavigation.ts'
import { SearchControls } from './SearchControls.tsx'
import type { DrawingKind } from '../pdf/drawings.ts'
import {
  hexToRgb,
  isNewTextFontName,
  NEW_TEXT_FONTS,
  rgbToHex,
  type NewTextAnnotation,
} from '../pdf/newTexts.ts'
import {
  HIGHLIGHT_COLORS,
  type HighlightColorName,
} from '../pdf/highlights.ts'
import { MAX_PDF_SCALE, MIN_PDF_SCALE } from '../pdf/scale.ts'

type ToolbarProps = {
  fileName: string | null
  currentPage: number
  pageCount: number
  scale: number
  exporting: boolean
  saving: boolean
  canSave: boolean
  pageOpsDisabled: boolean
  canDeletePage: boolean
  canMovePageUp: boolean
  canMovePageDown: boolean
  onUpload: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onFitPage: () => void
  onJumpToPage: (pageNumber: number) => void
  onExport: () => void
  onSave: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onDeletePage: () => void
  onRotatePage: () => void
  onDuplicatePage: () => void
  onMovePageUp: () => void
  onMovePageDown: () => void
  onAddBlankPage: () => void
  canHighlight: boolean
  canRemoveHighlight: boolean
  highlightColor: HighlightColorName
  onHighlightColor: (color: HighlightColorName) => void
  onHighlightPointerDown: () => void
  onHighlight: () => void
  onUnderline: () => void
  onStrikethrough: () => void
  onRemoveHighlight: () => void
  drawingTool: DrawingKind | null
  onDrawingTool: (tool: DrawingKind) => void
  textTool: boolean
  onTextTool: () => void
  selectedNewText: Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'> | null
  onNewTextStyle: (
    patch: Partial<Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>>,
  ) => void
  onInsertImage: () => void
}

export function Toolbar({
  fileName,
  currentPage,
  pageCount,
  scale,
  exporting,
  saving,
  canSave,
  pageOpsDisabled,
  canDeletePage,
  canMovePageUp,
  canMovePageDown,
  onUpload,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onJumpToPage,
  onExport,
  onSave,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDeletePage,
  onRotatePage,
  onDuplicatePage,
  onMovePageUp,
  onMovePageDown,
  onAddBlankPage,
  canHighlight,
  canRemoveHighlight,
  highlightColor,
  onHighlightColor,
  onHighlightPointerDown,
  onHighlight,
  onUnderline,
  onStrikethrough,
  onRemoveHighlight,
  drawingTool,
  onDrawingTool,
  textTool,
  onTextTool,
  selectedNewText,
  onNewTextStyle,
  onInsertImage,
}: ToolbarProps) {
  const zoomPercent = Math.round(scale * 100)
  const hasDocument = pageCount > 0

  return (
    <header className="toolbar">
      <div className="toolbar__brand">PediT</div>
      <button type="button" className="button button--primary" onClick={onUpload}>
        Upload PDF
      </button>
      <p className="toolbar__file" title={fileName ?? undefined}>
        {fileName ?? 'No PDF open'}
      </p>
      <div className="toolbar__controls">
        <SearchControls disabled={!hasDocument} />
        <div className="toolbar__history" aria-label="History">
          <button
            type="button"
            className="button button--toolbar"
            onClick={onUndo}
            disabled={!canUndo}
            aria-keyshortcuts="Control+Z Meta+Z"
          >
            Undo
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onRedo}
            disabled={!canRedo}
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          >
            Redo
          </button>
        </div>
        <button
          type="button"
          className="button button--toolbar"
          onClick={onSave}
          disabled={!canSave || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="button button--toolbar"
          onClick={onExport}
          disabled={!hasDocument || exporting}
        >
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
        <div className="toolbar__zoom" aria-label="Zoom">
          <button
            type="button"
            className="button button--icon"
            onClick={onZoomOut}
            disabled={!hasDocument || scale <= MIN_PDF_SCALE}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="toolbar__zoom-value" aria-live="polite">
            {zoomPercent}%
          </span>
          <button
            type="button"
            className="button button--icon"
            onClick={onZoomIn}
            disabled={!hasDocument || scale >= MAX_PDF_SCALE}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onFitWidth}
            disabled={!hasDocument}
          >
            Fit width
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onFitPage}
            disabled={!hasDocument}
          >
            Fit page
          </button>
        </div>
        <PageJump
          currentPage={currentPage}
          pageCount={pageCount}
          disabled={!hasDocument}
          onJumpToPage={onJumpToPage}
        />
        <div className="toolbar__highlights" aria-label="Text highlighting">
          {(Object.keys(HIGHLIGHT_COLORS) as HighlightColorName[]).map((color) => (
            <button
              key={color}
              type="button"
              className="button button--toolbar toolbar__swatch"
              data-color={color}
              aria-pressed={highlightColor === color}
              aria-label={`${color} highlight`}
              disabled={pageOpsDisabled}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                onHighlightColor(color)
              }}
            >
              {color}
            </button>
          ))}
          <button
            type="button"
            className="button button--toolbar"
            onMouseDown={(event) => {
              event.preventDefault()
              onHighlightPointerDown()
            }}
            onClick={onHighlight}
            disabled={pageOpsDisabled || !canHighlight}
          >
            Highlight
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onMouseDown={(event) => {
              event.preventDefault()
              onHighlightPointerDown()
            }}
            onClick={onUnderline}
            disabled={pageOpsDisabled || !canHighlight}
          >
            Underline
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onMouseDown={(event) => {
              event.preventDefault()
              onHighlightPointerDown()
            }}
            onClick={onStrikethrough}
            disabled={pageOpsDisabled || !canHighlight}
          >
            Strikethrough
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onRemoveHighlight}
            disabled={pageOpsDisabled || !canRemoveHighlight}
          >
            Remove
          </button>
        </div>
        <div className="toolbar__draw" aria-label="Drawing">
          <button
            type="button"
            className="button button--toolbar"
            aria-pressed={textTool}
            disabled={pageOpsDisabled}
            onClick={onTextTool}
          >
            Text
          </button>
          {(
            [
              ['freehand', 'Pen'],
              ['line', 'Line'],
              ['arrow', 'Arrow'],
              ['rectangle', 'Rectangle'],
              ['ellipse', 'Ellipse'],
            ] as const
          ).map(([tool, label]) => (
            <button
              key={tool}
              type="button"
              className="button button--toolbar"
              aria-pressed={drawingTool === tool}
              disabled={pageOpsDisabled}
              onClick={() => {
                onDrawingTool(tool)
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="button button--toolbar"
            disabled={pageOpsDisabled}
            onClick={onInsertImage}
          >
            Image
          </button>
        </div>
        {selectedNewText ? (
          <div className="toolbar__text-style" aria-label="Text style" data-new-text-style="">
            <label className="toolbar__text-style-label">
              Font
              <select
                className="toolbar__text-select"
                value={selectedNewText.fontName}
                onChange={(event) => {
                  if (isNewTextFontName(event.target.value)) {
                    onNewTextStyle({ fontName: event.target.value })
                  }
                }}
              >
                {NEW_TEXT_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
            <label className="toolbar__text-style-label">
              Size
              <select
                className="toolbar__text-select"
                value={String(selectedNewText.fontSize)}
                onChange={(event) => {
                  const fontSize = Number(event.target.value)
                  if (Number.isFinite(fontSize)) {
                    onNewTextStyle({ fontSize })
                  }
                }}
              >
                {fontSizesFor(selectedNewText.fontSize).map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--toolbar"
              aria-pressed={selectedNewText.bold}
              onClick={() => {
                onNewTextStyle({ bold: !selectedNewText.bold })
              }}
            >
              Bold
            </button>
            <button
              type="button"
              className="button button--toolbar"
              aria-pressed={selectedNewText.italic}
              onClick={() => {
                onNewTextStyle({ italic: !selectedNewText.italic })
              }}
            >
              Italic
            </button>
            <label className="toolbar__text-style-label">
              Color
              <input
                className="toolbar__text-color"
                type="color"
                value={rgbToHex(selectedNewText.color)}
                onChange={(event) => {
                  const color = hexToRgb(event.target.value)
                  if (color) {
                    onNewTextStyle({ color })
                  }
                }}
              />
            </label>
          </div>
        ) : null}
        <div className="toolbar__page-ops" aria-label="Page operations">
          <button
            type="button"
            className="button button--toolbar"
            onClick={onDeletePage}
            disabled={pageOpsDisabled || !canDeletePage}
          >
            Delete
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onRotatePage}
            disabled={pageOpsDisabled}
            title="Rotate 90° clockwise"
          >
            Rotate
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onDuplicatePage}
            disabled={pageOpsDisabled}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onMovePageUp}
            disabled={pageOpsDisabled || !canMovePageUp}
          >
            Move up
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onMovePageDown}
            disabled={pageOpsDisabled || !canMovePageDown}
          >
            Move down
          </button>
          <button
            type="button"
            className="button button--toolbar"
            onClick={onAddBlankPage}
            disabled={pageOpsDisabled}
            title="Insert a blank page after the current page"
          >
            Blank page
          </button>
        </div>
      </div>
    </header>
  )
}

function PageJump({
  currentPage,
  pageCount,
  disabled,
  onJumpToPage,
}: {
  currentPage: number
  pageCount: number
  disabled: boolean
  onJumpToPage: (pageNumber: number) => void
}) {
  const shown = pageCount > 0 ? String(Math.max(currentPage, 1)) : ''
  const [draft, setDraft] = useState(shown)
  const [editing, setEditing] = useState(false)
  const [draftSource, setDraftSource] = useState(shown)

  if (!editing && draftSource !== shown) {
    setDraftSource(shown)
    setDraft(shown)
  }

  function commit() {
    setEditing(false)
    const page = parsePageJump(draft, pageCount)
    if (page === null) {
      setDraft(shown)
      return
    }
    if (page !== currentPage) {
      onJumpToPage(page)
    }
  }

  return (
    <form
      className="toolbar__page-jump"
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <label htmlFor="page-jump">Page</label>
      <input
        id="page-jump"
        className="toolbar__page-input"
        inputMode="numeric"
        aria-label="Page number"
        disabled={disabled}
        value={draft}
        onFocus={() => {
          setEditing(true)
        }}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={commit}
      />
      <span>of {pageCount > 0 ? pageCount : '—'}</span>
    </form>
  )
}

const NEW_TEXT_SIZES = [8, 10, 12, 14, 16, 18, 24, 36, 48, 72]

function fontSizesFor(current: number): number[] {
  if (NEW_TEXT_SIZES.includes(current)) {
    return NEW_TEXT_SIZES
  }
  return [...NEW_TEXT_SIZES, current].sort((left, right) => left - right)
}
