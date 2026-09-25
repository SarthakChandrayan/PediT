import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  pageSizeFromViewport,
  pdfRectToViewportBox,
  viewportPointToPdf,
  type PageGeometry,
  type PdfPoint,
} from './coordinates.ts'
import { useDocumentHistory } from './DocumentHistoryContext.tsx'
import { DrawingContext, type DrawingApi } from './DrawingContext.tsx'
import { ImageContext, type ImageApi } from './ImageContext.tsx'
import { NewTextContext, type NewTextApi } from './NewTextContext.tsx'
import {
  appendDrawingPoint,
  finalizeDrawing,
  type DrawingAnnotation,
  type DrawingDraft,
  type DrawingKind,
} from './drawings.ts'
import { HighlightContext, type HighlightApi } from './HighlightContext.tsx'
import {
  highlightsFromPieces,
  lineMarkupsFromPieces,
  type HighlightRunRecord,
  type SelectedTextPiece,
  type TextHighlight,
  type TextMarkup,
} from './highlights.ts'
import {
  clampPageNumber,
  fitPageScale,
  fitWidthScale,
  VIEWER_FIT_INSET_X,
  VIEWER_FIT_INSET_Y,
} from './pageNavigation.ts'
import { PdfPage } from './PdfPage.tsx'
import { ThumbnailSidebar } from './ThumbnailSidebar.tsx'
import { PixelsPerInch } from './pdfjs.ts'
import { useSearch } from './SearchContext.tsx'
import { extractSearchDocument, type SearchMatch } from './search.ts'
import { collectSelectedPieces } from './textSelection.ts'
import { TextEditorContext, type TextEditorApi } from './TextEditorContext.tsx'
import {
  beginTextEdit,
  commitTextEdit,
  updateTextDraft,
  type ActiveTextEdit,
  type TextEdit,
  type TextEditSource,
} from './textEdits.ts'
import {
  placeImageBox,
  type ImageAnnotation,
  type ImageBox,
  type ImageFormat,
} from './images.ts'
import {
  createNewText,
  patchNewTextStyle,
  type NewTextAnnotation,
  type NewTextBox,
} from './newTexts.ts'
import { usePdfDocument } from './usePdfDocument.ts'

export type {
  DrawingAnnotation,
  DrawingKind,
  ImageAnnotation,
  NewTextAnnotation,
  TextEdit,
  TextHighlight,
  TextMarkup,
}

export type NewTextStyleState = {
  fontName: string
  fontSize: number
  bold: boolean
  italic: boolean
  color: { r: number; g: number; b: number }
}

export type AnnotationUiState = {
  canHighlight: boolean
  canRemoveHighlight: boolean
  drawingTool: DrawingKind | null
  textTool: boolean
  selectedNewText: NewTextStyleState | null
  selectedImage: { width: number; height: number } | null
  selectedDrawing: boolean
  hasUncommittedEdit: boolean
}

export type PdfViewerHandle = {
  /** Returns geometry for a 1-based page number, or null if it is not rendered. */
  getPageGeometry: (pageNumber: number) => PageGeometry | null
  /** Committed text edits in PDF user space. The PDF bytes are unchanged. */
  getTextEdits: () => readonly TextEdit[]
  /**
   * Committed edits plus an open draft. Page operations bake this into the
   * working PDF, then the viewer drops the edit list.
   */
  snapshotTextEdits: () => readonly TextEdit[]
  /** True while a text run is open and its draft differs from the PDF text. */
  hasUncommittedEdit: () => boolean
  /** Writes an open text draft into history when it changed, then closes it. */
  flushActiveEdit: () => void
  /** Closes an open text draft without recording history. */
  abandonActiveEdit: () => void
  /** Drops an in-progress stroke. Returns true when a stroke was discarded. */
  dismissDrawingDraft: () => boolean
  /** Highlights in PDF user space. The PDF bytes are unchanged until save or export. */
  getHighlights: () => readonly TextHighlight[]
  /** Highlights, underlines, and strikethroughs. The PDF bytes are unchanged. */
  getMarkups: () => readonly TextMarkup[]
  /** Remembers the current text selection so a toolbar click can use it. */
  captureTextSelection: () => void
  /** Creates highlights for the current selection. One record per page. */
  applyHighlight: (color: string) => void
  /** Creates underlines for the current selection. One record per page. */
  applyUnderline: () => void
  /** Creates strikethroughs for the current selection. One record per page. */
  applyStrikethrough: () => void
  /** Drops the selected text markup or drawing. The PDF bytes stay unchanged. */
  removeSelectedHighlight: () => void
  /** Vector drawings in PDF user space. The PDF bytes are unchanged. */
  getDrawings: () => readonly DrawingAnnotation[]
  /** Turns a drawing tool on, or off when that tool is already active. */
  setDrawingTool: (tool: DrawingKind) => void
  /** Turns the new-text tool on, or off when it is already active. */
  setTextTool: (on?: boolean) => void
  /** Writes the open new-text draft into history when it changed, then closes it. */
  flushNewText: () => void
  /** Drops an uncommitted new-text box or in-progress edit without recording history. */
  abandonNewText: () => void
  /** Created text boxes in PDF user space. The PDF bytes are unchanged. */
  getNewTexts: () => readonly NewTextAnnotation[]
  /** Applies one style change to the selected created text. */
  patchSelectedNewText: (
    patch: Partial<Pick<NewTextAnnotation, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'color'>>,
  ) => void
  /** Inserted images in PDF user space. The PDF bytes are unchanged. */
  getImages: () => readonly ImageAnnotation[]
  /** Viewer zoom that fits the current page. Does not change the PDF or history. */
  fitScale: (mode: 'width' | 'page') => number | null
  /** Scrolls to a page. Does not change the PDF or history. */
  jumpToPage: (pageNumber: number) => void
  /** Places a local PNG or JPEG on a page. The file is not uploaded. */
  insertImage: (
    pageNumber: number,
    image: {
      bytes: Uint8Array
      format: ImageFormat
      width: number
      height: number
    },
  ) => void
}

