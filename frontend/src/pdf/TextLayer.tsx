import {
  useCallback,
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
  appearanceKey,
  isBold,
  isItalic,
  restyleRange,
  styleIndex,
  styleVariant,
  stylesInRange,
  type StylePatch,
} from './richText.ts'
import { Icon } from '../components/icons.tsx'
import {
  textRunId,
  type TextBlockLayout,
  type TextEditSource,
  type TextSegment,
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
  const pageStyles = useMemo(() => {
    const unique = new Map<string, TextRunAppearance>()
    for (const { appearance } of runs) {
      unique.set(appearanceKey(appearance), appearance)
    }
    return [...unique.values()]
  }, [runs])
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
    const styles: TextRunAppearance[] = []
    const styleKeys: string[] = []
    const styleOf = (appearance: TextRunAppearance): number => {
      const key = appearanceKey(appearance)
      const found = styleKeys.indexOf(key)
      if (found >= 0) {
        return found
      }
      styleKeys.push(key)
      styles.push(appearance)
      return styles.length - 1
    }
    const runStyles = new Map(members.map(({ id, appearance }) => [id, styleOf(appearance)]))
    const segments: TextSegment[] = block.segments.map((segment) => ({
      text: segment.text,
      style: runStyles.get(segment.runId) ?? 0,
    }))
    // Where the rest of the page's text sits, so export can move it down
    // when the paragraph grows.
    const memberIds = new Set(block.runIds)
    const blockBottom = Math.min(...members.map(({ run }) => pdfRectForRun(run).y))
    let pageTextTop = Number.NEGATIVE_INFINITY
    const bands: { top: number; bottom: number }[] = []
    for (const item of runs) {
      const rect = pdfRectForRun(item.run)
      pageTextTop = Math.max(pageTextTop, rect.y + rect.height)
      if (!memberIds.has(item.id) && rect.y + rect.height <= blockBottom + 0.5) {
        bands.push({ top: rect.y + rect.height, bottom: rect.y })
      }
    }
    const below = mergeBands(bands)
    const layout: TextBlockLayout = {
      lineCount: block.lines.length,
      below,
      pageTextTop: Number.isFinite(pageTextTop) ? pageTextTop : undefined,
      styles,
      left: block.left,
      width: wrapWidthFor(block),
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
      segments,
    }
  }

  /**
   * Width new text wraps at. A real paragraph keeps its own width. A block
   * whose line breaks are all deliberate (a list, "Label: values" lines) can
   * use the page's text column, like a word processor: up to a right margin
   * equal to the left one, unless other text sits beside the block.
   */
  const wrapWidthFor = (block: TextBlock): number => {
    const hardBreaks = (block.text.match(/\n/g) ?? []).length
    if (hardBreaks < block.lines.length - 1) {
      return block.width
    }
    const [pageLeft, , pageRight] = viewport.viewBox as [number, number, number, number]
    const columnRight = pageRight - (block.left - pageLeft)
    const blockRight = block.left + block.width
    if (columnRight <= blockRight) {
      return block.width
    }
    const members = new Set(block.runIds)
    const beside = runs.some(
      ({ id, run }) =>
        !members.has(id) &&
        run.pdfOrigin.x > blockRight + block.fontSize &&
        run.pdfOrigin.y <= block.firstBaseline + block.fontSize &&
        run.pdfOrigin.y >= block.lastBaseline - block.fontSize,
    )
    return beside ? block.width : columnRight - block.left
  }

  const beginBlockEdit = (
    block: TextBlock,
    draft: string,
    draftSegments: readonly TextSegment[] | undefined,
    caret: number | null,
  ) => {
    const source = blockSource(block)
    if (!source) {
      return
    }
    setPendingCaret(caret)
    editor.beginEdit(source, draft, draftSegments)
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
            const frame = blockFrame(block, runsById, viewport, wrapWidthFor(block))
            if (activeBlock && editor.active) {
              const styles = editor.active.block?.styles ?? [appearance]
              return (
                <BlockEditor
                  key={block.id}
                  frame={frame}
                  run={run}
                  styles={styles}
                  pageStyles={pageStyles}
                  segments={editor.active.draftSegments ?? [{ text: editor.active.draft, style: 0 }]}
                  initialCaret={pendingCaret}
                  onDraft={editor.updateDraft}
                  onCommit={(grew) => {
                    editor.commitEdit()
                    if (grew) {
                      editor.requestReflow?.()
                    }
                  }}
                  onCancel={editor.cancelEdit}
                />
              )
            }
            const edited = blockEdit!
            return (
              <BlockRevision
                key={block.id}
                frame={frame}
                run={run}
                styles={edited.block?.styles ?? [edited.appearance ?? appearance]}
                segments={edited.segments ?? [{ text: edited.editedText, style: 0 }]}
                onEdit={(caret) => {
                  beginBlockEdit(block, edited.editedText, edited.segments, caret)
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
                beginBlockEdit(block, block.text, undefined, caret)
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
  wrapWidth: number = block.width,
): BlockFrame {
  const scale = viewport.scale
  const origin = pdfPointToViewport(viewport, { x: block.left, y: block.firstBaseline })
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  let right = origin.x + wrapWidth * scale
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

const INK_COLORS = [
  { name: 'Black', value: { r: 0, g: 0, b: 0 } },
  { name: 'Dark gray', value: { r: 0.33, g: 0.33, b: 0.33 } },
  { name: 'Red', value: { r: 0.8, g: 0.12, b: 0.12 } },
  { name: 'Blue', value: { r: 0.11, g: 0.36, b: 0.85 } },
  { name: 'Green', value: { r: 0.12, g: 0.54, b: 0.3 } },
] as const

function BlockEditor({
  frame,
  run,
  styles,
  pageStyles,
  segments,
  initialCaret,
  onDraft,
  onCommit,
  onCancel,
}: {
  frame: BlockFrame
  run: LaidOutTextItem
  styles: readonly TextRunAppearance[]
  /** Every style on the page, to find matching bold/italic faces. */
  pageStyles: readonly TextRunAppearance[]
  segments: readonly TextSegment[]
  initialCaret: number | null
  onDraft: (
    draft: string,
    draftSegments: readonly TextSegment[],
    styles: readonly TextRunAppearance[],
  ) => void
  /** `grew` is true when the text now needs more lines than the original. */
  onCommit: (grew: boolean) => void
  onCancel: () => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const ignoreBlur = useRef(false)
  const stylesRef = useRef<readonly TextRunAppearance[]>(styles)
  const [overflow, setOverflow] = useState(false)
  const [active, setActive] = useState({ bold: false, italic: false })
  // Rendered once: after mount the browser owns the DOM, and every change is
  // read back from it. Re-rendering the spans would reset the caret.
  const [initial] = useState(() => ({ segments, caret: initialCaret, styles }))

  const measure = useCallback(() => {
    const element = editorRef.current
    if (element) {
      setOverflow(element.scrollHeight > frame.coverHeight + frame.lineHeight * 0.5)
    }
  }, [frame.coverHeight, frame.lineHeight])

  useEffect(() => {
    const element = editorRef.current
    if (!element) {
      return
    }
    element.focus({ preventScroll: true })
    const total = element.textContent?.length ?? 0
    placeCaret(element, Math.min(Math.max(initial.caret ?? total, 0), total))
    measure()
  }, [initial.caret, measure])

  // Reflect the selection's weight and slant in the format bar.
  useEffect(() => {
    const onSelection = () => {
      const root = editorRef.current
      const range = selectionRangeIn(root)
      if (!root || !range) {
        return
      }
      const current = readSegments(root)
      let [from, to] = range
      if (from === to) {
        from = Math.max(0, from - 1)
        to = from + 1
      }
      const used = stylesInRange(current, from, to)
      const list = stylesRef.current
      const bold = used.length > 0 && used.every((index) => list[index] && isBold(list[index]!))
      const italic =
        used.length > 0 && used.every((index) => list[index] && isItalic(list[index]!))
      setActive((previous) =>
        previous.bold === bold && previous.italic === italic ? previous : { bold, italic },
      )
    }
    document.addEventListener('selectionchange', onSelection)
    return () => {
      document.removeEventListener('selectionchange', onSelection)
    }
  }, [])

  const grew = () => {
    const element = editorRef.current
    return element ? element.scrollHeight > frame.coverHeight + frame.lineHeight * 0.5 : false
  }

  const emit = () => {
    const element = editorRef.current
    if (!element) {
      return
    }
    const next = readSegments(element)
    onDraft(next.map((segment) => segment.text).join(''), next, stylesRef.current)
    measure()
  }

  const format = (kind: 'bold' | 'italic' | { color: { r: number; g: number; b: number } }) => {
    const root = editorRef.current
    const range = selectionRangeIn(root)
    if (!root || !range || range[0] === range[1]) {
      return
    }
    const [from, to] = range
    const current = readSegments(root)
    let list = stylesRef.current
    const used = stylesInRange(current, from, to)
    let patch: StylePatch
    if (kind === 'bold') {
      patch = { bold: !used.every((index) => list[index] && isBold(list[index]!)) }
    } else if (kind === 'italic') {
      patch = { italic: !used.every((index) => list[index] && isItalic(list[index]!)) }
    } else {
      patch = { color: kind.color }
    }
    const remap = new Map<number, number>()
    for (const index of used) {
      const base = list[index]
      if (!base) {
        continue
      }
      const added = styleIndex(list, styleVariant(base, patch, pageStyles))
      list = added.styles
      remap.set(index, added.index)
    }
    const next = restyleRange(current, from, to, (style) => remap.get(style) ?? style)
    stylesRef.current = list
    renderSegments(root, next, list, run)
    selectOffsets(root, from, to)
    onDraft(next.map((segment) => segment.text).join(''), next, list)
    measure()
  }

  const base = initial.styles[0]
  const keepFocus = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
  }
  return (
    <>
      <div
        className="text-block-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        style={{ left: `${frame.left}px`, top: `${frame.top - 44}px` }}
        onMouseDown={keepFocus}
      >
        <button
          type="button"
          className="text-block-toolbar__button"
          aria-pressed={active.bold}
          aria-label="Bold"
          data-tooltip="Bold  Ctrl+B"
          onClick={() => format('bold')}
        >
          <Icon name="bold" />
        </button>
        <button
          type="button"
          className="text-block-toolbar__button"
          aria-pressed={active.italic}
          aria-label="Italic"
          data-tooltip="Italic  Ctrl+I"
          onClick={() => format('italic')}
        >
          <Icon name="italic" />
        </button>
        <span className="text-block-toolbar__divider" aria-hidden="true" />
        {INK_COLORS.map((color) => (
          <button
            key={color.name}
            type="button"
            className="text-block-toolbar__swatch"
            aria-label={`${color.name} text`}
            data-tooltip={color.name}
            style={{ background: cssColor(color.value) }}
            onClick={() => format({ color: color.value })}
          />
        ))}
      </div>
      <div
        ref={editorRef}
        className="text-block text-block--editing"
        data-overflow={overflow ? 'true' : undefined}
        style={blockStyle(frame, run, base)}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Edit paragraph"
        aria-describedby={overflow ? 'block-overflow-note' : undefined}
        spellCheck
        onInput={emit}
        onBeforeInput={(event) => {
          // The browser's own formatting adds tags; formatting goes through format().
          const type = (event.nativeEvent as InputEvent).inputType
          if (type?.startsWith('format')) {
            event.preventDefault()
          }
        }}
        onPaste={(event) => {
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
          insertPlainText(text)
          emit()
        }}
        onDrop={(event) => {
          event.preventDefault()
        }}
        onKeyDown={(event) => {
          const meta = event.ctrlKey || event.metaKey
          const key = event.key.toLowerCase()
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            ignoreBlur.current = true
            onCancel()
          } else if (event.key === 'Enter' && meta) {
            event.preventDefault()
            onCommit(grew())
          } else if (event.key === 'Enter') {
            event.preventDefault()
            insertPlainText('\n')
            emit()
          } else if (meta && key === 'b') {
            event.preventDefault()
            format('bold')
          } else if (meta && key === 'i') {
            event.preventDefault()
            format('italic')
          } else if (meta && key === 'u') {
            event.preventDefault()
          }
        }}
        onBlur={() => {
          if (ignoreBlur.current) {
            ignoreBlur.current = false
            return
          }
          onCommit(grew())
        }}
      >
        {initial.segments.map((segment, index) => (
          <span
            key={index}
            data-style={segment.style}
            style={segmentStyle(initial.styles[segment.style] ?? base, run)}
          >
            {segment.text}
          </span>
        ))}
      </div>
      {overflow ? (
        <p
          id="block-overflow-note"
          className="text-block-note"
          style={{ left: `${frame.left + frame.width}px`, top: `${frame.top - 30}px` }}
        >
          Text below will move down to make room.
        </p>
      ) : null}
    </>
  )
}

function BlockRevision({
  frame,
  run,
  styles,
  segments,
  onEdit,
}: {
  frame: BlockFrame
  run: LaidOutTextItem
  styles: readonly TextRunAppearance[]
  segments: readonly TextSegment[]
  onEdit: (caret: number | null) => void
}) {
  const base = styles[0]
  return (
    <div
      className="text-block text-block--revised"
      style={blockStyle(frame, run, base)}
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
      {segments.map((segment, index) => (
        <span key={index} style={segmentStyle(styles[segment.style] ?? base, run)}>
          {segment.text}
        </span>
      ))}
    </div>
  )
}

function segmentStyle(appearance: TextRunAppearance | undefined, run: LaidOutTextItem): CSSProperties {
  const face = replacementFontCss(appearance, run.fontFamily)
  // Explicit, so a regular piece never inherits the paragraph's bold base.
  return {
    fontFamily: face.fontFamily,
    fontWeight: face.fontWeight ?? 400,
    fontStyle: face.fontStyle ?? 'normal',
    color: appearance?.color ? cssColor(appearance.color) : undefined,
  }
}

type DomToken = { node: Node; start: number; text: string; style: number }

/**
 * The editable paragraph as ordered pieces of text. A <br>, or the start of a
 * block element after text, counts as one "\n", matching readSegments.
 */
function flattenTokens(root: HTMLElement): DomToken[] {
  const tokens: DomToken[] = []
  let length = 0
  let lastChar = ''
  const add = (node: Node, text: string, style: number) => {
    if (text.length === 0) {
      return
    }
    tokens.push({ node, start: length, text, style })
    length += text.length
    lastChar = text[text.length - 1]!
  }
  const walk = (node: Node, style: number) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        add(child, child.textContent ?? '', style)
        return
      }
      if (!(child instanceof HTMLElement)) {
        return
      }
      if (child.tagName === 'BR') {
        add(child, '\n', style)
        return
      }
      const own = child.dataset.style
      const childStyle = own !== undefined && Number.isFinite(Number(own)) ? Number(own) : style
      if ((child.tagName === 'DIV' || child.tagName === 'P') && length > 0 && lastChar !== '\n') {
        add(child, '\n', childStyle)
      }
      walk(child, childStyle)
    })
  }
  walk(root, 0)
  return tokens
}

