import type { DrawingKind } from '../pdf/drawings.ts'
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
  onInsertImage,
}: ToolbarProps) {
  const zoomPercent = Math.round(scale * 100)
  const hasDocument = pageCount > 0
  const pageLabel = hasDocument
    ? `${Math.max(currentPage, 1)} / ${pageCount}`
    : '— / —'

  return (
    <header className="toolbar">
      <div className="toolbar__brand">PDFForge</div>
      <button type="button" className="button button--primary" onClick={onUpload}>
        Upload PDF
      </button>
      <p className="toolbar__file" title={fileName ?? undefined}>
        {fileName ?? 'No PDF open'}
      </p>
      <div className="toolbar__controls">
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
        </div>
        <p className="toolbar__pages" aria-live="polite">
          <span className="sr-only">Current page</span>
          {pageLabel}
        </p>
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
