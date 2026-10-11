import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import {
  appearanceForRun,
  cssColor,
  horizontalFitFactor,
  matchTextColor,
  readPageTextCapture,
  replacementFontCss,
  type PdfFontRecord,
  type TextColorSample,
} from './textAppearance.ts'
import {
  pdfPointToViewport,
  pdfRectForRun,
  layoutTextItem,
  type LaidOutTextItem,
} from './coordinates.ts'
import { markupCoveringRect, runAllowsPartialSelection } from './highlights.ts'
import { RunHighlightUnderlay, RunMarkupLines } from './HighlightLayer.tsx'
import { useHighlights } from './HighlightContext.tsx'
import type { PDFDocumentProxy } from './pdfjs.ts'
import { BLOCK_WRAP_SLACK, groupTextBlocks, type TextBlock } from './textBlocks.ts'
import {
  textRunId,
  type TextBlockLayout,
  type TextEditSource,
  type TextRunAppearance,
} from './textEdits.ts'
import { useTextEditor } from './TextEditorContext.tsx'

type PageTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>

type TextLayerProps = {
  pdf: PDFDocumentProxy
  pageNumber: number
  viewport: PageViewport
}

type LoadedText = {
  pdf: PDFDocumentProxy
  pageNumber: number
  textContent: PageTextContent
  colors: readonly TextColorSample[]
  fonts: ReadonlyMap<string, PdfFontRecord>
}

type PositionedRun = {
  id: string
  run: LaidOutTextItem
  appearance: TextRunAppearance
}