/** Plain-text offset of a DOM position inside `root`. */
function domOffset(root: HTMLElement, container: Node, offset: number): number {
  const tokens = flattenTokens(root)
  const total = tokens.reduce((sum, token) => sum + token.text.length, 0)
  if (container.nodeType === Node.TEXT_NODE) {
    const token = tokens.find((item) => item.node === container)
    return token ? token.start + Math.min(offset, token.text.length) : total
  }
  const child = container.childNodes[offset]
  if (!child) {
    // After the container's last child: the end of the last token inside it.
    let end = -1
    for (const token of tokens) {
      if (container === token.node || container.contains(token.node)) {
        end = token.start + token.text.length
      }
    }
    if (end >= 0) {
      return end
    }
  }
  for (const token of tokens) {
    if (
      child &&
      (token.node === child ||
        child.contains(token.node) ||
        child.compareDocumentPosition(token.node) & Node.DOCUMENT_POSITION_FOLLOWING)
    ) {
      return token.start
    }
  }
  return total
}

/** The selection as [start, end) offsets in `root`'s text, or null. */
function selectionRangeIn(root: HTMLElement | null): [number, number] | null {
  const selection = window.getSelection()
  if (!root || !selection || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null
  }
  const a = domOffset(root, range.startContainer, range.startOffset)
  const b = domOffset(root, range.endContainer, range.endOffset)
  return a <= b ? [a, b] : [b, a]
}

