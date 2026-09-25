import { useEffect, useRef } from 'react'
import { useSearch } from '../pdf/SearchContext.tsx'
import { Icon } from './icons.tsx'

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
        className="tool"
        onClick={search.openSearch}
        disabled={disabled}
        aria-label="Find in document"
        data-tooltip="Find"
        aria-keyshortcuts="Control+F Meta+F"
      >
        <Icon name="search" />
      </button>
    )
  }

  const total = search.matches.length
  const countLabel = search.query.length === 0 ? '' : `${total === 0 ? 0 : search.currentMatchIndex + 1} of ${total}`

  return (
    <div className="search-panel" role="search">
      <input
        ref={inputRef}
        type="search"
        className="search-panel__input"
        value={search.query}
        aria-label="Find in document"
        placeholder="Find"
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
      <span className="search-panel__count" aria-live="polite">
        {countLabel}
      </span>
      <button
        type="button"
        className="tool"
        onClick={search.previous}
        disabled={total === 0}
        aria-label="Previous match"
        data-tooltip="Previous match"
      >
        <Icon name="previous" />
      </button>
      <button
        type="button"
        className="tool"
        onClick={search.next}
        disabled={total === 0}
        aria-label="Next match"
        data-tooltip="Next match"
      >
        <Icon name="next" />
      </button>
      <button
        type="button"
        className="tool tool--labeled"
        aria-pressed={search.caseSensitive}
        aria-label="Case sensitive"
        data-tooltip="Case sensitive"
        onClick={() => {
          search.setCaseSensitive(!search.caseSensitive)
        }}
      >
        <span className="tool__text" aria-hidden="true">
          Aa
        </span>
      </button>
      <button
        type="button"
        className="tool"
        onClick={search.closeSearch}
        aria-label="Close find"
        data-tooltip="Close find"
      >
        <Icon name="close" />
      </button>
    </div>
  )
}