export function TextLayer({ pdf, pageNumber, viewport }: TextLayerProps) {
  const editor = useTextEditor()
  const highlights = useHighlights()
  const registerRuns = highlights.registerRuns
  const [loaded, setLoaded] = useState<LoadedText | null>(null)

  useEffect(() => {
    let cancelled = false

    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        const textContent = await page.getTextContent()
        const fontIds = textContent.items.flatMap((item) =>
          isTextItem(item) ? [item.fontName] : [],
        )
        let colors: TextColorSample[] = []
        let fonts = new Map<string, PdfFontRecord>()
        try {
          const captured = await readPageTextCapture(page, fontIds)
          colors = captured.colors
          fonts = captured.fonts
        } catch (error: unknown) {
          console.error(error)
        }
        return { textContent, colors, fonts }
      })
      .then((captured) => {
        if (!cancelled) {
          setLoaded({ pdf, pageNumber, ...captured })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber])

  const textContent =
    loaded?.pdf === pdf && loaded.pageNumber === pageNumber
      ? loaded.textContent
      : null

  const runs = useMemo(() => {
    if (!textContent) {
      return []
    }

    const laidOut: PositionedRun[] = []
    textContent.items.forEach((item, index) => {
      if (!isTextItem(item)) {
        return
      }
      const style = textContent.styles[item.fontName]
      const run = layoutTextItem(viewport, item, style)
      if (!run) {
        return
      }
      const appearance = appearanceForRun({
        transform: run.transform,
        styleFamily: style?.fontFamily,
        font: loaded?.fonts.get(item.fontName),
        color: matchTextColor(run.pdfOrigin.x, run.pdfOrigin.y, loaded?.colors ?? []),
        ascent: style?.ascent,
        descent: style?.descent,
        vertical: style?.vertical,
      })
      laidOut.push({ id: textRunId(pageNumber, index), run, appearance })
    })
    return laidOut
  }, [loaded?.colors, loaded?.fonts, pageNumber, textContent, viewport])

  const blocks = useMemo(() => {
    if (viewport.rotation % 360 !== 0) {
      return { byRun: new Map<string, TextBlock>(), byId: new Map<string, TextBlock>() }
    }
    const eligible = runs.filter(({ run }) => isParagraphRun(run))
    const grouped = groupTextBlocks(
      eligible.map(({ id, run }) => ({
        id,
        str: run.str,
        x: run.pdfOrigin.x,
        baseline: run.pdfOrigin.y,
        width: run.pdfWidth,
        fontSize: Math.hypot(run.transform[2], run.transform[3]),
        fontKey: run.fontName,
      })),
    )
    const byRun = new Map<string, TextBlock>()
    const byId = new Map<string, TextBlock>()
    for (const block of grouped) {
      byId.set(block.id, block)
      for (const runId of block.runIds) {
        byRun.set(runId, block)
      }
    }
    return { byRun, byId }
  }, [runs, viewport.rotation])

  const runsById = useMemo(() => new Map(runs.map((item) => [item.id, item])), [runs])
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null)

  const blockSource = (block: TextBlock): TextEditSource | null => {
    const members = block.runIds
      .map((runId) => runsById.get(runId))
      .filter((item): item is PositionedRun => item !== undefined)
    const first = members[0]
    if (!first) {
      return null
    }
    const layout: TextBlockLayout = {
      left: block.left,
      width: block.width,
      firstBaseline: block.firstBaseline,
      lineHeight: block.lineHeight,
      fontSize: block.fontSize,
      indent: block.indent,
      members: members.map(({ run, appearance }) => ({
        pdfX: run.pdfOrigin.x,
        pdfY: run.pdfOrigin.y,
        width: run.pdfWidth,
        height: run.pdfHeight,
        transform: [...run.transform],
        appearance,
      })),
    }
    return {
      id: block.id,
      pageNumber,
      originalText: block.text,
      pdfX: block.left,
      pdfY: block.firstBaseline,
      width: block.width,
      height: block.firstBaseline - block.lastBaseline + block.fontSize,
      transform: [...first.run.transform],
      fontName: first.appearance.pdfFontName ?? first.run.fontName,
      appearance: first.appearance,
      block: layout,
    }
  }

  const beginBlockEdit = (block: TextBlock, draft: string, caret: number | null) => {
    const source = blockSource(block)
    if (!source) {
      return
    }
    setPendingCaret(caret)
    editor.beginEdit(source, draft)
  }

  useEffect(() => {
    registerRuns(
      pageNumber,
      runs.map(({ id, run }) => ({
        id,
        pageNumber,
        text: run.str,
        hasEOL: run.hasEOL,
        pdfRect: pdfRectForRun(run),
        subdivide: runAllowsPartialSelection({
          vertical: run.vertical,
          axisAligned: run.box.cssTransform === null,
          transform: run.transform,
        }),
      })),
    )
    return () => {
      registerRuns(pageNumber, [])
    }
  }, [pageNumber, registerRuns, runs])

  return (
    <div className="text-layer" aria-label={`Text on page ${pageNumber}`}>
      {hoveredBlock && blocks.byId.has(hoveredBlock) ? (
        <BlockOutline
          frame={blockFrame(blocks.byId.get(hoveredBlock)!, runsById, viewport)}
        />
      ) : null}
      {runs.map(({ id, run, appearance }) => {
        const block = blocks.byRun.get(id)
        if (block) {
          const blockEdit = editor.edits.find((item) => item.id === block.id)
          const activeBlock = editor.active?.id === block.id
          const isFirst = block.runIds[0] === id
          if (activeBlock || blockEdit) {
            if (!isFirst) {
              return null
            }
            const frame = blockFrame(block, runsById, viewport)
            const shownAppearance =
              (activeBlock ? editor.active?.appearance : blockEdit?.appearance) ?? appearance
            if (activeBlock && editor.active) {
              return (
                <BlockEditor
                  key={block.id}
                  frame={frame}
                  run={run}
                  appearance={shownAppearance}
                  draft={editor.active.draft}
                  initialCaret={pendingCaret}
                  onDraft={editor.updateDraft}
                  onCommit={editor.commitEdit}
                  onCancel={editor.cancelEdit}
                />
              )
            }
            return (
              <BlockRevision
                key={block.id}
                frame={frame}
                run={run}
                appearance={shownAppearance}
                text={blockEdit!.editedText}
                onEdit={(caret) => {
                  beginBlockEdit(block, blockEdit!.editedText, caret)
                }}
              />
            )
          }
          return (
            <SelectableRun
              key={id}
              id={id}
              pageNumber={pageNumber}
              run={run}
              inBlock
              onHover={(inside) => {
                setHoveredBlock((current) =>
                  inside ? block.id : current === block.id ? null : current,
                )
              }}
              onClick={(event) => {
                const selection = window.getSelection()
                if (selection && !selection.isCollapsed && selection.toString().length > 0) {
                  return
                }
                const covering = markupCoveringRect(
                  highlights.markups,
                  pageNumber,
                  pdfRectForRun(run),
                )
                if (covering && highlights.selectedId !== covering.id) {
                  highlights.selectMarkup(covering.id)
                  return
                }
                const local = caretOffsetAt(event.clientX, event.clientY, event.currentTarget)
                const caret = local === null ? null : (block.runOffsets[id] ?? 0) + local
                setHoveredBlock(null)
                beginBlockEdit(block, block.text, caret)
              }}
            />
          )
        }

        const edit = editor.edits.find((item) => item.id === id)
        const source = sourceFromRun(id, pageNumber, run, appearance)
        if (editor.active?.id === id) {
          return (
            <TextRunEditor
              key={id}
              pageNumber={pageNumber}
              run={run}
              appearance={editor.active.appearance ?? appearance}
              draft={editor.active.draft}
              onDraft={editor.updateDraft}
              onCommit={editor.commitEdit}
              onCancel={editor.cancelEdit}
            />
          )
        }

        if (edit) {
          return (
            <button
              key={id}
              type="button"
              className="text-layer__revision"
              style={shellStyle(run, edit.appearance ?? appearance)}
              onClick={() => {
                editor.beginEdit(source, edit.editedText)
              }}
            >
              <RunHighlightUnderlay pageNumber={pageNumber} run={run} />
              <FittedReplacement
                className="text-layer__value"
                run={run}
                text={edit.editedText}
                appearance={edit.appearance ?? appearance}
              >
                {edit.editedText}
              </FittedReplacement>
            </button>
          )
        }

        return (
          <SelectableRun
            key={id}
            id={id}
            pageNumber={pageNumber}
            run={run}
            onClick={() => {
              const selection = window.getSelection()
              if (
                selection &&
                !selection.isCollapsed &&
                selection.toString().length > 0
              ) {
                return
              }
              const covering = markupCoveringRect(
                highlights.markups,
                pageNumber,
                pdfRectForRun(run),
              )
              if (covering && highlights.selectedId !== covering.id) {
                highlights.selectMarkup(covering.id)
                return
              }
              editor.beginEdit(source, run.str)
            }}
          />
        )
      })}
    </div>
  )
}