/** Replaces the paragraph's DOM with one span per styled segment. */
function renderSegments(
  root: HTMLElement,
  segments: readonly TextSegment[],
  styles: readonly TextRunAppearance[],
  run: LaidOutTextItem,
): void {
  const spans = segments.map((segment) => {
    const span = document.createElement('span')
    span.dataset.style = String(segment.style)
    Object.assign(span.style, segmentStyle(styles[segment.style] ?? styles[0], run))
    span.textContent = segment.text
    return span
  })
  root.replaceChildren(...spans)
}

/** Selects [start, end) of `root`'s text. */
function selectOffsets(root: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection()
  if (!selection) {
    return
  }
  const locate = (target: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let remaining = target
    let last: Text | null = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      last = text
      if (remaining <= text.length) {
        return [text, remaining]
      }
      remaining -= text.length
    }
    return last ? [last, last.length] : [root, 0]
  }
  const range = document.createRange()
  const [startNode, startOffset] = locate(start)
  const [endNode, endOffset] = locate(end)
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Reads styled text back out of the editable paragraph. */
function readSegments(root: HTMLElement): TextSegment[] {
  const segments: TextSegment[] = []
  for (const token of flattenTokens(root)) {
    const last = segments[segments.length - 1]
    if (last && last.style === token.style) {
      last.text += token.text
    } else {
      segments.push({ text: token.text, style: token.style })
    }
  }
  return segments
}

/** Inserts text at the caret as the browser would, keeping undo history. */
function insertPlainText(text: string): void {
  if (text.length === 0) {
    return
  }
  // execCommand is deprecated but remains the only way to keep native undo.
  if (document.execCommand('insertText', false, text)) {
    return
  }
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  if (!selection || !range) {
    return
  }
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Puts the caret `offset` characters into `root`'s text. */
function placeCaret(root: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (!selection) {
    return
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    last = text
    if (remaining <= text.length) {
      selection.collapse(text, remaining)
      return
    }
    remaining -= text.length
  }
  if (last) {
    selection.collapse(last, last.length)
  } else {
    selection.collapse(root, 0)
  }
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

/** Sorts bands top-down and merges ones that overlap vertically. */
function mergeBands(bands: { top: number; bottom: number }[]): { top: number; bottom: number }[] {
  const sorted = [...bands].sort((a, b) => b.top - a.top)
  const merged: { top: number; bottom: number }[] = []
  for (const band of sorted) {
    const last = merged[merged.length - 1]
    if (last && band.top >= last.bottom) {
      last.bottom = Math.min(last.bottom, band.bottom)
    } else {
      merged.push({ ...band })
    }
  }
  return merged
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
