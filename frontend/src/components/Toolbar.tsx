import { useState, type MouseEvent } from 'react'
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
import { Icon, type IconName } from './icons.tsx'

type ToolbarProps = {
  currentPage: number
  pageCount: number
  scale: number
  pageOpsDisabled: boolean
  canDeletePage: boolean
  canMovePageUp: boolean
  canMovePageDown: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onFitPage: () => void
  onJumpToPage: (pageNumber: number) => void
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
  onSelectTool: () => void
  selectedNewText: Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'> | null
  selectedImage: { width: number; height: number } | null
  selectedDrawing: boolean
  onNewTextStyle: (
    patch: Partial<Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>>,
  ) => void
  onInsertImage: () => void
}

export function Toolbar({
  currentPage,
  pageCount,
  scale,
  pageOpsDisabled,
  canDeletePage,
  canMovePageUp,
  canMovePageDown,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onJumpToPage,
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
  onSelectTool,
  selectedNewText,
  selectedImage,
  selectedDrawing,
  onNewTextStyle,
  onInsertImage,
}: ToolbarProps) {
  const zoomPercent = Math.round(scale * 100)
  const hasDocument = pageCount > 0
  const selectActive = !drawingTool && !textTool
  const showMarkupRemove =
    canRemoveHighlight && !selectedNewText && !selectedImage && !selectedDrawing

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor tools">
      <div className="editor-toolbar__tools">
        <div className="tool-group" aria-label="Select">
          <ToolButton
            label="Select"
            icon="select"
            pressed={hasDocument && selectActive}
            disabled={!hasDocument}
            onClick={onSelectTool}
          />
        </div>
        <div className="tool-divider" aria-hidden="true" />
        <div className="tool-group" aria-label="Edit">
          <ToolButton
            label="Add text"
            icon="addText"
            pressed={textTool}
            disabled={pageOpsDisabled}
            onClick={onTextTool}
          />
        </div>
        <div className="tool-divider" aria-hidden="true" />
        <div className="tool-group" aria-label="Annotate">
          <ToolButton
            label="Highlight"
            icon="highlight"
            disabled={pageOpsDisabled || !canHighlight}
            onMouseDown={(event) => {
              event.preventDefault()
              onHighlightPointerDown()
            }}
            onClick={onHighlight}
          />
          <ToolButton
            label="Underline"
            icon="underline"
            disabled={pageOpsDisabled || !canHighlight}
            onMouseDown={(event) => {
              event.preventDefault()
              onHighlightPointerDown()
            }}
            onClick={onUnderline}
          />
          <ToolButton
            label="Strikethrough"
            icon="strikethrough"
            disabled={pageOpsDisabled || !canHighlight}
            onMouseDown={(event) => {
              event.preventDefault()
              onHighlightPointerDown()
            }}
            onClick={onStrikethrough}
          />
          {(Object.keys(HIGHLIGHT_COLORS) as HighlightColorName[]).map((color) => (
            <button
              key={color}
              type="button"
              className="tool swatch"
              data-color={color}
              aria-pressed={highlightColor === color}
              aria-label={`${color} highlight`}
              data-tooltip={`${color} highlight`}
              disabled={pageOpsDisabled}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                onHighlightColor(color)
              }}
            />
          ))}
          {showMarkupRemove ? (
            <ToolButton
              label="Remove markup"
              icon="trash"
              danger
              disabled={pageOpsDisabled || !canRemoveHighlight}
              onClick={onRemoveHighlight}
            />
          ) : null}
        </div>
        <div className="tool-divider" aria-hidden="true" />
        <div className="tool-group" aria-label="Draw">
          {(
            [
              ['freehand', 'Freehand', 'pen'],
              ['line', 'Line', 'line'],
              ['arrow', 'Arrow', 'arrow'],
              ['rectangle', 'Rectangle', 'rectangle'],
              ['ellipse', 'Ellipse', 'ellipse'],
            ] as const
          ).map(([kind, label, icon]) => (
            <ToolButton
              key={kind}
              label={label}
              icon={icon}
              pressed={drawingTool === kind}
              disabled={pageOpsDisabled}
              onClick={() => {
                onDrawingTool(kind)
              }}
            />
          ))}
        </div>
        <div className="tool-divider" aria-hidden="true" />
        <div className="tool-group" aria-label="Insert">
          <ToolButton
            label="Insert image"
            icon="image"
            disabled={pageOpsDisabled}
            onClick={onInsertImage}
          />
        </div>
        <div className="tool-divider" aria-hidden="true" />
        <div className="tool-group" aria-label="Page operations">
          <ToolButton
            label="Delete page"
            icon="trash"
            danger
            disabled={pageOpsDisabled || !canDeletePage}
            onClick={onDeletePage}
          />
          <ToolButton
            label="Rotate page 90° clockwise"
            icon="rotate"
            disabled={pageOpsDisabled}
            onClick={onRotatePage}
          />
          <ToolButton
            label="Duplicate page"
            icon="duplicate"
            disabled={pageOpsDisabled}
            onClick={onDuplicatePage}
          />
          <ToolButton
            label="Move page up"
            icon="moveUp"
            disabled={pageOpsDisabled || !canMovePageUp}
            onClick={onMovePageUp}
          />
          <ToolButton
            label="Move page down"
            icon="moveDown"
            disabled={pageOpsDisabled || !canMovePageDown}
            onClick={onMovePageDown}
          />
          <ToolButton
            label="Insert blank page"
            icon="addPage"
            disabled={pageOpsDisabled}
            onClick={onAddBlankPage}
          />
        </div>
        {selectedNewText ? (
          <TextStyleControls selected={selectedNewText} onChange={onNewTextStyle} onDelete={onRemoveHighlight} />
        ) : null}
        {selectedImage ? (
          <ImageControls size={selectedImage} onDelete={onRemoveHighlight} />
        ) : null}
        {selectedDrawing ? (
          <div className="context-bar" aria-label="Drawing">
            <ToolButton label="Delete drawing" icon="trash" danger onClick={onRemoveHighlight} />
          </div>
        ) : null}
        <div className="tool-divider" aria-hidden="true" />
        <div className="tool-group" aria-label="History">
          <ToolButton
            label="Undo"
            icon="undo"
            disabled={!canUndo}
            shortcut="Control+Z Meta+Z"
            onClick={onUndo}
          />
          <ToolButton
            label="Redo"
            icon="redo"
            disabled={!canRedo}
            shortcut="Control+Shift+Z Meta+Shift+Z Control+Y"
            onClick={onRedo}
          />
        </div>
      </div>
      <div className="editor-toolbar__view">
        <SearchControls disabled={!hasDocument} />
        <div className="tool-group" aria-label="Zoom">
          <ToolButton
            label="Zoom out"
            icon="zoomOut"
            disabled={!hasDocument || scale <= MIN_PDF_SCALE}
            onClick={onZoomOut}
          />
          <span className="zoom-value" aria-live="polite">
            {zoomPercent}%
          </span>
          <ToolButton
            label="Zoom in"
            icon="zoomIn"
            disabled={!hasDocument || scale >= MAX_PDF_SCALE}
            onClick={onZoomIn}
          />
          <ToolButton
            label="Fit width"
            icon="fitWidth"
            disabled={!hasDocument}
            onClick={onFitWidth}
            labeled
          />
          <ToolButton
            label="Fit page"
            icon="fitPage"
            disabled={!hasDocument}
            onClick={onFitPage}
            labeled
          />
        </div>
        <PageJump
          currentPage={currentPage}
          pageCount={pageCount}
          disabled={!hasDocument}
          onJumpToPage={onJumpToPage}
        />
      </div>
    </div>
  )
}

