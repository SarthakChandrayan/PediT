/**
 * Visual properties captured from the original text run.
 *
 * Coordinates and sizes are PDF user space, not viewport pixels.
 * `fontSize` is the em size along the text's vertical axis.
 * `horizontalScale` is the baseline length of one em divided by `fontSize`
 * (1 when the run is not condensed or extended).
 * `color` is omitted when a solid fill or stroke color could not be read.
 */
export type TextRunAppearance = {
  pdfFontName?: string
  fallbackFamily?: 'serif' | 'sans-serif' | 'monospace'
  bold: boolean
  italic: boolean
  fontSize: number
  horizontalScale: number
  color?: { r: number; g: number; b: number }
  ascent?: number
  descent?: number
  vertical: boolean
}

/**
 * A committed change to one existing PDF text run.
 *
 * Positions are PDF user space (origin at the bottom-left of the page).
 * Screen position is derived from the current viewport when the run is drawn.
 */
export type TextEdit = {
  id: string
  pageNumber: number
  originalText: string
  editedText: string
  pdfX: number
  pdfY: number
  width: number
  height: number
  transform: number[]
  /** Original PDF font name when it could be read. Not a screen font. */
  fontName?: string
  appearance?: TextRunAppearance
}

export type TextEditSource = {
  id: string
  pageNumber: number
  originalText: string
  pdfX: number
  pdfY: number
  width: number
  height: number
  transform: readonly number[]
  fontName?: string
  appearance?: TextRunAppearance
}

export type ActiveTextEdit = TextEditSource & {
  draft: string
  transform: number[]
}

export type EditorState = {
  edits: readonly TextEdit[]
  active: ActiveTextEdit | null
}

export function emptyEditorState(): EditorState {
  return { edits: [], active: null }
}

export function textRunId(pageNumber: number, itemIndex: number): string {
  return `${pageNumber}:${itemIndex}`
}

export function beginTextEdit(
  state: EditorState,
  source: TextEditSource,
  draft: string,
): EditorState {
  if (state.active?.id === source.id) {
    return state
  }

  const committed = commitTextEdit(state)
  return {
    edits: committed.edits,
    active: {
      ...source,
      appearance: copyAppearance(source.appearance),
      draft,
      transform: [...source.transform],
    },
  }
}

export function updateTextDraft(state: EditorState, draft: string): EditorState {
  if (!state.active || state.active.draft === draft) {
    return state
  }

  return {
    edits: state.edits,
    active: { ...state.active, draft },
  }
}

export function commitTextEdit(state: EditorState): EditorState {
  const active = state.active
  if (!active) {
    return state
  }

  const without = state.edits.filter((edit) => edit.id !== active.id)
  const edits =
    active.draft === active.originalText
      ? without
      : [
          ...without,
          {
            id: active.id,
            pageNumber: active.pageNumber,
            originalText: active.originalText,
            editedText: active.draft,
            pdfX: active.pdfX,
            pdfY: active.pdfY,
            width: active.width,
            height: active.height,
            transform: [...active.transform],
            fontName: active.fontName,
            appearance: copyAppearance(active.appearance),
          },
        ]

  return { edits, active: null }
}

function copyAppearance(
  appearance: TextRunAppearance | undefined,
): TextRunAppearance | undefined {
  if (!appearance) {
    return undefined
  }
  return {
    ...appearance,
    color: appearance.color ? { ...appearance.color } : undefined,
  }
}

export function cancelTextEdit(state: EditorState): EditorState {
  if (!state.active) {
    return state
  }

  return { edits: state.edits, active: null }
}
