import { createContext, useContext } from 'react'
import type { NewTextAnnotation, NewTextBox } from './newTexts.ts'

export type NewTextApi = {
  texts: readonly NewTextAnnotation[]
  selectedId: string | null
  tool: boolean
  draft: NewTextAnnotation | null
  editingId: string | null
  editingText: string
  selectText: (id: string | null) => void
  createAt: (pageNumber: number, pdfX: number, pdfY: number, pageWidth: number, pageHeight: number) => void
  updateDraftText: (text: string) => void
  commitDraft: () => void
  cancelDraft: () => void
  beginEdit: (id: string) => void
  updateEditingText: (text: string) => void
  commitEditing: () => void
  cancelEditing: () => void
  updateTextBox: (id: string, box: NewTextBox) => void
  beginTextGesture: () => void
  endTextGesture: () => void
  cancelTextGesture: () => void
}

export const NewTextContext = createContext<NewTextApi | null>(null)

export function useNewTexts(): NewTextApi {
  const value = useContext(NewTextContext)
  if (!value) {
    throw new Error('New text is only available inside the PDF viewer.')
  }
  return value
}