type PdfViewerProps = {
  ref?: Ref<PdfViewerHandle>
  data: Uint8Array
  scale: number
  currentPage?: number
  /** 1-based page to show when a new PDF document loads. */
  focusPage?: number
  onPageCountChange?: (pageCount: number) => void
  onCurrentPageChange?: (pageNumber: number) => void
  onTextEditsChange?: (edits: readonly TextEdit[]) => void
  onAnnotationStateChange?: (state: AnnotationUiState) => void
}

export function PdfViewer({
  ref,
  data,
  scale,
  currentPage = 1,
  focusPage = 1,
  onPageCountChange,
  onCurrentPageChange,
  onTextEditsChange,
  onAnnotationStateChange,
}: PdfViewerProps) {
  const history = useDocumentHistory()
  const search = useSearch()
  const historyRef = useRef(history)
  const view = history.view
  const pdf = usePdfDocument(data)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<Map<number, PageGeometry>>(new Map())
  const onPageCountChangeRef = useRef(onPageCountChange)
  const onCurrentPageChangeRef = useRef(onCurrentPageChange)
  const onTextEditsChangeRef = useRef(onTextEditsChange)
  const onAnnotationStateChangeRef = useRef(onAnnotationStateChange)
  const focusPageRef = useRef(focusPage)
  const currentPageRef = useRef(currentPage)
  const jumpToPageRef = useRef<(pageNumber: number) => void>(() => undefined)
  const pendingFocusRef = useRef(false)
  const [active, setActive] = useState<ActiveTextEdit | null>(null)
  const [canHighlight, setCanHighlight] = useState(false)
  const [drawingTool, setDrawingToolState] = useState<DrawingKind | null>(null)
  const [draft, setDraft] = useState<DrawingDraft | null>(null)
  const [textTool, setTextToolState] = useState(false)
  const [textDraft, setTextDraft] = useState<NewTextAnnotation | null>(null)
  const [newTextEdit, setNewTextEdit] = useState<{
    id: string
    original: string
    draft: string
  } | null>(null)
  const activeRef = useRef(active)
  const uncommittedRef = useRef(false)
  const draftRef = useRef(draft)
  const textDraftRef = useRef(textDraft)
  const newTextEditRef = useRef(newTextEdit)
  const textToolRef = useRef(textTool)
  const pageCountRef = useRef(0)
  const runsRef = useRef(new Map<string, HighlightRunRecord>())
  const capturedSelectionRef = useRef<SelectedTextPiece[] | null>(null)
  const setSearchPagesRef = useRef(search.setPages)
  const setLiveEditRef = useRef(search.setLiveEdit)
  const pendingSearchScrollRef = useRef<SearchMatch | null>(null)
  const [trackedDocument, setTrackedDocument] = useState({
    data,
    restoreId: history.restoreId,
  })
  const pdfChanged = trackedDocument.data !== data
  const historyRestored = trackedDocument.restoreId !== history.restoreId
  if (pdfChanged || historyRestored) {
    setTrackedDocument({ data, restoreId: history.restoreId })
    if (active !== null) {
      setActive(null)
    }
    if (draft !== null) {
      setDraft(null)
    }
    if (pdfChanged && drawingTool !== null) {
      setDrawingToolState(null)
    }
    if (pdfChanged && textTool) {
      setTextToolState(false)
    }
    if ((pdfChanged || historyRestored) && textDraft !== null) {
      setTextDraft(null)
    }
    if ((pdfChanged || historyRestored) && newTextEdit !== null) {
      setNewTextEdit(null)
    }
    if (pdfChanged && canHighlight) {
      setCanHighlight(false)
    }
  }
  const shownActive = pdfChanged || historyRestored ? null : active
  const shownDraft = pdfChanged || historyRestored ? null : draft
  const shownTool = pdfChanged ? null : drawingTool
  const shownTextTool = pdfChanged ? false : textTool
  const shownTextDraft = pdfChanged || historyRestored ? null : textDraft
  const shownNewTextEdit = pdfChanged || historyRestored ? null : newTextEdit

  const highlights = view.markups
  const selectedHighlightId = view.selectedMarkupId
  const drawings = view.drawings
  const selectedDrawingId = view.selectedDrawingId
  const insertedImages = view.images
  const selectedImageId = view.selectedImageId
  const createdTexts = view.texts
  const selectedTextId = view.selectedTextId

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    activeRef.current = active
    uncommittedRef.current = active !== null && active.draft !== active.originalText
  }, [active])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    textDraftRef.current = textDraft
  }, [textDraft])

  useEffect(() => {
    newTextEditRef.current = newTextEdit
  }, [newTextEdit])

  useEffect(() => {
    textToolRef.current = textTool
  }, [textTool])

  useEffect(() => {
    focusPageRef.current = focusPage
  }, [focusPage])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    onPageCountChangeRef.current = onPageCountChange
    onCurrentPageChangeRef.current = onCurrentPageChange
    onTextEditsChangeRef.current = onTextEditsChange
    onAnnotationStateChangeRef.current = onAnnotationStateChange
  })

  useEffect(() => {
    runsRef.current.clear()
    capturedSelectionRef.current = null
    window.getSelection()?.removeAllRanges()
  }, [data])

  useEffect(() => {
    setSearchPagesRef.current = search.setPages
    setLiveEditRef.current = search.setLiveEdit
  })

  useEffect(() => {
    const pdfDocument = pdf.document
    if (!pdfDocument) {
      setSearchPagesRef.current([])
      return
    }
    let cancelled = false
    void extractSearchDocument(pdfDocument)
      .then((pages) => {
        if (!cancelled) {
          setSearchPagesRef.current(pages)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(error)
          setSearchPagesRef.current([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [pdf.document])

  useEffect(() => {
    const editing = shownActive
    setLiveEditRef.current(
      editing ? { id: editing.id, text: editing.draft } : null,
    )
  }, [shownActive])

  useEffect(() => {
    const selectedCreated =
      shownTextDraft ??
      createdTexts.find((item) => item.id === selectedTextId) ??
      null
    const selectedImage =
      insertedImages.find((item) => item.id === selectedImageId) ?? null
    onAnnotationStateChangeRef.current?.({
      canHighlight,
      canRemoveHighlight:
        selectedHighlightId !== null ||
        selectedDrawingId !== null ||
        selectedImageId !== null ||
        selectedCreated !== null,
      drawingTool: shownTool,
      textTool: shownTextTool,
      selectedNewText: selectedCreated
        ? {
            fontName: selectedCreated.fontName,
            fontSize: selectedCreated.fontSize,
            bold: selectedCreated.bold,
            italic: selectedCreated.italic,
            color: selectedCreated.color,
          }
        : null,
      selectedImage: selectedImage
        ? { width: selectedImage.width, height: selectedImage.height }
        : null,
      selectedDrawing: selectedDrawingId !== null,
      hasUncommittedEdit:
        (shownActive !== null && shownActive.draft !== shownActive.originalText) ||
        (shownTextDraft !== null && shownTextDraft.text.trim().length > 0) ||
        (shownNewTextEdit !== null && shownNewTextEdit.draft !== shownNewTextEdit.original),
    })
  }, [
    canHighlight,
    createdTexts,
    insertedImages,
    selectedDrawingId,
    selectedHighlightId,
    selectedImageId,
    selectedTextId,
    shownActive,
    shownNewTextEdit,
    shownTextDraft,
    shownTextTool,
    shownTool,
  ])

  useEffect(() => {
    const onSelectionChange = () => {
      const root = scrollerRef.current
      const pieces = root ? collectSelectedPieces(root, runsRef.current) : []
      if (pieces.length > 0) {
        capturedSelectionRef.current = pieces
      }
      const next = pieces.length > 0
      setCanHighlight((current) => (current === next ? current : next))
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [data])

  useEffect(() => {
    onTextEditsChangeRef.current?.(view.edits)
  }, [view.edits])

  const scrollMatchIntoView = useCallback((match: SearchMatch) => {
    const rect = match.pdfRects[0]
    const geometry = pagesRef.current.get(match.pageNumber)
    const root = scrollerRef.current
    if (!rect || !geometry || !root) {
      pendingSearchScrollRef.current = match
      return
    }
    pendingSearchScrollRef.current = null
    const box = pdfRectToViewportBox(geometry.viewport, rect)
    const rootRect = root.getBoundingClientRect()
    const pageRect = geometry.element.getBoundingClientRect()
    const matchTop = pageRect.top + box.top
    const matchLeft = pageRect.left + box.left
    const nextTop =
      root.scrollTop + (matchTop - rootRect.top) - root.clientHeight / 2 + box.height / 2
    const nextLeft =
      root.scrollLeft + (matchLeft - rootRect.left) - root.clientWidth / 2 + box.width / 2
    root.scrollTo({
      top: Math.max(0, nextTop),
      left: Math.max(0, nextLeft),
    })
    onCurrentPageChangeRef.current?.(match.pageNumber)
  }, [])

  useEffect(() => {
    if (!search.open || search.navigationToken === 0) {
      return
    }
    const match = search.currentMatch
    if (!match) {
      return
    }
    scrollMatchIntoView(match)
  }, [scrollMatchIntoView, search.currentMatch, search.navigationToken, search.open])

  const registerGeometry = useCallback((geometry: PageGeometry) => {
    pagesRef.current.set(geometry.pageNumber, geometry)
    const pendingMatch = pendingSearchScrollRef.current
    if (pendingMatch?.pageNumber === geometry.pageNumber) {
      scrollMatchIntoView(pendingMatch)
    }
    if (!pendingFocusRef.current || geometry.pageNumber !== focusPageRef.current) {
      return
    }
    pendingFocusRef.current = false
    onCurrentPageChangeRef.current?.(geometry.pageNumber)
    const root = scrollerRef.current
    if (!root) {
      return
    }
    const rootTop = root.getBoundingClientRect().top
    const targetTop = geometry.element.getBoundingClientRect().top
    root.scrollTop += targetTop - rootTop
  }, [scrollMatchIntoView])

  const unregisterGeometry = useCallback((pageNumber: number) => {
    pagesRef.current.delete(pageNumber)
  }, [])

  const currentEdits = useCallback(() => historyRef.current.getView().edits, [])

  const beginEdit = useCallback((source: TextEditSource, draftText: string) => {
    const current = { edits: currentEdits(), active: activeRef.current }
    if (current.active?.id === source.id) {
      return
    }
    const next = beginTextEdit(current, source, draftText)
    activeRef.current = next.active
    uncommittedRef.current =
      next.active !== null && next.active.draft !== next.active.originalText
    setActive(next.active)
    historyRef.current.commit((snapshot) => ({ ...snapshot, edits: next.edits }))
  }, [currentEdits])

  const updateDraft = useCallback((draftText: string) => {
    const next = updateTextDraft(
      { edits: currentEdits(), active: activeRef.current },
      draftText,
    )
    activeRef.current = next.active
    uncommittedRef.current =
      next.active !== null && next.active.draft !== next.active.originalText
    setActive(next.active)
  }, [currentEdits])

  const commitEdit = useCallback(() => {
    const editing = activeRef.current
    if (!editing) {
      return
    }
    const next = commitTextEdit({ edits: currentEdits(), active: editing })
    activeRef.current = null
    uncommittedRef.current = false
    setActive(null)
    historyRef.current.commit((snapshot) => ({ ...snapshot, edits: next.edits }))
  }, [currentEdits])

  const cancelEdit = useCallback(() => {
    if (!activeRef.current) {
      return
    }
    activeRef.current = null
    uncommittedRef.current = false
    setActive(null)
  }, [])

  const selectHighlight = useCallback((id: string | null) => {
    historyRef.current.select({
      selectedMarkupId: id,
      ...(id ? { selectedDrawingId: null, selectedImageId: null, selectedTextId: null } : {}),
    })
  }, [])

  const selectDrawing = useCallback((id: string | null) => {
    historyRef.current.select({
      selectedDrawingId: id,
      ...(id ? { selectedMarkupId: null, selectedImageId: null, selectedTextId: null } : {}),
    })
  }, [])

  const selectImage = useCallback((id: string | null) => {
    historyRef.current.select({
      selectedImageId: id,
      ...(id ? { selectedMarkupId: null, selectedDrawingId: null, selectedTextId: null } : {}),
    })
  }, [])

  const selectText = useCallback((id: string | null) => {
    historyRef.current.select({
      selectedTextId: id,
      ...(id ? { selectedMarkupId: null, selectedDrawingId: null, selectedImageId: null } : {}),
    })
  }, [])

  const updateImage = useCallback((id: string, box: ImageBox) => {
    historyRef.current.updateGesture((snapshot) => ({
      ...snapshot,
      images: snapshot.images.map((image) => (image.id === id ? { ...image, ...box } : image)),
    }))
  }, [])

  const beginImageGesture = useCallback(() => {
    historyRef.current.beginGesture()
  }, [])

  const endImageGesture = useCallback(() => {
    historyRef.current.endGesture()
  }, [])

  const cancelImageGesture = useCallback(() => {
    historyRef.current.cancelGesture()
  }, [])

  const commitNewTextDraft = useCallback(() => {
    const draftText = textDraftRef.current
    if (!draftText) {
      return
    }
    textDraftRef.current = null
    setTextDraft(null)
    if (draftText.text.trim().length === 0) {
      selectText(null)
      return
    }
    historyRef.current.commit((snapshot) => ({
      ...snapshot,
      texts: [...snapshot.texts.filter((item) => item.id !== draftText.id), draftText],
      selectedTextId: draftText.id,
      selectedMarkupId: null,
      selectedDrawingId: null,
      selectedImageId: null,
    }))
  }, [selectText])

  const cancelNewTextDraft = useCallback(() => {
    if (!textDraftRef.current) {
      return
    }
    textDraftRef.current = null
    setTextDraft(null)
    selectText(null)
  }, [selectText])

  const commitNewTextEdit = useCallback(() => {
    const editing = newTextEditRef.current
    if (!editing) {
      return
    }
    newTextEditRef.current = null
    setNewTextEdit(null)
    if (editing.draft === editing.original) {
      return
    }
    historyRef.current.commit((snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) =>
        item.id === editing.id ? { ...item, text: editing.draft } : item,
      ),
    }))
  }, [])

  const cancelNewTextEdit = useCallback(() => {
    if (!newTextEditRef.current) {
      return
    }
    newTextEditRef.current = null
    setNewTextEdit(null)
  }, [])

  const createNewTextAt = useCallback(
    (pageNumber: number, pdfX: number, pdfY: number, pageWidth: number, pageHeight: number) => {
      commitNewTextDraft()
      commitNewTextEdit()
      const created = createNewText({ pageNumber, pdfX, pdfY, pageWidth, pageHeight })
      textDraftRef.current = created
      setTextDraft(created)
      selectText(created.id)
    },
    [commitNewTextDraft, commitNewTextEdit, selectText],
  )

  const updateDraftText = useCallback((value: string) => {
    const current = textDraftRef.current
    if (!current) {
      return
    }
    const next = { ...current, text: value }
    textDraftRef.current = next
    setTextDraft(next)
  }, [])

  const beginNewTextEdit = useCallback((id: string) => {
    commitNewTextDraft()
    const current = historyRef.current.getView().texts.find((item) => item.id === id)
    if (!current) {
      return
    }
    const next = { id, original: current.text, draft: current.text }
    newTextEditRef.current = next
    setNewTextEdit(next)
    selectText(id)
  }, [commitNewTextDraft, selectText])

  const updateEditingText = useCallback((value: string) => {
    const current = newTextEditRef.current
    if (!current) {
      return
    }
    const next = { ...current, draft: value }
    newTextEditRef.current = next
    setNewTextEdit(next)
  }, [])

  const updateTextBox = useCallback((id: string, box: NewTextBox) => {
    const draftText = textDraftRef.current
    if (draftText?.id === id) {
      const next = { ...draftText, ...box }
      textDraftRef.current = next
      setTextDraft(next)
      return
    }
    historyRef.current.updateGesture((snapshot) => ({
      ...snapshot,
      texts: snapshot.texts.map((item) => (item.id === id ? { ...item, ...box } : item)),
    }))
  }, [])

  const beginTextGesture = useCallback(() => {
    historyRef.current.beginGesture()
  }, [])

  const endTextGesture = useCallback(() => {
    historyRef.current.endGesture()
  }, [])

  const cancelTextGesture = useCallback(() => {
    historyRef.current.cancelGesture()
  }, [])

  const beginStroke = useCallback((pageNumber: number, kind: DrawingKind, point: PdfPoint) => {
    const next = { pageNumber, kind, points: [point] }
    draftRef.current = next
    setDraft(next)
    selectHighlight(null)
    selectDrawing(null)
    selectImage(null)
  }, [selectDrawing, selectHighlight, selectImage])

  const extendStroke = useCallback((point: PdfPoint) => {
    const current = draftRef.current
    if (!current) {
      return
    }
    const points = appendDrawingPoint(current.points, point, current.kind)
    if (points === current.points) {
      return
    }
    const next = { ...current, points }
    draftRef.current = next
    setDraft(next)
  }, [])

  const finishStroke = useCallback(() => {
    const current = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (!current) {
      return
    }
    const created = finalizeDrawing(current)
    if (!created) {
      return
    }
    historyRef.current.commit((snapshot) => ({
      ...snapshot,
      drawings: [...snapshot.drawings, created],
      selectedDrawingId: created.id,
    }))
  }, [])

  const registerRuns = useCallback((pageNumber: number, runs: readonly HighlightRunRecord[]) => {
    for (const [id, record] of runsRef.current) {
      if (record.pageNumber === pageNumber) {
        runsRef.current.delete(id)
      }
    }
    for (const run of runs) {
      runsRef.current.set(run.id, run)
    }
  }, [])

  const editorApi = useMemo<TextEditorApi>(
    () => ({
      edits: view.edits,
      active: shownActive,
      beginEdit,
      updateDraft,
      commitEdit,
      cancelEdit,
    }),
    [beginEdit, cancelEdit, commitEdit, updateDraft, view.edits, shownActive],
  )

  const imageApi = useMemo<ImageApi>(
    () => ({
      images: insertedImages,
      selectedId: selectedImageId,
      selectImage,
      updateImage,
      beginImageGesture,
      endImageGesture,
      cancelImageGesture,
    }),
    [
      beginImageGesture,
      cancelImageGesture,
      endImageGesture,
      insertedImages,
      selectImage,
      selectedImageId,
      updateImage,
    ],
  )

  const newTextApi = useMemo<NewTextApi>(
    () => ({
      texts: createdTexts,
      selectedId: selectedTextId,
      tool: shownTextTool,
      draft: shownTextDraft,
      editingId: shownNewTextEdit?.id ?? shownTextDraft?.id ?? null,
      editingText: shownNewTextEdit?.draft ?? shownTextDraft?.text ?? '',
      selectText,
      createAt: createNewTextAt,
      updateDraftText,
      commitDraft: commitNewTextDraft,
      cancelDraft: cancelNewTextDraft,
      beginEdit: beginNewTextEdit,
      updateEditingText,
      commitEditing: commitNewTextEdit,
      cancelEditing: cancelNewTextEdit,
      updateTextBox,
      beginTextGesture,
      endTextGesture,
      cancelTextGesture,
    }),
    [
      beginNewTextEdit,
      beginTextGesture,
      cancelNewTextDraft,
      cancelNewTextEdit,
      cancelTextGesture,
      commitNewTextDraft,
      commitNewTextEdit,
      createNewTextAt,
      createdTexts,
      endTextGesture,
      selectText,
      selectedTextId,
      shownNewTextEdit,
      shownTextDraft,
      shownTextTool,
      updateDraftText,
      updateEditingText,
      updateTextBox,
    ],
  )

  const drawingApi = useMemo<DrawingApi>(
    () => ({
      drawings,
      selectedId: selectedDrawingId,
      tool: shownTool,
      draft: shownDraft,
      selectDrawing,
      beginStroke,
      extendStroke,
      finishStroke,
    }),
    [
      beginStroke,
      shownDraft,
      shownTool,
      drawings,
      extendStroke,
      finishStroke,
      selectDrawing,
      selectedDrawingId,
    ],
  )

  const highlightApi = useMemo<HighlightApi>(
    () => ({
      markups: highlights,
      selectedId: selectedHighlightId,
      selectMarkup: selectHighlight,
      registerRuns,
    }),
    [highlights, registerRuns, selectHighlight, selectedHighlightId],
  )

  useImperativeHandle(
    ref,
    () => {
      const readSelectionPieces = () => {
        const root = scrollerRef.current
        const live = root ? collectSelectedPieces(root, runsRef.current) : []
        const pieces = live.length > 0 ? live : capturedSelectionRef.current ?? []
        capturedSelectionRef.current = null
        return pieces
      }
      const addMarkups = (created: readonly TextMarkup[]) => {
        if (created.length === 0) {
          return
        }
        historyRef.current.commit((snapshot) => ({
          ...snapshot,
          markups: [...snapshot.markups, ...created],
          selectedMarkupId: created[0]?.id ?? null,
        }))
        window.getSelection()?.removeAllRanges()
        setCanHighlight(false)
      }
      const readEdits = () => {
        const editing = activeRef.current
        const edits = historyRef.current.getView().edits
        if (!editing) {
          return edits
        }
        return commitTextEdit({ edits, active: editing }).edits
      }
      return {
      getPageGeometry(pageNumber: number) {
        return pagesRef.current.get(pageNumber) ?? null
      },
      getTextEdits() {
        return readEdits()
      },
      snapshotTextEdits() {
        return readEdits()
      },
      hasUncommittedEdit() {
        const draftText = textDraftRef.current
        const editing = newTextEditRef.current
        return (
          uncommittedRef.current ||
          (draftText !== null && draftText.text.trim().length > 0) ||
          (editing !== null && editing.draft !== editing.original)
        )
      },
      flushActiveEdit() {
        commitEdit()
        commitNewTextDraft()
        commitNewTextEdit()
      },
      abandonActiveEdit() {
        activeRef.current = null
        uncommittedRef.current = false
        setActive(null)
        cancelNewTextDraft()
        cancelNewTextEdit()
      },
      flushNewText() {
        commitNewTextDraft()
        commitNewTextEdit()
      },
      abandonNewText() {
        cancelNewTextDraft()
        cancelNewTextEdit()
      },
      dismissDrawingDraft() {
        if (!draftRef.current) {
          return false
        }
        draftRef.current = null
        setDraft(null)
        return true
      },
      getHighlights() {
        return historyRef.current.getView().markups.filter(
          (markup) => markup.kind !== 'underline' && markup.kind !== 'strikethrough',
        )
      },
      getMarkups() {
        return historyRef.current.getView().markups
      },
      captureTextSelection() {
        const root = scrollerRef.current
        if (!root) {
          return
        }
        const pieces = collectSelectedPieces(root, runsRef.current)
        if (pieces.length > 0) {
          capturedSelectionRef.current = pieces
        }
      },
      applyHighlight(color: string) {
        addMarkups(highlightsFromPieces(readSelectionPieces(), color))
      },
      applyUnderline() {
        addMarkups(lineMarkupsFromPieces(readSelectionPieces(), 'underline'))
      },
      applyStrikethrough() {
        addMarkups(lineMarkupsFromPieces(readSelectionPieces(), 'strikethrough'))
      },
      removeSelectedHighlight() {
        const viewNow = historyRef.current.getView()
        const draftText = textDraftRef.current
        if (draftText && (viewNow.selectedTextId === draftText.id || !viewNow.selectedTextId)) {
          cancelNewTextDraft()
          return
        }
        const textId = viewNow.selectedTextId
        if (textId) {
          cancelNewTextEdit()
          historyRef.current.commit((snapshot) => ({
            ...snapshot,
            texts: snapshot.texts.filter((item) => item.id !== textId),
            selectedTextId: null,
          }))
          return
        }
        const imageId = viewNow.selectedImageId
        if (imageId) {
          historyRef.current.commit((snapshot) => ({
            ...snapshot,
            images: snapshot.images.filter((image) => image.id !== imageId),
            selectedImageId: null,
          }))
          return
        }
        const drawingId = viewNow.selectedDrawingId
        if (drawingId) {
          historyRef.current.commit((snapshot) => ({
            ...snapshot,
            drawings: snapshot.drawings.filter((item) => item.id !== drawingId),
            selectedDrawingId: null,
          }))
          return
        }
        const id = viewNow.selectedMarkupId
        if (!id) {
          return
        }
        historyRef.current.commit((snapshot) => ({
          ...snapshot,
          markups: snapshot.markups.filter((markup) => markup.id !== id),
          selectedMarkupId: null,
        }))
      },
      getDrawings() {
        return historyRef.current.getView().drawings
      },
      setDrawingTool(tool: DrawingKind) {
        setDrawingToolState((current) => (current === tool ? null : tool))
        draftRef.current = null
        setDraft(null)
        setTextToolState(false)
        commitNewTextDraft()
        commitNewTextEdit()
      },
      setTextTool(on) {
        setTextToolState((current) => {
          if (typeof on === 'boolean') {
            return on
          }
          return !current
        })
        setDrawingToolState(null)
        draftRef.current = null
        setDraft(null)
      },
      getNewTexts() {
        const draftText = textDraftRef.current
        const texts = historyRef.current.getView().texts
        if (!draftText || draftText.text.trim().length === 0) {
          return texts
        }
        return [...texts.filter((item) => item.id !== draftText.id), draftText]
      },
      patchSelectedNewText(patch) {
        const draftText = textDraftRef.current
        if (draftText) {
          const next = patchNewTextStyle(draftText, patch)
          textDraftRef.current = next
          setTextDraft(next)
          return
        }
        const id = historyRef.current.getView().selectedTextId
        if (!id) {
          return
        }
        historyRef.current.commit((snapshot) => ({
          ...snapshot,
          texts: snapshot.texts.map((item) =>
            item.id === id ? patchNewTextStyle(item, patch) : item,
          ),
        }))
      },
      getImages() {
        return historyRef.current.getView().images
      },
      fitScale(mode: 'width' | 'page') {
        const root = scrollerRef.current
        const geometry = pagesRef.current.get(currentPageRef.current)
        if (!root || !geometry) {
          return null
        }
        const page = pageSizeFromViewport(geometry.viewport)
        const availableWidth = root.clientWidth - VIEWER_FIT_INSET_X
        const availableHeight = root.clientHeight - VIEWER_FIT_INSET_Y
        const cssPixelsPerPoint = PixelsPerInch.PDF_TO_CSS_UNITS
        if (mode === 'width') {
          return fitWidthScale(page.width, availableWidth, cssPixelsPerPoint)
        }
        return fitPageScale(
          page.width,
          page.height,
          availableWidth,
          availableHeight,
          cssPixelsPerPoint,
        )
      },
      jumpToPage(pageNumber: number) {
        jumpToPageRef.current(pageNumber)
      },
      insertImage(pageNumber, image) {
        const count = pageCountRef.current
        const page = count > 0 ? Math.min(Math.max(pageNumber, 1), count) : pageNumber
        const frame = pageFrame(pagesRef.current.get(page), scrollerRef.current)
        const placed = placeImageBox({
          originalWidth: image.width,
          originalHeight: image.height,
          pageWidth: frame.pageWidth,
          pageHeight: frame.pageHeight,
          centerX: frame.centerX,
          centerY: frame.centerY,
        })
        const created: ImageAnnotation = {
          id: crypto.randomUUID(),
          pageNumber: page,
          ...placed,
          originalWidth: image.width,
          originalHeight: image.height,
          format: image.format,
          bytes: image.bytes.slice(),
        }
        historyRef.current.commit((snapshot) => ({
          ...snapshot,
          images: [...snapshot.images, created],
          selectedImageId: created.id,
          selectedMarkupId: null,
          selectedDrawingId: null,
          selectedTextId: null,
        }))
      },
    }
    },
    [
      cancelNewTextDraft,
      cancelNewTextEdit,
      commitEdit,
      commitNewTextDraft,
      commitNewTextEdit,
    ],
  )

  useEffect(() => {
    const count = pdf.document?.numPages ?? 0
    pageCountRef.current = count
    onPageCountChangeRef.current?.(count)
    if (!pdf.document || count < 1) {
      return
    }

    pagesRef.current.clear()
    pendingFocusRef.current = true
    const page = Math.min(Math.max(focusPageRef.current, 1), count)
    onCurrentPageChangeRef.current?.(page)
  }, [pdf.document])

  useEffect(() => {
    const root = scrollerRef.current
    const pdfDocument = pdf.document
    if (!root || !pdfDocument) {
      return
    }

    const visibleArea = new Map<number, number>()
    const pages = root.querySelectorAll<HTMLElement>('[data-page-number]')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pageNumber,
          )
          if (!Number.isFinite(pageNumber)) {
            continue
          }
          const area = entry.isIntersecting
            ? entry.intersectionRect.width * entry.intersectionRect.height
            : 0
          visibleArea.set(pageNumber, area)
        }

        let currentPage = 0
        let largestArea = 0
        for (const [pageNumber, area] of visibleArea) {
          if (area > largestArea) {
            largestArea = area
            currentPage = pageNumber
          }
        }

        if (currentPage > 0) {
          onCurrentPageChangeRef.current?.(currentPage)
        }
      },
      {
        root,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    )

    pages.forEach((page) => observer.observe(page))
    return () => observer.disconnect()
  }, [pdf.document, scale])

  const pdfDocument = pdf.document

  const jumpToPage = useCallback((pageNumber: number) => {
    const count = pageCountRef.current
    if (count < 1) {
      return
    }
    const page = clampPageNumber(pageNumber, count)
    pendingFocusRef.current = false
    currentPageRef.current = page
    onCurrentPageChangeRef.current?.(page)
    const root = scrollerRef.current
    const element = root?.querySelector<HTMLElement>(`[data-page-number="${page}"]`)
    if (!root || !element) {
      return
    }
    const rootTop = root.getBoundingClientRect().top
    const targetTop = element.getBoundingClientRect().top
    root.scrollTop += targetTop - rootTop
  }, [])

  useEffect(() => {
    jumpToPageRef.current = jumpToPage
  })

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return
      }
      if (event.target.closest('[data-new-text-ui],[data-new-text-style]')) {
        return
      }
      commitNewTextDraft()
      commitNewTextEdit()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [commitNewTextDraft, commitNewTextEdit])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      if (textDraftRef.current || newTextEditRef.current) {
        return
      }
      const id = historyRef.current.getView().selectedTextId
      if (!id) {
        return
      }
      event.preventDefault()
      historyRef.current.commit((snapshot) => ({
        ...snapshot,
        texts: snapshot.texts.filter((item) => item.id !== id),
        selectedTextId: null,
      }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <TextEditorContext.Provider value={editorApi}>
      <HighlightContext.Provider value={highlightApi}>
      <DrawingContext.Provider value={drawingApi}>
      <ImageContext.Provider value={imageApi}>
      <NewTextContext.Provider value={newTextApi}>
      <div className="pdf-stage">
      {pdfDocument ? (
        <ThumbnailSidebar
          pdf={pdfDocument}
          currentPage={clampPageNumber(currentPage, pdfDocument.numPages)}
          onSelectPage={jumpToPage}
        />
      ) : null}
      <div
        ref={scrollerRef}
        className="pdf-viewer"
        role="region"
        aria-label="PDF pages"
      >
      {pdf.errorMessage ? (
        <p className="viewer-status viewer-status--error" role="alert">
          {pdf.errorMessage}
        </p>
      ) : null}

      {!pdfDocument && !pdf.errorMessage ? (
        <div className="viewer-status" role="status">
          <span className="spinner" aria-hidden="true" />
          Opening PDF…
        </div>
      ) : null}

      {pdfDocument ? (
        <div className="pdf-viewer__pages">
          {Array.from({ length: pdfDocument.numPages }, (_, index) => {
            const pageNumber = index + 1
            return (
              <PdfPage
                key={pageNumber}
                pdf={pdfDocument}
                pageNumber={pageNumber}
                scale={scale}
                onGeometry={registerGeometry}
                onUnregister={unregisterGeometry}
              />
            )
          })}
        </div>
      ) : null}
      </div>
      </div>
      </NewTextContext.Provider>
      </ImageContext.Provider>
      </DrawingContext.Provider>
      </HighlightContext.Provider>
    </TextEditorContext.Provider>
  )
}