function SelectableRun({
  id,
  pageNumber,
  run,
  inBlock,
  onHover,
  onClick,
}: {
  id: string
  pageNumber: number
  run: LaidOutTextItem
  inBlock?: boolean
  onHover?: (inside: boolean) => void
  onClick: (event: MouseEvent<HTMLSpanElement>) => void
}) {
  const glyphsRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const glyphs = glyphsRef.current
    if (!glyphs) {
      return
    }
    glyphs.style.transform = ''
    if (run.box.cssTransform || run.vertical) {
      return
    }
    const natural = glyphs.scrollWidth
    if (natural <= 0 || run.box.width <= 0) {
      return
    }
    const scale = run.box.width / natural
    if (!Number.isFinite(scale) || scale <= 0) {
      return
    }
    glyphs.style.transform = `scaleX(${scale})`
  }, [run])

  return (
    <span
      className={inBlock ? 'text-layer__item text-layer__item--block' : 'text-layer__item'}
      data-text-run={id}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      style={{
        ...boxStyle(run),
        fontSize: `${run.fontSize}px`,
        lineHeight: 1,
        fontFamily: fontFamilyOf(run),
      }}
      onClick={onClick}
    >
      <RunMarkupLines pageNumber={pageNumber} run={run} />
      <span ref={glyphsRef} className="text-layer__glyphs">
        {run.str}
      </span>
    </span>
  )
}

type TextRunEditorProps = {
  pageNumber: number
  run: LaidOutTextItem
  appearance: TextRunAppearance
  draft: string
  onDraft: (draft: string) => void
  onCommit: () => void
  onCancel: () => void
}

