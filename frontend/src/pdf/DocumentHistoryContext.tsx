import { createContext, useContext } from 'react'
import type { CommitOptions, DocumentSnapshot, SelectionPatch } from './documentHistory.ts'

export type DocumentHistoryApi = {
  view: DocumentSnapshot
  canUndo: boolean
  canRedo: boolean
  isDirty: boolean
  restoreId: number
  commit: (
    recipe: (snapshot: DocumentSnapshot) => DocumentSnapshot,
    options?: CommitOptions,
  ) => void
  beginGesture: () => void
  updateGesture: (recipe: (snapshot: DocumentSnapshot) => DocumentSnapshot) => void
  endGesture: () => void
  cancelGesture: () => void
  select: (patch: SelectionPatch) => void
  undo: () => void
  redo: () => void
  markSaved: () => void
  reset: (snapshot: DocumentSnapshot) => void
  getEpoch: () => number
  getSettled: () => DocumentSnapshot
  getView: () => DocumentSnapshot
  isDirtyNow: () => boolean
}

export const DocumentHistoryContext = createContext<DocumentHistoryApi | null>(null)

export function useDocumentHistory(): DocumentHistoryApi {
  const value = useContext(DocumentHistoryContext)
  if (!value) {
    throw new Error('Document history is only available inside the editor.')
  }
  return value
}
