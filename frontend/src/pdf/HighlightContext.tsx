import { createContext, useContext } from 'react'
import type { HighlightRunRecord, TextMarkup } from './highlights.ts'

export type HighlightApi = {
  markups: readonly TextMarkup[]
  selectedId: string | null
  selectMarkup: (id: string | null) => void
  registerRuns: (pageNumber: number, runs: readonly HighlightRunRecord[]) => void
}

export const HighlightContext = createContext<HighlightApi | null>(null)

export function useHighlights(): HighlightApi {
  const highlights = useContext(HighlightContext)
  if (!highlights) {
    throw new Error('Highlights are only available inside the PDF viewer.')
  }
  return highlights
}
