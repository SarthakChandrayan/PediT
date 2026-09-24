import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import {
  appearanceForRun,
  cssColor,
  cssFontFamily,
  horizontalFitFactor,
  matchTextColor,
  readPageTextCapture,
  resolveStandardFont,
  type PdfFontRecord,
  type TextColorSample,
} from './textAppearance.ts'
import { pdfRectForRun, layoutTextItem, type LaidOutTextItem } from './coordinates.ts'
import { markupCoveringRect, runAllowsPartialSelection } from './highlights.ts'
import { RunHighlightUnderlay, RunMarkupLines } from './HighlightLayer.tsx'
import { useHighlights } from './HighlightContext.tsx'
import type { PDFDocumentProxy } from './pdfjs.ts'
import { textRunId, type TextEditSource, type TextRunAppearance } from './textEdits.ts'
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
      {runs.map(({ id, run, appearance }) => {
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
  onClick,
}: {
  id: string
  pageNumber: number
  run: LaidOutTextItem
  onClick: () => void
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
      className="text-layer__item"
      data-text-run={id}
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
  const standard = appearance ? resolveStandardFont(appearance) : null
  return {
    ...boxStyle(run),
    height: `${Math.max(run.box.height, shift + run.fontSize)}px`,
    overflow: 'hidden',
    fontSize: `${run.fontSize}px`,
    lineHeight: 1,
    fontFamily: standard ? cssFontFamily(standard) : fontFamilyOf(run),
    fontWeight: appearance?.bold ? 700 : undefined,
    fontStyle: appearance?.italic ? 'italic' : undefined,
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
