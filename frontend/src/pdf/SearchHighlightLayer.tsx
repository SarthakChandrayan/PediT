import type { PageViewport } from 'pdfjs-dist'
import { pdfRectToViewportBox } from './coordinates.ts'
import { searchHitsForPage } from './search.ts'
import { useSearch } from './SearchContext.tsx'

type SearchHighlightLayerProps = {
  pageNumber: number
  viewport: PageViewport
}

/**
 * Temporary find highlights. They are not text markup annotations.
 * The layer is omitted when search is closed, and it never receives pointer events.
 */
export function SearchHighlightLayer({ pageNumber, viewport }: SearchHighlightLayerProps) {
  const search = useSearch()
  const hits = searchHitsForPage(search.open, search.matches, pageNumber)
  if (hits.length === 0) {
    return null
  }

  return (
    <div className="search-layer" aria-hidden="true">
      {hits.map((match) =>
        match.pdfRects.map((rect, rectIndex) => {
          const box = pdfRectToViewportBox(viewport, rect)
          const current = match.index === search.currentMatchIndex
          return (
            <div
              key={`${match.index}:${rectIndex}`}
              className={current ? 'search-hit search-hit--current' : 'search-hit'}
              data-search-match={match.index}
              style={{
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }}
            />
          )
        }),
      )}
    </div>
  )
}
