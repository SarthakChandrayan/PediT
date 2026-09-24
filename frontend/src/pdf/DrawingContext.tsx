import { createContext, useContext } from 'react'
import type { PdfPoint } from './coordinates.ts'
import type { DrawingAnnotation, DrawingDraft, DrawingKind } from './drawings.ts'

export type DrawingApi = {
  drawings: readonly DrawingAnnotation[]
  selectedId: string | null
  tool: DrawingKind | null
  draft: DrawingDraft | null
  selectDrawing: (id: string | null) => void
  beginStroke: (pageNumber: number, kind: DrawingKind, point: PdfPoint) => void
  extendStroke: (point: PdfPoint) => void
  finishStroke: () => void
}

export const DrawingContext = createContext<DrawingApi | null>(null)

export function useDrawing(): DrawingApi {
  const value = useContext(DrawingContext)
  if (!value) {
    throw new Error('Drawing tools are only available inside the PDF viewer.')
  }
  return value
}