function pageFrame(
  geometry: PageGeometry | undefined,
  scroller: HTMLDivElement | null,
): { pageWidth: number; pageHeight: number; centerX: number; centerY: number } {
  if (!geometry) {
    return { pageWidth: 612, pageHeight: 792, centerX: 306, centerY: 396 }
  }
  const { viewport, element } = geometry
  const page = pageSizeFromViewport(viewport)
  const pageWidth = page.width || 612
  const pageHeight = page.height || 792
  const pageBox = element.getBoundingClientRect()
  const view = scroller?.getBoundingClientRect()
  let left = pageBox.left
  let right = pageBox.right
  let top = pageBox.top
  let bottom = pageBox.bottom
  if (view) {
    left = Math.max(left, view.left)
    right = Math.min(right, view.right)
    top = Math.max(top, view.top)
    bottom = Math.min(bottom, view.bottom)
  }
  if (right - left < 8 || bottom - top < 8) {
    const center = viewportPointToPdf(viewport, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    })
    return { pageWidth, pageHeight, centerX: center.x, centerY: center.y }
  }
  const center = viewportPointToPdf(viewport, {
    x: (left + right) / 2 - pageBox.left,
    y: (top + bottom) / 2 - pageBox.top,
  })
  return { pageWidth, pageHeight, centerX: center.x, centerY: center.y }
}
