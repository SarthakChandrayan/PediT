import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useDocumentHistory } from './DocumentHistoryContext.tsx'
import {
  applyVisibleText,
  clampMatchIndex,
  clearSearch,
  createSearchModel,
  editsAsVisible,
  findTextMatches,
  openSearch,
  searchModelForDocument,
  selectSearchMatch,
  setSearchCaseSensitive,
  setSearchQuery,
  stepSearch,
  type LiveSearchEdit,
  type SearchMatch,
  type SearchModel,
  type SearchPage,
} from './search.ts'

export type SearchApi = {
  open: boolean
  query: string
  caseSensitive: boolean
  matches: readonly SearchMatch[]
  currentMatchIndex: number
  currentMatch: SearchMatch | null
  /** Changes when the user should be scrolled to the current match. */
  navigationToken: number
  focusToken: number
  setQuery: (query: string) => void
  setCaseSensitive: (caseSensitive: boolean) => void
  openSearch: () => void
  closeSearch: () => void
  next: () => void
  previous: () => void
  selectMatch: (index: number) => void
  setPages: (pages: readonly SearchPage[]) => void
  setLiveEdit: (edit: LiveSearchEdit | null) => void
}

const SearchContext = createContext<SearchApi | null>(null)

export function SearchProvider({
  documentSession,
  children,
}: {
  documentSession: number
  children: ReactNode
}) {
  const history = useDocumentHistory()
  const [session, setSession] = useState(documentSession)
  const [pages, setPages] = useState<readonly SearchPage[]>([])
  const [live, setLive] = useState<LiveSearchEdit | null>(null)
  const [model, setModel] = useState<SearchModel>(createSearchModel)
  const [navigationToken, setNavigationToken] = useState(0)
  const [focusToken, setFocusToken] = useState(0)

  if (session !== documentSession) {
    setSession(documentSession)
    setPages([])
    setLive(null)
    setModel((current) => searchModelForDocument(current, false))
    setNavigationToken(0)
  }

  const edits = history.view.edits
  const matches = useMemo(
    () => findTextMatches(applyVisibleText(pages, editsAsVisible(edits), live), model.query, model.caseSensitive),
    [edits, live, model.caseSensitive, model.query, pages],
  )
  const currentMatchIndex = clampMatchIndex(model.currentMatchIndex, matches.length)
  const currentMatch = currentMatchIndex >= 0 ? matches[currentMatchIndex] ?? null : null

  const bumpNavigation = useCallback(() => {
    setNavigationToken((current) => current + 1)
  }, [])

  const api = useMemo<SearchApi>(
    () => ({
      open: model.open,
      query: model.query,
      caseSensitive: model.caseSensitive,
      matches,
      currentMatchIndex,
      currentMatch,
      navigationToken,
      focusToken,
      setQuery(query: string) {
        setModel((current) => setSearchQuery(current, query))
        bumpNavigation()
      },
      setCaseSensitive(caseSensitive: boolean) {
        setModel((current) => setSearchCaseSensitive(current, caseSensitive))
        bumpNavigation()
      },
      openSearch() {
        setModel((current) => openSearch(current))
        setFocusToken((current) => current + 1)
      },
      closeSearch() {
        setModel((current) => clearSearch(current))
      },
      next() {
        setModel((current) =>
          stepSearch({ ...current, currentMatchIndex }, matches.length, 1),
        )
        bumpNavigation()
      },
      previous() {
        setModel((current) =>
          stepSearch({ ...current, currentMatchIndex }, matches.length, -1),
        )
        bumpNavigation()
      },
      selectMatch(index: number) {
        setModel((current) => selectSearchMatch(current, index, matches.length))
        bumpNavigation()
      },
      setPages(nextPages: readonly SearchPage[]) {
        setPages(nextPages)
      },
      setLiveEdit(edit: LiveSearchEdit | null) {
        setLive(edit)
      },
    }),
    [
      bumpNavigation,
      currentMatch,
      currentMatchIndex,
      focusToken,
      matches,
      model.caseSensitive,
      model.open,
      model.query,
      navigationToken,
    ],
  )

  return <SearchContext.Provider value={api}>{children}</SearchContext.Provider>
}

// The provider and this hook share one context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useSearch(): SearchApi {
  const search = useContext(SearchContext)
  if (!search) {
    throw new Error('Search is only available inside the PDF editor.')
  }
  return search
}
