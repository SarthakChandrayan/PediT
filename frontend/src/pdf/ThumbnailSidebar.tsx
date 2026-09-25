import { useEffect, useRef, useState } from 'react'
import type { RenderTask } from 'pdfjs-dist'
import { Icon } from '../components/icons.tsx'
import type { PDFDocumentProxy } from './pdfjs.ts'
import { thumbnailPageNumbers, THUMBNAIL_CSS_WIDTH } from './pageNavigation.ts'

const THUMBNAIL_PIXEL_RATIO_CAP = 2

type ThumbnailSidebarProps = {
  pdf: PDFDocumentProxy
  currentPage: number
  onSelectPage: (pageNumber: number) => void
}

export function ThumbnailSidebar({ pdf, currentPage, onSelectPage }: ThumbnailSidebarProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const pages = thumbnailPageNumbers(pdf.numPages)

  useEffect(() => {
    const root = listRef.current
    const item = root?.querySelector<HTMLElement>(`[data-thumbnail-page="${currentPage}"]`)
    if (!root || !item) {
      return
    }
    const rootRect = root.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < rootRect.top) {
      root.scrollTop -= rootRect.top - itemRect.top
    } else if (itemRect.bottom > rootRect.bottom) {
      root.scrollTop += itemRect.bottom - rootRect.bottom
    }
  }, [currentPage, pdf])

  return (
    <aside
      className={collapsed ? 'sidebar sidebar--collapsed' : 'sidebar'}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="sidebar__header">
        {collapsed ? null : (
          <div className="sidebar__title">
            <h2>Pages</h2>
            <span className="sidebar__count">{pdf.numPages}</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar__toggle"
          aria-label={collapsed ? 'Expand page sidebar' : 'Collapse page sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show pages' : 'Hide pages'}
          onClick={() => {
            setCollapsed((current) => !current)
          }}
        >
          <Icon name={collapsed ? 'expandSidebar' : 'collapseSidebar'} />
        </button>
      </div>
      <div
        ref={listRef}
        className="thumbnails"
        role="navigation"
        aria-label="Page thumbnails"
      >
        {pages.map((pageNumber) => (
          <Thumbnail
            key={`${pdf.fingerprints?.[0] ?? 'pdf'}:${pageNumber}`}
            pdf={pdf}
            pageNumber={pageNumber}
            selected={pageNumber === currentPage}
            onSelectPage={onSelectPage}
          />
        ))}
      </div>
    </aside>
  )
}

function Thumbnail({
  pdf,
  pageNumber,
  selected,
  onSelectPage,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  selected: boolean
  onSelectPage: (pageNumber: number) => void
}) {
  const itemRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = itemRef.current
    if (!element) {
      return
    }
    const root = element.closest('.thumbnails')
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) {
          return
        }
        setVisible((current) =>
          current === entry.isIntersecting ? current : entry.isIntersecting,
        )
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: '240px 0px',
      },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!visible) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    let cancelled = false
    let task: RenderTask | null = null

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) {
          return
        }
        const base = page.getViewport({ scale: 1 })
        if (base.width <= 0 || base.height <= 0) {
          return
        }
        const viewport = page.getViewport({ scale: THUMBNAIL_CSS_WIDTH / base.width })
        const ratio = Math.min(window.devicePixelRatio || 1, THUMBNAIL_PIXEL_RATIO_CAP)
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        task = page.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        })
        await task.promise
      } catch {
        if (!cancelled) {
          canvas.style.width = `${THUMBNAIL_CSS_WIDTH}px`
        }
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pageNumber, pdf, visible])

  return (
    <button
      ref={itemRef}
      type="button"
      className="thumbnails__item"
      data-thumbnail-page={pageNumber}
      aria-current={selected ? 'page' : undefined}
      aria-label={`Page ${pageNumber}`}
      onClick={() => {
        onSelectPage(pageNumber)
      }}
    >
      <canvas ref={canvasRef} className="thumbnails__canvas" aria-hidden="true" />
      <span className="thumbnails__label">{pageNumber}</span>
    </button>
  )
}
