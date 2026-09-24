import { createContext, useContext } from 'react'
import type { EditorState, TextEditSource } from './textEdits.ts'

export type TextEditorApi = EditorState & {
  beginEdit: (source: TextEditSource, draft: string) => void
  updateDraft: (draft: string) => void
  commitEdit: () => void
  cancelEdit: () => void
}

export const TextEditorContext = createContext<TextEditorApi | null>(null)

export function useTextEditor(): TextEditorApi {
  const editor = useContext(TextEditorContext)
  if (!editor) {
    throw new Error('Text editing is only available inside the PDF viewer.')
  }
  return editor
}
