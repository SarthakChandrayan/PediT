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
  /**
   * PDF.js `loadedName`. The viewer registers this as a CSS FontFace, so the
   * overlay can use the same glyphs as the canvas. Not a substitute font.
   */
  loadedName?: string
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

/** Text in one style; `style` indexes `TextBlockLayout.styles`. */
export type TextSegment = { text: string; style: number }

/** One original text run covered by a paragraph edit. PDF user space. */
export type TextBlockMember = {
  pdfX: number
  pdfY: number
  width: number
  height: number
  transform: readonly number[]
  appearance?: TextRunAppearance
}

/**
 * Paragraph geometry for an edit that spans several runs. The edited text
 * is re-wrapped to `width`, one line every `lineHeight`, starting at
 * `firstBaseline`; every member run is covered first. Treat as immutable.
 */
export type TextBlockLayout = {
  left: number
  width: number
  firstBaseline: number
  lineHeight: number
  fontSize: number
  indent: number
  members: readonly TextBlockMember[]
  /** Distinct text styles in the paragraph, in first-seen order. */
  styles: readonly TextRunAppearance[]
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
  /** Present when the edit replaces a whole paragraph rather than one run. */
  block?: TextBlockLayout
  /** Styled form of `editedText` for paragraph edits. Joined, equals it. */
  segments?: readonly TextSegment[]
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
  block?: TextBlockLayout
  /** Styled form of `originalText` for paragraphs. */
  segments?: readonly TextSegment[]
}

export type ActiveTextEdit = TextEditSource & {
  draft: string
  /** Styled form of `draft` for paragraphs. */
  draftSegments?: readonly TextSegment[]
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
  draftSegments?: readonly TextSegment[],
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
      draftSegments: draftSegments ?? source.segments,
      transform: [...source.transform],
    },
  }
}

export function updateTextDraft(
  state: EditorState,
  draft: string,
  draftSegments?: readonly TextSegment[],
): EditorState {
  if (!state.active || (state.active.draft === draft && draftSegments === undefined)) {
    return state
  }

  return {
    edits: state.edits,
    active: { ...state.active, draft, draftSegments: draftSegments ?? state.active.draftSegments },
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
            block: active.block,
            segments: active.block ? active.draftSegments : undefined,
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