function TextRunEditor({
  pageNumber,
  run,
  appearance,
  draft,
  onDraft,
  onCommit,
  onCancel,
}: TextRunEditorProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ignoreBlur = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
  }, [])

  useLayoutEffect(() => {
    applyReplacementFit(inputRef.current, run.box.width, appearance.vertical === true)
  }, [appearance.vertical, draft, run.box.width])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && shellRef.current?.contains(target)) {
        return
      }
      onCommit()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onCommit])

  return (
    <div ref={shellRef} className="text-layer__editor" style={shellStyle(run, appearance)}>
      <RunHighlightUnderlay pageNumber={pageNumber} run={run} />
      <textarea
        ref={inputRef}
        className="text-layer__field"
        style={valueStyle(run)}
        value={draft}
        rows={1}
        wrap="off"
        aria-label={`Edit ${run.str}`}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          onDraft(event.target.value.replace(/\r?\n/g, ''))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onCommit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            ignoreBlur.current = true
            onCancel()
          }
        }}
        onBlur={() => {
          if (ignoreBlur.current) {
            ignoreBlur.current = false
            return
          }
          onCommit()
        }}
      />
    </div>
  )
}

/** Screen geometry for a paragraph, in CSS pixels relative to the page. */
type BlockFrame = {
  left: number
  top: number
  width: number
  /** Height that covers every original run. */
  coverHeight: number
  fontSize: number
  lineHeight: number
  indent: number
  /** Distance from `top` to the first baseline. */
  baseline: number
}

function blockFrame(
  block: TextBlock,
  runsById: Map<string, PositionedRun>,
  viewport: PageViewport,
): BlockFrame {
  const scale = viewport.scale
  const origin = pdfPointToViewport(viewport, { x: block.left, y: block.firstBaseline })
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  let right = origin.x + block.width * scale
  for (const runId of block.runIds) {
    const box = runsById.get(runId)?.run.box
    if (box) {
      top = Math.min(top, box.top)
      bottom = Math.max(bottom, box.top + box.height)
      right = Math.max(right, box.left + box.width)
    }
  }
  const fontSize = block.fontSize * scale
  const lineHeight = Math.max(block.lineHeight * scale, fontSize)
  const family = 'sans-serif'
  // Put the first baseline of the CSS line box on the PDF baseline.
  const baselineInLine = (lineHeight - fontSize) / 2 + cssBaselineOffset(fontSize, family)
  const frameTop = Math.min(origin.y - baselineInLine, Number.isFinite(top) ? top : origin.y)
  return {
    left: origin.x,
    top: frameTop,
    // Same slack as export (BLOCK_WRAP_SLACK) so screen and saved PDF wrap alike.
    width: Math.max((right - origin.x) * BLOCK_WRAP_SLACK + 0.5 * scale, fontSize),
    coverHeight: Math.max((Number.isFinite(bottom) ? bottom : origin.y) - frameTop, lineHeight),
    fontSize,
    lineHeight,
    indent: block.indent * scale,
    baseline: origin.y - frameTop,
  }
}

function blockStyle(
  frame: BlockFrame,
  run: LaidOutTextItem,
  appearance: TextRunAppearance | undefined,
): CSSProperties {
  const face = replacementFontCss(appearance, run.fontFamily)
  const fontSize = frame.fontSize
  const baselineInLine =
    (frame.lineHeight - fontSize) / 2 + cssBaselineOffset(fontSize, face.fontFamily)
  return {
    left: `${frame.left}px`,
    top: `${frame.top}px`,
    width: `${frame.width}px`,
    minHeight: `${frame.coverHeight}px`,
    // Only the original paragraph area is whited out, exactly as on export;
    // text that runs past it shows over whatever is below.
    background: `linear-gradient(#fff ${frame.coverHeight}px, transparent ${frame.coverHeight}px)`,
    paddingTop: `${Math.max(0, frame.baseline - baselineInLine)}px`,
    textIndent: `${frame.indent}px`,
    fontSize: `${fontSize}px`,
    lineHeight: `${frame.lineHeight}px`,
    fontFamily: face.fontFamily,
    fontWeight: face.fontWeight,
    fontStyle: face.fontStyle,
    color: appearance?.color ? cssColor(appearance.color) : undefined,
  }
}

