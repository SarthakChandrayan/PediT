import { useEffect, useRef, useState } from 'react'
import type { PageViewport, RenderTask } from 'pdfjs-dist'
import type { PageGeometry } from './coordinates.ts'
import {
  createOutputScale,
  isRenderingCancelled,
  PixelsPerInch,
  type PDFDocumentProxy,
} from './pdfjs.ts'
import { DrawingLayer } from './DrawingLayer.tsx'
import { ImageLayer } from './ImageLayer.tsx'
import { HighlightLayer } from './HighlightLayer.tsx'
import { NewTextLayer } from './NewTextLayer.tsx'
import { SearchHighlightLayer } from './SearchHighlightLayer.tsx'
import { TextLayer } from './TextLayer.tsx'

type PdfPageProps = {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  onGeometry: (geometry: PageGeometry) => void
  onUnregister: (pageNumber: number) => void
}

type PageFrame = {
  cssWidth: number
  cssHeight: number
  viewport: PageViewport
}

export function PdfPage({
  pdf,
  pageNumber,
  scale,
  onGeometry,
  onUnregister,
}: PdfPageProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderQueue = useRef<Promise<void>>(Promise.resolve())
  const [frame, setFrame] = useState<PageFrame | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const element = elementRef.current
    const overlayElement = overlayRef.current
    if (!canvas || !element || !overlayElement) {
      return
    }

    let cancelled = false
    let task: RenderTask | null = null

    const job = renderQueue.current.then(async () => {
      if (cancelled) {
        return
      }

      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) {
          return
        }

        const viewport = page.getViewport({
          scale: scale * PixelsPerInch.PDF_TO_CSS_UNITS,
        })
        const outputScale = createOutputScale(viewport.width, viewport.height)
        const pixelRatioX = outputScale.sx
        const pixelRatioY = outputScale.sy

        element.style.width = `${viewport.width}px`
        element.style.height = `${viewport.height}px`
        setFrame((current) => {
          if (
            current?.cssWidth === viewport.width &&
            current.cssHeight === viewport.height &&
            current.viewport.scale === viewport.scale
          ) {
            return current
          }
          return {
            cssWidth: viewport.width,
            cssHeight: viewport.height,
            viewport,
          }
        })

        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatioX))
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatioY))

        onGeometry({
          pageNumber,
          scale,
          cssWidth: viewport.width,
          cssHeight: viewport.height,
          pixelRatioX,
          pixelRatioY,
          viewport,
          element,
          overlayElement,
        })

        if (cancelled) {
          return
        }

        task = page.render({
          canvas,
          viewport,
          transform:
            pixelRatioX !== 1 || pixelRatioY !== 1
              ? [pixelRatioX, 0, 0, pixelRatioY, 0, 0]
              : undefined,
        })

        await task.promise
        if (!cancelled) {
          setPageError(null)
        }
      } catch (error: unknown) {
        if (cancelled || isRenderingCancelled(error)) {
          return
        }
        setPageError('This page could not be rendered.')
      }
    })

    renderQueue.current = job.then(
      () => undefined,
      () => undefined,
    )

    return () => {
      cancelled = true
      task?.cancel()
      onUnregister(pageNumber)
    }
  }, [onGeometry, onUnregister, pageNumber, pdf, scale])

  return (
    <div
      ref={elementRef}
      className={frame ? 'pdf-page' : 'pdf-page pdf-page--pending'}
      data-page-number={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={
        frame
          ? { width: `${frame.cssWidth}px`, height: `${frame.cssHeight}px` }
          : undefined
      }
    >
      <canvas ref={canvasRef} className="pdf-page__canvas" aria-hidden="true" />
      <div ref={overlayRef} className="pdf-page__overlay" data-overlay-root="">
        {frame ? (
          <>
            <HighlightLayer pageNumber={pageNumber} viewport={frame.viewport} />
            <SearchHighlightLayer pageNumber={pageNumber} viewport={frame.viewport} />
            <DrawingLayer pageNumber={pageNumber} viewport={frame.viewport} />
            <ImageLayer pageNumber={pageNumber} viewport={frame.viewport} />
            <TextLayer
              pdf={pdf}
              pageNumber={pageNumber}
              viewport={frame.viewport}
            />
            <NewTextLayer pageNumber={pageNumber} viewport={frame.viewport} />
          </>
        ) : null}
      </div>
      {pageError ? <p className="pdf-page__error">{pageError}</p> : null}
    </div>
  )
}
