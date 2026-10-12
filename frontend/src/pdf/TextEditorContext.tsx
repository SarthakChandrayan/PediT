import { createContext, useContext } from 'react'
import type { EditorState, TextEditSource, TextSegment } from './textEdits.ts'

export type TextEditorApi = EditorState & {
  beginEdit: (source: TextEditSource, draft: string, draftSegments?: readonly TextSegment[]) => void
  updateDraft: (draft: string, draftSegments?: readonly TextSegment[]) => void
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