function BlockOutline({ frame }: { frame: BlockFrame }) {
  return (
    <div
      className="text-block-outline"
      aria-hidden="true"
      style={{
        left: `${frame.left - 3}px`,
        top: `${frame.top - 2}px`,
        width: `${frame.width + 6}px`,
        height: `${frame.coverHeight + 4}px`,
      }}
    />
  )
}

function BlockEditor({
  frame,
  run,
  appearance,
  draft,
  initialCaret,
  onDraft,
  onCommit,
  onCancel,
}: {
  frame: BlockFrame
  run: LaidOutTextItem
  appearance: TextRunAppearance | undefined
  draft: string
  initialCaret: number | null
  onDraft: (draft: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ignoreBlur = useRef(false)
  const [overflow, setOverflow] = useState(false)
  const caretRef = useRef(initialCaret)

  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus({ preventScroll: true })
    const caret = caretRef.current ?? input.value.length
    const clamped = Math.min(Math.max(caret, 0), input.value.length)
    input.setSelectionRange(clamped, clamped)
  }, [])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    // Grow with the text like a word-processor paragraph.
    input.style.height = 'auto'
    input.style.height = `${Math.max(input.scrollHeight, frame.coverHeight)}px`
    setOverflow(input.scrollHeight > frame.coverHeight + frame.lineHeight * 0.5)
  }, [draft, frame.coverHeight, frame.lineHeight])

  const style = blockStyle(frame, run, appearance)
  return (
    <>
    <textarea
      ref={inputRef}
      className="text-block text-block--editing"
      data-overflow={overflow ? 'true' : undefined}
      style={style}
      value={draft}
      aria-label="Edit paragraph"
      aria-describedby={overflow ? 'block-overflow-note' : undefined}
      spellCheck
      autoComplete="off"
      onChange={(event) => {
        onDraft(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          ignoreBlur.current = true
          onCancel()
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          onCommit()
        }
      }}
      onBlur={() => {
        if (ignoreBlur.current) {
          ignoreBlur.current = false
          return
        }
        onCommit()
      }}
    />
    {overflow ? (
      <p
        id="block-overflow-note"
        className="text-block-note"
        style={{ left: `${frame.left}px`, top: `${frame.top - 30}px` }}
      >
        Text runs past the original paragraph and may overlap what's below.
      </p>
    ) : null}
    </>
  )
}

function BlockRevision({
  frame,
  run,
  appearance,
  text,
  onEdit,
}: {
  frame: BlockFrame
  run: LaidOutTextItem
  appearance: TextRunAppearance | undefined
  text: string
  onEdit: (caret: number | null) => void
}) {
  return (
    <div
      className="text-block text-block--revised"
      style={blockStyle(frame, run, appearance)}
      role="button"
      tabIndex={0}
      aria-label="Edited paragraph. Click to edit."
      onClick={(event) => {
        onEdit(caretOffsetAt(event.clientX, event.clientY, event.currentTarget))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onEdit(null)
        }
      }}
    >
      {text}
    </div>
  )
}

/** Character offset of the point within `container`'s text, or null. */
function caretOffsetAt(x: number, y: number, container: HTMLElement): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let offset = 0
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) {
    node = position.offsetNode
    offset = position.offset
  } else {
    const range = doc.caretRangeFromPoint?.(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  }
  if (!node || !container.contains(node) || node.nodeType !== Node.TEXT_NODE) {
    return null
  }
  // Count characters in text nodes before this one inside the container.
  let total = 0
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === node) {
      return total + offset
    }
    if (!(current.parentElement?.closest('[aria-hidden="true"]'))) {
      total += current.textContent?.length ?? 0
    }
  }
  return null
}

/** Horizontal, unrotated runs can be edited as paragraphs. */
function isParagraphRun(run: LaidOutTextItem): boolean {
  const [a, b, c, d] = run.transform
  return (
    !run.vertical &&
    run.box.cssTransform === null &&
    a > 0 &&
    d > 0 &&
    Math.abs(b) < 1e-6 &&
    Math.abs(c) < 1e-6
  )
}