function ToolButton({
  label,
  icon,
  pressed,
  disabled,
  danger,
  labeled,
  shortcut,
  onClick,
  onMouseDown,
}: {
  label: string
  icon: IconName
  pressed?: boolean
  disabled?: boolean
  danger?: boolean
  labeled?: boolean
  shortcut?: string
  onClick?: () => void
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={['tool', labeled ? 'tool--labeled' : '', danger ? 'tool--danger' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      <Icon name={icon} />
      {labeled ? <span className="tool__text">{label}</span> : null}
    </button>
  )
}

function TextStyleControls({
  selected,
  onChange,
  onDelete,
}: {
  selected: Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>
  onChange: (
    patch: Partial<Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>>,
  ) => void
  onDelete: () => void
}) {
  return (
    <div className="context-bar" aria-label="Text style" data-new-text-style="">
      <label className="context-bar__label">
        Font
        <select
          className="field-select"
          value={selected.fontName}
          aria-label="Font"
          onChange={(event) => {
            if (isNewTextFontName(event.target.value)) {
              onChange({ fontName: event.target.value })
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
      <label className="context-bar__label">
        Size
        <select
          className="field-select"
          value={String(selected.fontSize)}
          aria-label="Font size"
          onChange={(event) => {
            const fontSize = Number(event.target.value)
            if (Number.isFinite(fontSize)) {
              onChange({ fontSize })
            }
          }}
        >
          {fontSizesFor(selected.fontSize).map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <ToolButton
        label="Bold"
        icon="bold"
        pressed={selected.bold}
        onClick={() => {
          onChange({ bold: !selected.bold })
        }}
      />
      <ToolButton
        label="Italic"
        icon="italic"
        pressed={selected.italic}
        onClick={() => {
          onChange({ italic: !selected.italic })
        }}
      />
      <label className="context-bar__label">
        Color
        <input
          className="field-color"
          type="color"
          aria-label="Text color"
          value={rgbToHex(selected.color)}
          onChange={(event) => {
            const color = hexToRgb(event.target.value)
            if (color) {
              onChange({ color })
            }
          }}
        />
      </label>
      <ToolButton label="Delete text" icon="trash" danger onClick={onDelete} />
    </div>
  )
}

function ImageControls({
  size,
  onDelete,
}: {
  size: { width: number; height: number }
  onDelete: () => void
}) {
  return (
    <div className="context-bar" aria-label="Image">
      <span className="context-bar__metric">
        {Math.round(size.width)} × {Math.round(size.height)}
      </span>
      <ToolButton label="Delete image" icon="trash" danger onClick={onDelete} />
    </div>
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
      className="page-jump"
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <label htmlFor="page-jump">Page</label>
      <input
        id="page-jump"
        className="page-jump__input"
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
