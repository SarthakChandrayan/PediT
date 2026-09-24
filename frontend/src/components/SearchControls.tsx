import { useEffect, useRef } from 'react'
import { useSearch } from '../pdf/SearchContext.tsx'

export function SearchControls({ disabled }: { disabled: boolean }) {
  const search = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!search.open) {
      return
    }
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [search.focusToken, search.open])

  if (!search.open) {
    return (
      <button
        type="button"
        className="button button--toolbar"
        onClick={search.openSearch}
        disabled={disabled}
        aria-keyshortcuts="Control+F Meta+F"
      >
        Find
      </button>
    )
  }

  const total = search.matches.length
  const countLabel = search.query.length === 0 ? '' : `${total === 0 ? 0 : search.currentMatchIndex + 1} of ${total}`

  return (
    <div className="toolbar__search" role="search">
      <input
        ref={inputRef}
        type="search"
        className="toolbar__search-input"
        value={search.query}
        aria-label="Find in document"
        onChange={(event) => {
          search.setQuery(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            search.closeSearch()
          }
        }}
      />
      <span className="toolbar__search-count" aria-live="polite">
        {countLabel}
      </span>
      <button
        type="button"
        className="button button--toolbar"
        onClick={search.previous}
        disabled={total === 0}
        aria-label="Previous match"
      >
        Prev
      </button>
      <button
        type="button"
        className="button button--toolbar"
        onClick={search.next}
        disabled={total === 0}
        aria-label="Next match"
      >
        Next
      </button>
      <button
        type="button"
        className="button button--toolbar"
        aria-pressed={search.caseSensitive}
        aria-label="Case sensitive"
        onClick={() => {
          search.setCaseSensitive(!search.caseSensitive)
        }}
      >
        Aa
      </button>
      <button
        type="button"
        className="button button--toolbar"
        onClick={search.closeSearch}
        aria-label="Close find"
      >
        Close
      </button>
    </div>
  )
}