function sourceFromRun(
  id: string,
  pageNumber: number,
  run: LaidOutTextItem,
  appearance: TextRunAppearance,
): TextEditSource {
  return {
    id,
    pageNumber,
    originalText: run.str,
    pdfX: run.pdfOrigin.x,
    pdfY: run.pdfOrigin.y,
    width: run.pdfWidth,
    height: run.pdfHeight,
    transform: run.transform,
    fontName: appearance.pdfFontName ?? run.fontName,
    appearance,
  }
}

function boxStyle(run: LaidOutTextItem): CSSProperties {
  return {
    left: `${run.box.left}px`,
    top: `${run.box.top}px`,
    width: `${run.box.width}px`,
    height: `${run.box.height}px`,
    transform: run.box.cssTransform ?? undefined,
  }
}

function FittedReplacement({
  className,
  run,
  text,
  appearance,
  children,
}: {
  className: string
  run: LaidOutTextItem
  text: string
  appearance?: TextRunAppearance
  children: string
}) {
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    applyReplacementFit(textRef.current, run.box.width, appearance?.vertical === true)
  }, [appearance?.vertical, run.box.width, text])

  return (
    <span ref={textRef} className={className} style={valueStyle(run)}>
      {children}
    </span>
  )
}

function applyReplacementFit(
  element: HTMLElement | null,
  originalWidth: number,
  vertical: boolean,
): void {
  if (!element) {
    return
  }
  element.style.transform = ''
  const factor = horizontalFitFactor(element.scrollWidth, originalWidth, vertical)
  if (factor < 1) {
    element.style.transformOrigin = '0 0'
    element.style.transform = `scaleX(${factor})`
  }
}

function shellStyle(run: LaidOutTextItem, appearance?: TextRunAppearance): CSSProperties {
  const shift = textShift(run)
  const face = replacementFontCss(appearance, run.fontFamily)
  return {
    ...boxStyle(run),
    height: `${Math.max(run.box.height, shift + run.fontSize)}px`,
    overflow: 'hidden',
    fontSize: `${run.fontSize}px`,
    lineHeight: 1,
    fontFamily: face.fontFamily,
    fontWeight: face.fontWeight,
    fontStyle: face.fontStyle,
    color: appearance?.color ? cssColor(appearance.color) : undefined,
  }
}

function valueStyle(run: LaidOutTextItem): CSSProperties {
  return {
    marginTop: `${textShift(run)}px`,
  }
}

function fontFamilyOf(run: LaidOutTextItem): string {
  return run.fontFamily ? `${run.fontFamily}, sans-serif` : 'sans-serif'
}

const cssBaselineCache = new Map<string, number>()

function textShift(run: LaidOutTextItem): number {
  if (run.vertical) {
    return 0
  }

  const pdfBaseline = run.ascent * run.fontSize
  return pdfBaseline - cssBaselineOffset(run.fontSize, fontFamilyOf(run))
}

/** Distance from the top of a line-height:1 box to the alphabetic baseline. */
function cssBaselineOffset(fontSize: number, fontFamily: string): number {
  const key = `${fontSize}|${fontFamily}`
  const cached = cssBaselineCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.left = '-9999px'
  host.style.visibility = 'hidden'
  host.style.fontSize = `${fontSize}px`
  host.style.lineHeight = '1'
  host.style.fontFamily = fontFamily
  host.textContent = 'Hg'
  const probe = document.createElement('span')
  probe.style.display = 'inline-block'
  probe.style.width = '0'
  probe.style.height = '0'
  probe.style.verticalAlign = 'baseline'
  host.appendChild(probe)
  document.body.appendChild(host)
  const baseline = probe.offsetTop - host.offsetTop
  host.remove()
  const value = baseline > 0 ? baseline : fontSize * 0.8
  cssBaselineCache.set(key, value)
  return value
}

function isTextItem(
  item: PageTextContent['items'][number],
): item is PageTextContent['items'][number] & {
  str: string
  dir: string
  transform: unknown[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
} {
  return (
    'str' in item &&
    typeof item.str === 'string' &&
    'transform' in item &&
    Array.isArray(item.transform)
  )
}
