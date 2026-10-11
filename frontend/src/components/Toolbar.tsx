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
import { Menu, MenuHeading, MenuItem, MenuSeparator } from './Menu.tsx'

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
  onZoomTo: (scale: number) => void
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
  hasSignature: boolean
  signatureTool: boolean
  signaturePreview: string | null
  selectedSignature: { width: number; height: number } | null
  onNewTextStyle: (
    patch: Partial<Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>>,
  ) => void
  onInsertImage: () => void
  onSignature: () => void
  onNewSignature: () => void
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const MOD = IS_APPLE ? '⌘' : 'Ctrl+'
const SHIFT = IS_APPLE ? '⇧' : 'Shift+'


const DRAW_TOOLS = [
  ['freehand', 'Pen', 'pen'],
  ['line', 'Line', 'line'],
  ['arrow', 'Arrow', 'arrow'],
  ['rectangle', 'Rectangle', 'rectangle'],
  ['ellipse', 'Ellipse', 'ellipse'],
] as const

const SWATCH_LABELS: Record<HighlightColorName, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
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
  onZoomTo,
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
  hasSignature,
  signatureTool,
  signaturePreview,
  selectedSignature,
  onNewTextStyle,
  onInsertImage,
  onSignature,
  onNewSignature,
}: ToolbarProps) {
  const zoomPercent = Math.round(scale * 100)
  const hasDocument = pageCount > 0
  const selectActive = !drawingTool && !textTool && !signatureTool
  const showMarkupRemove =
    canRemoveHighlight &&
    !selectedNewText &&
    !selectedImage &&
    !selectedDrawing &&
    !selectedSignature
  const keepSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    onHighlightPointerDown()
  }

  const hasContext =
    selectedNewText !== null ||
    selectedImage !== null ||
    selectedDrawing ||
    signatureTool ||
    selectedSignature !== null

  return (
    <>
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Editor tools"
        onWheel={(event) => {
          const bar = event.currentTarget
          if (bar.scrollWidth > bar.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            bar.scrollLeft += event.deltaY
          }
        }}
      >
        <div className="editor-toolbar__tools">
          <div className="tool-group" role="group" aria-label="History">
            <ToolButton
              label="Undo"
              hint={`${MOD}Z`}
              icon="undo"
              disabled={!canUndo}
              shortcut="Control+Z Meta+Z"
              onClick={onUndo}
            />
            <ToolButton
              label="Redo"
              hint={`${MOD}${SHIFT}Z`}
              icon="redo"
              disabled={!canRedo}
              shortcut="Control+Shift+Z Meta+Shift+Z Control+Y"
              onClick={onRedo}
            />
          </div>
          <Divider />
          <div className="tool-group" role="group" aria-label="Mode">
            <ToolButton
              label="Select"
              icon="select"
              pressed={hasDocument && selectActive}
              disabled={!hasDocument}
              onClick={onSelectTool}
            />
            <ToolButton
              label="Add text"
              icon="addText"
              pressed={textTool}
              disabled={pageOpsDisabled}
              onClick={onTextTool}
            />
          </div>
          <Divider />
          <div className="tool-group" role="group" aria-label="Markup">
            <ToolButton
              label="Highlight selected text"
              icon="highlight"
              disabled={pageOpsDisabled || !canHighlight}
              onMouseDown={keepSelection}
              onClick={onHighlight}
            />
            <div className="swatches" role="radiogroup" aria-label="Highlight color">
              {(Object.keys(HIGHLIGHT_COLORS) as HighlightColorName[]).map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  className="swatch"
                  data-color={color}
                  aria-checked={highlightColor === color}
                  aria-label={`${SWATCH_LABELS[color]} highlight`}
                  data-tooltip={`${SWATCH_LABELS[color]}`}
                  disabled={pageOpsDisabled}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    onHighlightColor(color)
                  }}
                />
              ))}
            </div>
            <ToolButton
              label="Underline selected text"
              icon="underline"
              disabled={pageOpsDisabled || !canHighlight}
              onMouseDown={keepSelection}
              onClick={onUnderline}
            />
            <ToolButton
              label="Strike through selected text"
              icon="strikethrough"
              disabled={pageOpsDisabled || !canHighlight}
              onMouseDown={keepSelection}
              onClick={onStrikethrough}
            />
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
          <Divider />
          <div className="tool-group" role="group" aria-label="Draw">
            {DRAW_TOOLS.map(([kind, label, icon]) => (
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
          <Divider />
          <div className="tool-group" role="group" aria-label="Insert">
            <ToolButton
              label="Insert image"
              icon="image"
              disabled={pageOpsDisabled}
              onClick={onInsertImage}
            />
            <ToolButton
              label={hasSignature ? 'Place signature' : 'Create signature'}
              icon="signature"
              pressed={hasSignature ? signatureTool : undefined}
              hasPopup={hasSignature ? undefined : 'dialog'}
              disabled={pageOpsDisabled}
              onClick={onSignature}
            />
          </div>
          <Divider />
          <PageMenu
            currentPage={currentPage}
            disabled={pageOpsDisabled}
            canDeletePage={canDeletePage}
            canMovePageUp={canMovePageUp}
            canMovePageDown={canMovePageDown}
            onRotatePage={onRotatePage}
            onDuplicatePage={onDuplicatePage}
            onAddBlankPage={onAddBlankPage}
            onMovePageUp={onMovePageUp}
            onMovePageDown={onMovePageDown}
            onDeletePage={onDeletePage}
          />
        </div>
        <div className="editor-toolbar__view">
          <SearchControls disabled={!hasDocument} />
          <Divider />
          <PageJump
            currentPage={currentPage}
            pageCount={pageCount}
            disabled={!hasDocument}
            onJumpToPage={onJumpToPage}
          />
          <Divider />
          <div className="tool-group" role="group" aria-label="Zoom">
            <ToolButton
              label="Zoom out"
              icon="zoomOut"
              disabled={!hasDocument || scale <= MIN_PDF_SCALE}
              onClick={onZoomOut}
            />
            <Menu
              label="Zoom"
              align="end"
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  className="zoom-trigger"
                  disabled={!hasDocument}
                  aria-label={`Zoom ${zoomPercent}%`}
                >
                  <span aria-live="polite">{zoomPercent}%</span>
                  <Icon name="chevronDown" size={12} />
                </button>
              )}
            >
              <MenuItem icon="fitWidth" onSelect={onFitWidth}>
                Fit width
              </MenuItem>
              <MenuItem icon="fitPage" onSelect={onFitPage}>
                Fit page
              </MenuItem>
              <MenuSeparator />
              {ZOOM_PRESETS.filter((value) => value >= MIN_PDF_SCALE && value <= MAX_PDF_SCALE).map(
                (value) => (
                  <MenuItem
                    key={value}
                    checked={Math.abs(scale - value) < 0.005}
                    onSelect={() => {
                      onZoomTo(value)
                    }}
                  >
                    {Math.round(value * 100)}%
                  </MenuItem>
                ),
              )}
            </Menu>
            <ToolButton
              label="Zoom in"
              icon="zoomIn"
              disabled={!hasDocument || scale >= MAX_PDF_SCALE}
              onClick={onZoomIn}
            />
          </div>
        </div>
      </div>
      {hasContext ? (
        <div className="context-dock">
          {selectedNewText ? (
            <TextStyleControls selected={selectedNewText} onChange={onNewTextStyle} onDelete={onRemoveHighlight} />
          ) : null}
          {selectedImage ? (
            <div className="context-bar" aria-label="Selected image" role="group">
              <span className="context-bar__title">Image</span>
              <span className="context-bar__metric">
                {Math.round(selectedImage.width)} × {Math.round(selectedImage.height)} pt
              </span>
              <ToolButton label="Delete image" icon="trash" danger onClick={onRemoveHighlight} />
            </div>
          ) : null}
          {selectedDrawing ? (
            <div className="context-bar" aria-label="Selected drawing" role="group">
              <span className="context-bar__title">Drawing</span>
              <ToolButton label="Delete drawing" icon="trash" danger onClick={onRemoveHighlight} />
            </div>
          ) : null}
          {signatureTool ? (
            <div className="context-bar" aria-label="Signature placement" role="group">
              {signaturePreview ? (
                <img className="context-bar__signature" src={signaturePreview} alt="Current signature" />
              ) : null}
              <span className="context-bar__metric">Click a page to place · Esc to stop</span>
              <button
                type="button"
                className="button button--ghost button--sm"
                aria-haspopup="dialog"
                onClick={onNewSignature}
              >
                Redraw
              </button>
            </div>
          ) : null}
          {selectedSignature && !signatureTool ? (
            <div className="context-bar" aria-label="Selected signature" role="group">
              <span className="context-bar__title">Signature</span>
              <span className="context-bar__metric">
                {Math.round(selectedSignature.width)} × {Math.round(selectedSignature.height)} pt
              </span>
              <ToolButton label="Delete signature" icon="trash" danger onClick={onRemoveHighlight} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function Divider() {
  return <span className="tool-divider" aria-hidden="true" />
}

function ToolButton({
  label,
  hint,
  icon,
  pressed,
  disabled,
  danger,
  shortcut,
  hasPopup,
  onClick,
  onMouseDown,
}: {
  label: string
  hint?: string
  icon: IconName
  pressed?: boolean
  disabled?: boolean
  danger?: boolean
  shortcut?: string
  hasPopup?: 'dialog'
  onClick?: () => void
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={danger ? 'tool tool--danger' : 'tool'}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      aria-haspopup={hasPopup}
      data-tooltip={hint ? `${label}  ${hint}` : label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      <Icon name={icon} />
    </button>
  )
}

function PageMenu({
  currentPage,
  disabled,
  canDeletePage,
  canMovePageUp,
  canMovePageDown,
  onRotatePage,
  onDuplicatePage,
  onAddBlankPage,
  onMovePageUp,
  onMovePageDown,
  onDeletePage,
}: {
  currentPage: number
  disabled: boolean
  canDeletePage: boolean
  canMovePageUp: boolean
  canMovePageDown: boolean
  onRotatePage: () => void
  onDuplicatePage: () => void
  onAddBlankPage: () => void
  onMovePageUp: () => void
  onMovePageDown: () => void
  onDeletePage: () => void
}) {
  return (
    <Menu
      label="Page actions"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="tool tool--menu"
          disabled={disabled}
          data-tooltip="Page actions"
        >
          <Icon name="page" />
          <span className="tool__text">Page</span>
          <Icon name="chevronDown" size={12} />
        </button>
      )}
    >
      <MenuHeading>Page {Math.max(currentPage, 1)}</MenuHeading>
      <MenuItem icon="rotate" onSelect={onRotatePage}>
        Rotate clockwise
      </MenuItem>
      <MenuItem icon="duplicate" onSelect={onDuplicatePage}>
        Duplicate
      </MenuItem>
      <MenuItem icon="addPage" onSelect={onAddBlankPage}>
        Insert blank page after
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="moveUp" disabled={!canMovePageUp} onSelect={onMovePageUp}>
        Move up
      </MenuItem>
      <MenuItem icon="moveDown" disabled={!canMovePageDown} onSelect={onMovePageDown}>
        Move down
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="trash" danger disabled={!canDeletePage} onSelect={onDeletePage}>
        Delete page
      </MenuItem>
    </Menu>
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
    <div className="context-bar" role="group" aria-label="Text style" data-new-text-style="">
      <select
        className="field-select field-select--font"
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
      <select
        className="field-select field-select--size"
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
      <label className="color-field" data-tooltip="Text color">
        <span
          className="color-field__chip"
          style={{ background: rgbToHex(selected.color) }}
          aria-hidden="true"
        />
        <input
          className="color-field__input"
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
      <input
        id="page-jump"
        className="page-jump__input"
        inputMode="numeric"
        aria-label={`Page number, ${pageCount} pages`}
        disabled={disabled}
        value={draft}
        size={Math.max(2, String(pageCount).length)}
        onFocus={(event) => {
          setEditing(true)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={commit}
      />
      <span className="page-jump__total" aria-hidden="true">
        / {pageCount > 0 ? pageCount : '—'}
      </span>
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
