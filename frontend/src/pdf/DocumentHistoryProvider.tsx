import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DocumentHistoryContext, type DocumentHistoryApi } from './DocumentHistoryContext.tsx'
import {
  beginGesture,
  canRedoHistory,
  canUndoHistory,
  cancelGesture,
  commitDocument,
  createDocumentHistory,
  currentSnapshot,
  endGesture,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  resetHistory,
  selectInHistory,
  undoHistory,
  updateGesture,
  type DocumentHistory,
  type DocumentSnapshot,
} from './documentHistory.ts'

export function DocumentHistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<DocumentHistory>(createDocumentHistory)
  const historyRef = useRef(history)

  useEffect(() => {
    historyRef.current = history
  }, [history])

  const apply = useCallback((reducer: (current: DocumentHistory) => DocumentHistory) => {
    const next = reducer(historyRef.current)
    if (next === historyRef.current) {
      return
    }
    historyRef.current = next
    setHistory(next)
  }, [])

  const api = useMemo<DocumentHistoryApi>(() => {
    return {
      view: currentSnapshot(history),
      canUndo: canUndoHistory(history),
      canRedo: canRedoHistory(history),
      isDirty: isHistoryDirty(history),
      restoreId: history.restoreId,
      commit: (recipe, options) => {
        apply((current) => commitDocument(current, recipe, options))
      },
      beginGesture: () => {
        apply(beginGesture)
      },
      updateGesture: (recipe) => {
        apply((current) => updateGesture(current, recipe))
      },
      endGesture: () => {
        apply(endGesture)
      },
      cancelGesture: () => {
        apply(cancelGesture)
      },
      select: (patch) => {
        apply((current) => selectInHistory(current, patch))
      },
      undo: () => {
        apply(undoHistory)
      },
      redo: () => {
        apply(redoHistory)
      },
      markSaved: () => {
        apply(markHistorySaved)
      },
      reset: (snapshot: DocumentSnapshot) => {
        apply((current) => resetHistory(current, snapshot))
      },
      getEpoch: () => historyRef.current.present.epoch,
      getSettled: () => historyRef.current.present.snapshot,
      getView: () => currentSnapshot(historyRef.current),
      isDirtyNow: () => isHistoryDirty(historyRef.current),
    }
  }, [apply, history])

  return (
    <DocumentHistoryContext.Provider value={api}>{children}</DocumentHistoryContext.Provider>
  )
}
