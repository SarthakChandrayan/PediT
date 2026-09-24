import type { PageViewport } from 'pdfjs-dist'
import { pdfRectForRun, pdfRectToViewportBox, type LaidOutTextItem } from './coordinates.ts'
import { highlightUnderlays, lineBands } from './highlights.ts'
import { useHighlights } from './HighlightContext.tsx'

type HighlightLayerProps = {
  pageNumber: number
  viewport: PageViewport
}

export function HighlightLayer({ pageNumber, viewport }: HighlightLayerProps) {
  const { markups, selectedId } = useHighlights()
  const marks = markups.filter(
    (markup) => markup.pageNumber === pageNumber && markup.kind !== 'underline' && markup.kind !== 'strikethrough',
  )
  if (marks.length === 0) {
    return null
  }

  return (
    <div className="highlight-layer">
      {marks.map((highlight) =>
        highlight.pdfRects.map((rect, index) => {
          const box = pdfRectToViewportBox(viewport, rect)
          return (
            <div
              key={`${highlight.id}:${index}`}
              className="highlight-mark"
              data-highlight-id={highlight.id}
              data-selected={highlight.id === selectedId ? 'true' : 'false'}
              style={{
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
                background: highlight.color,
                opacity: highlight.opacity,
              }}
            />
          )
        }),
      )}
    </div>
  )
}

/** Paints annotations above an edited run's white cover and below its text. */
export function RunHighlightUnderlay({
  pageNumber,
  run,
}: {
  pageNumber: number
  run: LaidOutTextItem
}) {
  const { markups } = useHighlights()
  const runRect = pdfRectForRun(run)
  const axisAligned = run.box.cssTransform === null
  const bars = [
    ...highlightUnderlays(markups, pageNumber, runRect, axisAligned),
    ...lineBands(markups, pageNumber, runRect, axisAligned),
  ]
  return bars.map((bar) => (
    <span
      key={bar.key}
      className="text-layer__underlay"
      style={{
        left: `${bar.left * 100}%`,
        top: `${bar.top * 100}%`,
        width: `${bar.width * 100}%`,
        height: `${bar.height * 100}%`,
        background: bar.color,
        opacity: bar.opacity,
      }}
    />
  ))
}

/** Underlines and strikethroughs drawn inside a text run so they follow its box. */
export function RunMarkupLines({
  pageNumber,
  run,
}: {
  pageNumber: number
  run: LaidOutTextItem
}) {
  const { markups, selectedId } = useHighlights()
  const bands = lineBands(
    markups,
    pageNumber,
    pdfRectForRun(run),
    run.box.cssTransform === null,
  )
  return bands.map((band) => {
    const id = band.key.split(':')[0]
    return (
      <span
        key={band.key}
        className="text-markup-line"
        data-markup-id={id}
        data-selected={id === selectedId ? 'true' : 'false'}
        style={{
          left: `${band.left * 100}%`,
          top: `${band.top * 100}%`,
          width: `${band.width * 100}%`,
          height: `${band.height * 100}%`,
          background: band.color,
          opacity: band.opacity,
        }}
      />
    )
  })
}
