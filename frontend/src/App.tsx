import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  getDocumentVersionFile,
  type DocumentListItem,
  type DocumentVersionRecord,
} from './api/documents.ts'
import { saveDocumentVersion } from './api/saveDocumentVersion.ts'
import { uploadDocument } from './api/uploadDocument.ts'
import { AuthProvider } from './auth/AuthContext.tsx'
import { useAuth } from './auth/useAuth.ts'
import { AuthScreen } from './auth/AuthScreen.tsx'
import { DocumentsDashboard } from './components/DocumentsDashboard.tsx'
import { EditorHeader } from './components/EditorHeader.tsx'
import { Toolbar } from './components/Toolbar.tsx'
import { SearchProvider, useSearch } from './pdf/SearchContext.tsx'
import { isFindShortcut, shouldCloseSearchOnEscape } from './pdf/search.ts'
import { VersionHistory } from './components/VersionHistory.tsx'
import { DocumentHistoryProvider } from './pdf/DocumentHistoryProvider.tsx'
import { useDocumentHistory } from './pdf/DocumentHistoryContext.tsx'
import {
  clonePdfBytes,
  shouldWarnOnUnload,
  withPageOperation,
  type DocumentSnapshot,
} from './pdf/documentHistory.ts'
import { type DrawingKind } from './pdf/drawings.ts'
import { loadLocalImage } from './pdf/images.ts'
import { exportEditedPdf } from './pdf/exportPdf.ts'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  type HighlightColorName,
} from './pdf/highlights.ts'
import {
  addBlankPage,
  deletePage,
  duplicatePage,
  PageOperationError,
  reorderPages,
  rotatePage,
} from './pdf/pageOperations.ts'
import {
  PdfViewer,
  type AnnotationUiState,
  type PdfViewerHandle,
} from './pdf/PdfViewer.tsx'
import { DEFAULT_PDF_SCALE, stepPdfScale } from './pdf/scale.ts'
import { documentSaveState } from './ui/saveState.ts'

function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  )
}

function AuthenticatedApp() {
  const auth = useAuth()
  if (!auth.configured || auth.status !== 'authenticated') {
    return <AuthScreen />
  }

  return (
    <DocumentHistoryProvider>
      <Editor
        userEmail={auth.email}
        onLogout={() => {
          void auth.signOut()
        }}
      />
    </DocumentHistoryProvider>
  )
}

function Editor({
  userEmail,
  onLogout,
}: {
  userEmail: string | null
  onLogout: () => void
}) {
  const history = useDocumentHistory()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<PdfViewerHandle>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [scale, setScale] = useState(DEFAULT_PDF_SCALE)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [openError, setOpenError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [versionFileUrl, setVersionFileUrl] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [versionListRevision, setVersionListRevision] = useState(0)
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null)
  const [pageOpPending, setPageOpPending] = useState(false)
  const [focusPage, setFocusPage] = useState(1)
  const uploadGeneration = useRef(0)
  const openGeneration = useRef(0)
  const saveLock = useRef(false)
  const pageOpLock = useRef(false)
  const resetHistoryRef = useRef(history.reset)
  const undoRef = useRef(history.undo)
  const redoRef = useRef(history.redo)
  resetHistoryRef.current = history.reset
  undoRef.current = history.undo
  redoRef.current = history.redo
  const [documentSession, setDocumentSession] = useState(0)
  const [highlightColor, setHighlightColor] = useState<HighlightColorName>(
    DEFAULT_HIGHLIGHT_COLOR,
  )
  const [annotationUi, setAnnotationUi] = useState<AnnotationUiState>({
    canHighlight: false,
    canRemoveHighlight: false,
    drawingTool: null,
    textTool: false,
    selectedNewText: null,
    selectedImage: null,
    selectedDrawing: false,
    hasUncommittedEdit: false,
  })
  const historyDirtyRef = useRef(history.isDirty)
  historyDirtyRef.current = history.isDirty

  useEffect(() => {
    const generation = uploadGeneration.current
    let cancelled = false

    void restoreOpenDocument(() => cancelled).then((restored) => {
      if (!restored || cancelled || uploadGeneration.current !== generation) {
        return
      }
      resetHistoryRef.current(loadedSnapshot(restored.bytes))
      setDocumentSession((current) => current + 1)
      setFocusPage(1)
      setFileName(restored.fileName)
      setDocumentId(restored.documentId)
      setCurrentVersion(restored.version)
      setVersionFileUrl(restored.fileUrl)
      setScale(DEFAULT_PDF_SCALE)
      setCurrentPage(1)
      setPageCount(0)
      setOpenError(null)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldWarnOnUnload(
          historyDirtyRef.current,
          viewerRef.current?.hasUncommittedEdit() ?? false,
        )
      ) {
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isNativeTextUndoTarget(event.target)) {
        return
      }
      const meta = event.ctrlKey || event.metaKey
      if (!meta || event.altKey) {
        return
      }
      const key = event.key.toLowerCase()
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)
      const undo = key === 'z' && !event.shiftKey
      if (!undo && !redo) {
        return
      }
      event.preventDefault()
      if (pageOpLock.current || saveLock.current) {
        return
      }
      if (redo) {
        viewerRef.current?.abandonActiveEdit()
        viewerRef.current?.dismissDrawingDraft()
        redoRef.current()
        return
      }
      viewerRef.current?.abandonActiveEdit()
      if (viewerRef.current?.dismissDrawingDraft()) {
        return
      }
      undoRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !fileName) {
      return
    }
    try {
      const image = await loadLocalImage(file)
      const page = selectedPageNumber() ?? 1
      viewerRef.current?.insertImage(page, image)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'That image could not be opened.')
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setOpenError('Choose a PDF file.')
      return
    }

    const generation = uploadGeneration.current + 1
    uploadGeneration.current = generation
    openGeneration.current += 1
    setFocusPage(1)
    setDocumentSession((current) => current + 1)
    clearStoredDocument()
    setDocumentId(null)
    setCurrentVersion(null)
    setVersionFileUrl(null)
    setUploadError(null)
    setSaveError(null)

    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      viewerRef.current?.abandonActiveEdit()
      viewerRef.current?.dismissDrawingDraft()
      history.reset(loadedSnapshot(bytes))
      setFileName(file.name)
      setScale(DEFAULT_PDF_SCALE)
      setCurrentPage(1)
      setPageCount(0)
      setOpenError(null)
    } catch {
      setOpenError('Could not read that file.')
      return
    }

    void uploadDocument(file)
      .then((uploaded) => {
        if (uploadGeneration.current === generation) {
          setDocumentId(uploaded.id)
          setCurrentVersion(uploaded.version)
          setVersionFileUrl(uploaded.fileUrl)
          setVersionListRevision((current) => current + 1)
          rememberOpenDocument({
            documentId: uploaded.id,
            version: uploaded.version,
            fileName: file.name,
            fileUrl: uploaded.fileUrl,
          })
          setDashboardRefreshKey((current) => current + 1)
        }
      })
      .catch((error: unknown) => {
        if (uploadGeneration.current !== generation) {
          return
        }
        setUploadError(
          error instanceof Error
            ? error.message
            : 'Saving this PDF to the server failed. It is still open locally.',
        )
      })
  }

  async function handleSave() {
    if (!fileName || !documentId || saveLock.current || pageOpLock.current) {
      return
    }

    viewerRef.current?.flushActiveEdit()
    viewerRef.current?.dismissDrawingDraft()
    history.endGesture()
    if (
      !shouldWarnOnUnload(history.isDirtyNow(), viewerRef.current?.hasUncommittedEdit() ?? false)
    ) {
      return
    }

    saveLock.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const epoch = history.getEpoch()
      const snapshot = history.getSettled()
      let exported: Uint8Array
      try {
        exported = await exportSnapshot(snapshot)
      } catch (error) {
        setSaveError(exportErrorMessage(error))
        return
      }

      const saved = await saveDocumentVersion(documentId, exported)
      if (history.getEpoch() === epoch) {
        history.markSaved()
      }
      setCurrentVersion(saved.version)
      setVersionFileUrl(saved.fileUrl)
      setVersionListRevision((current) => current + 1)
      rememberOpenDocument({
        documentId,
        version: saved.version,
        fileName,
        fileUrl: saved.fileUrl,
      })
    } catch (error) {
      setSaveError(saveErrorMessage(error))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  async function handleOpenVersion(version: DocumentVersionRecord) {
    if (!documentId) {
      return
    }

    if (hasUnsavedEdits() && !window.confirm(UNSAVED_VERSION_MESSAGE)) {
      return
    }

    const generation = openGeneration.current + 1
    openGeneration.current = generation
    const documentAtOpen = documentId

    try {
      const bytes = await getDocumentVersionFile(documentAtOpen, version.version)
      if (openGeneration.current !== generation) {
        return
      }

      viewerRef.current?.abandonActiveEdit()
      viewerRef.current?.dismissDrawingDraft()
      resetHistoryRef.current(loadedSnapshot(bytes))
      setDocumentSession((current) => current + 1)
      setFocusPage(1)
      setCurrentVersion(version.version)
      setVersionFileUrl(version.fileUrl)
      setScale(DEFAULT_PDF_SCALE)
      setCurrentPage(1)
      setPageCount(0)
      setOpenError(null)
      rememberOpenDocument({
        documentId: documentAtOpen,
        version: version.version,
        fileName,
        fileUrl: version.fileUrl,
      })
    } catch (error) {
      if (openGeneration.current !== generation) {
        return
      }
      setOpenError(
        error instanceof Error ? error.message : 'That version could not be opened.',
      )
    }
  }

  function hasUnsavedEdits(): boolean {
    return shouldWarnOnUnload(
      history.isDirty,
      viewerRef.current?.hasUncommittedEdit() ?? false,
    )
  }

  async function handleOpenListedDocument(document: DocumentListItem) {
    if (openingDocumentId !== null) {
      return
    }
    if (hasUnsavedEdits() && !window.confirm(UNSAVED_DOCUMENT_MESSAGE)) {
      return
    }

    const generation = openGeneration.current + 1
    openGeneration.current = generation
    uploadGeneration.current += 1
    setOpeningDocumentId(document.id)
    setOpenError(null)
    setUploadError(null)
    setSaveError(null)

    try {
      const bytes = await getDocumentVersionFile(document.id, document.version)
      if (openGeneration.current !== generation) {
        return
      }

      viewerRef.current?.abandonActiveEdit()
      viewerRef.current?.dismissDrawingDraft()
      resetHistoryRef.current(loadedSnapshot(bytes))
      setDocumentSession((current) => current + 1)
      setFocusPage(1)
      setFileName(document.name)
      setDocumentId(document.id)
      setCurrentVersion(document.version)
      setVersionFileUrl(document.fileUrl)
      setScale(DEFAULT_PDF_SCALE)
      setCurrentPage(1)
      setPageCount(0)
      setVersionListRevision((current) => current + 1)
      rememberOpenDocument({
        documentId: document.id,
        version: document.version,
        fileName: document.name,
        fileUrl: document.fileUrl,
      })
    } catch (error) {
      if (openGeneration.current !== generation) {
        return
      }
      setOpenError(
        error instanceof Error ? error.message : 'That document could not be opened.',
      )
    } finally {
      if (openGeneration.current === generation) {
        setOpeningDocumentId(null)
      }
    }
  }

  function handleBackToDocuments() {
    if (hasUnsavedEdits() && !window.confirm(UNSAVED_DOCUMENT_MESSAGE)) {
      return
    }

    openGeneration.current += 1
    uploadGeneration.current += 1
    viewerRef.current?.abandonActiveEdit()
    viewerRef.current?.dismissDrawingDraft()
    clearStoredDocument()
    setDocumentId(null)
    setCurrentVersion(null)
    setVersionFileUrl(null)
    setFileName(null)
    setPageCount(0)
    setCurrentPage(1)
    setFocusPage(1)
    setScale(DEFAULT_PDF_SCALE)
    setOpenError(null)
    setUploadError(null)
    setSaveError(null)
    setOpeningDocumentId(null)
    setAnnotationUi({
      canHighlight: false,
      canRemoveHighlight: false,
      drawingTool: null,
      textTool: false,
      selectedNewText: null,
      selectedImage: null,
      selectedDrawing: false,
      hasUncommittedEdit: false,
    })
    setDashboardRefreshKey((current) => current + 1)
  }

  function workingSnapshot(): DocumentSnapshot {
    const view = history.getView()
    const edits = viewerRef.current?.snapshotTextEdits() ?? view.edits
    return { ...view, edits }
  }

  function handleUndo() {
    if (pageOpLock.current || saveLock.current) {
      return
    }
    viewerRef.current?.abandonActiveEdit()
    if (viewerRef.current?.dismissDrawingDraft()) {
      return
    }
    history.undo()
  }

  function handleRedo() {
    if (pageOpLock.current || saveLock.current) {
      return
    }
    viewerRef.current?.abandonActiveEdit()
    viewerRef.current?.dismissDrawingDraft()
    history.redo()
  }

  function selectedPageNumber(): number | null {
    if (pageCount < 1) {
      return null
    }
    return Math.min(Math.max(currentPage, 1), pageCount)
  }

  async function runPageOperation(
    operate: (bytes: Uint8Array) => Promise<Uint8Array>,
    nextPageNumber: number,
  ) {
    if (!fileName || pageOpLock.current || saveLock.current || exporting) {
      return
    }

    const generation = openGeneration.current
    viewerRef.current?.flushActiveEdit()
    viewerRef.current?.dismissDrawingDraft()
    history.endGesture()
    const epoch = history.getEpoch()
    const snapshot = history.getSettled()
    pageOpLock.current = true
    setPageOpPending(true)
    setOpenError(null)
    try {
      const base = await exportSnapshot(snapshot)
      if (openGeneration.current !== generation || history.getEpoch() !== epoch) {
        return
      }
      const next = await operate(base)
      if (openGeneration.current !== generation || history.getEpoch() !== epoch) {
        return
      }

      history.commit(() => withPageOperation(next), { pdfChanged: true })
      setFocusPage(nextPageNumber)
    } catch (error) {
      if (openGeneration.current !== generation) {
        return
      }
      setOpenError(pageOperationErrorMessage(error))
    } finally {
      pageOpLock.current = false
      setPageOpPending(false)
    }
  }

  function handleDeletePage() {
    const selected = selectedPageNumber()
    if (selected === null || pageCount < 2) {
      return
    }
    void runPageOperation(
      (bytes) => deletePage(bytes, selected - 1),
      Math.min(selected, pageCount - 1),
    )
  }

  function handleRotatePage() {
    const selected = selectedPageNumber()
    if (selected === null) {
      return
    }
    void runPageOperation((bytes) => rotatePage(bytes, selected - 1, 90), selected)
  }

  function handleDuplicatePage() {
    const selected = selectedPageNumber()
    if (selected === null) {
      return
    }
    void runPageOperation((bytes) => duplicatePage(bytes, selected - 1), selected)
  }

  function handleMovePageUp() {
    const selected = selectedPageNumber()
    if (selected === null || selected <= 1) {
      return
    }
    void runPageOperation(
      (bytes) => reorderPages(bytes, selected - 1, selected - 2),
      selected - 1,
    )
  }

  function handleMovePageDown() {
    const selected = selectedPageNumber()
    if (selected === null || selected >= pageCount) {
      return
    }
    void runPageOperation(
      (bytes) => reorderPages(bytes, selected - 1, selected),
      selected + 1,
    )
  }

  function handleAddBlankPage() {
    const selected = selectedPageNumber()
    if (selected === null) {
      return
    }
    void runPageOperation(
      (bytes) => addBlankPage(bytes, selected),
      selected + 1,
    )
  }

  async function handleExport() {
    if (!fileName || exporting || pageOpLock.current) {
      return
    }

    setExporting(true)
    setOpenError(null)
    try {
      const exported = await exportSnapshot(workingSnapshot())
      downloadPdf(exported, editedFileName(fileName))
    } catch (error) {
      setOpenError(exportErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <SearchProvider documentSession={documentSession}>
    <SearchHotkeys documentOpen={pageCount > 0} />
    <div
      className="app"
      data-document-id={documentId ?? undefined}
      data-current-version={currentVersion ?? undefined}
      data-version-file={versionFileUrl ?? undefined}
    >
      <EditorHeader
        fileName={fileName}
        saveState={documentSaveState({
          open: fileName !== null,
          saving,
          dirty: history.isDirty || annotationUi.hasUncommittedEdit,
        })}
        canSave={
          documentId !== null &&
          !saving &&
          !pageOpPending &&
          (history.isDirty || annotationUi.hasUncommittedEdit)
        }
        saving={saving}
        exporting={exporting}
        hasDocument={fileName !== null}
        onDocuments={handleBackToDocuments}
        onOpen={openFilePicker}
        onSave={() => {
          void handleSave()
        }}
        onExport={() => {
          void handleExport()
        }}
        userEmail={userEmail}
        onLogout={onLogout}
      />
      <input
        ref={imageInputRef}
        className="file-input"
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        onChange={(event) => {
          void handleImageChange(event)
        }}
      />
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          void handleFileChange(event)
        }}
      />
      <main className="workspace">
        <VersionHistory
          documentId={documentId}
          currentVersion={currentVersion}
          refreshKey={versionListRevision}
          onOpen={(version) => {
            void handleOpenVersion(version)
          }}
        />
        <div className="workspace__alerts">
          {openError ? (
            <p className="banner" role="alert">
              {openError}
            </p>
          ) : null}
          {uploadError ? (
            <p className="banner" role="alert">
              {uploadError}
            </p>
          ) : null}
          {saveError ? (
            <p className="banner" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
        {fileName ? (
          <PdfViewer
            ref={viewerRef}
            data={history.view.pdfBytes}
            scale={scale}
            currentPage={currentPage}
            focusPage={focusPage}
            onPageCountChange={setPageCount}
            onCurrentPageChange={(page) => {
              setCurrentPage(page)
              setFocusPage(page)
            }}
            onAnnotationStateChange={setAnnotationUi}
          />
        ) : (
          <DocumentsDashboard
            refreshKey={dashboardRefreshKey}
            openingId={openingDocumentId}
            onUpload={openFilePicker}
            onOpenDocument={(document) => {
              void handleOpenListedDocument(document)
            }}
          />
        )}
      </main>
      <Toolbar
        currentPage={currentPage}
        pageCount={pageCount}
        scale={scale}
        pageOpsDisabled={pageCount < 1 || pageOpPending || saving || exporting}
        canDeletePage={pageCount > 1}
        canMovePageUp={currentPage > 1}
        canMovePageDown={pageCount > 0 && currentPage > 0 && currentPage < pageCount}
        onZoomIn={() => setScale((current) => stepPdfScale(current, 1))}
        onZoomOut={() => setScale((current) => stepPdfScale(current, -1))}
        onFitWidth={() => {
          const next = viewerRef.current?.fitScale('width')
          if (next != null) {
            setScale(next)
          }
        }}
        onFitPage={() => {
          const next = viewerRef.current?.fitScale('page')
          if (next != null) {
            setScale(next)
          }
        }}
        onJumpToPage={(page) => {
          setFocusPage(page)
          viewerRef.current?.jumpToPage(page)
        }}
        canUndo={history.canUndo && !pageOpPending && !saving}
        canRedo={history.canRedo && !pageOpPending && !saving}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDeletePage={handleDeletePage}
        onRotatePage={handleRotatePage}
        onDuplicatePage={handleDuplicatePage}
        onMovePageUp={handleMovePageUp}
        onMovePageDown={handleMovePageDown}
        onAddBlankPage={handleAddBlankPage}
        canHighlight={annotationUi.canHighlight}
        canRemoveHighlight={annotationUi.canRemoveHighlight}
        highlightColor={highlightColor}
        onHighlightColor={setHighlightColor}
        onHighlightPointerDown={() => {
          viewerRef.current?.captureTextSelection()
        }}
        onHighlight={() => {
          viewerRef.current?.applyHighlight(HIGHLIGHT_COLORS[highlightColor])
        }}
        onUnderline={() => {
          viewerRef.current?.applyUnderline()
        }}
        onStrikethrough={() => {
          viewerRef.current?.applyStrikethrough()
        }}
        onRemoveHighlight={() => {
          viewerRef.current?.removeSelectedHighlight()
        }}
        drawingTool={annotationUi.drawingTool}
        onDrawingTool={(tool: DrawingKind) => {
          viewerRef.current?.setDrawingTool(tool)
        }}
        textTool={annotationUi.textTool}
        onTextTool={() => {
          viewerRef.current?.setTextTool()
        }}
        onSelectTool={() => {
          const tool = annotationUi.drawingTool
          if (tool) {
            viewerRef.current?.setDrawingTool(tool)
          }
          if (annotationUi.textTool) {
            viewerRef.current?.setTextTool(false)
          }
        }}
        selectedNewText={annotationUi.selectedNewText}
        selectedImage={annotationUi.selectedImage}
        selectedDrawing={annotationUi.selectedDrawing}
        onNewTextStyle={(patch) => {
          viewerRef.current?.patchSelectedNewText(patch)
        }}
        onInsertImage={() => {
          imageInputRef.current?.click()
        }}
      />
    </div>
    </SearchProvider>
  )
}

function SearchHotkeys({ documentOpen }: { documentOpen: boolean }) {
  const search = useSearch()
  const openRef = useRef(search.openSearch)
  const closeRef = useRef(search.closeSearch)
  const openStateRef = useRef(search.open)

  useEffect(() => {
    openRef.current = search.openSearch
    closeRef.current = search.closeSearch
    openStateRef.current = search.open
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFindShortcut(event) && (documentOpen || openStateRef.current)) {
        event.preventDefault()
        openRef.current()
        return
      }
      if (shouldCloseSearchOnEscape(event, openStateRef.current, event.target)) {
        event.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [documentOpen])

  return null
}

const UNSAVED_VERSION_MESSAGE = 'You have unsaved changes. Open this version anyway?'
const UNSAVED_DOCUMENT_MESSAGE = 'You have unsaved changes. Leave this document anyway?'
const OPEN_DOCUMENT_KEY = 'pdfforge.openDocument'

function loadedSnapshot(pdfBytes: Uint8Array): DocumentSnapshot {
  return {
    pdfBytes,
    edits: [],
    markups: [],
    drawings: [],
    images: [],
    texts: [],
    selectedMarkupId: null,
    selectedDrawingId: null,
    selectedImageId: null,
    selectedTextId: null,
  }
}

async function exportSnapshot(snapshot: DocumentSnapshot): Promise<Uint8Array> {
  if (
    snapshot.edits.length === 0 &&
    snapshot.markups.length === 0 &&
    snapshot.drawings.length === 0 &&
    snapshot.images.length === 0 &&
    (snapshot.texts?.length ?? 0) === 0
  ) {
    return clonePdfBytes(snapshot.pdfBytes)
  }
  const copy = new ArrayBuffer(snapshot.pdfBytes.byteLength)
  new Uint8Array(copy).set(snapshot.pdfBytes)
  return exportEditedPdf(
    copy,
    snapshot.edits,
    snapshot.markups,
    snapshot.drawings,
    snapshot.images,
    snapshot.texts ?? [],
  )
}

function isNativeTextUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  if (target instanceof HTMLTextAreaElement) {
    return true
  }
  if (target instanceof HTMLInputElement) {
    const type = target.type
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'email' ||
      type === 'url' ||
      type === 'tel' ||
      type === 'password' ||
      type === 'number'
    )
  }
  return false
}

type StoredOpenDocument = {
  documentId: string
  version: number
  fileName: string | null
  fileUrl: string
}

function rememberOpenDocument(document: StoredOpenDocument) {
  sessionStorage.setItem(OPEN_DOCUMENT_KEY, JSON.stringify(document))
}

function clearStoredDocument() {
  sessionStorage.removeItem(OPEN_DOCUMENT_KEY)
}

function readStoredDocument(): StoredOpenDocument | null {
  const raw = sessionStorage.getItem(OPEN_DOCUMENT_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredOpenDocument(parsed)) {
      sessionStorage.removeItem(OPEN_DOCUMENT_KEY)
      return null
    }
    return parsed
  } catch {
    sessionStorage.removeItem(OPEN_DOCUMENT_KEY)
    return null
  }
}

function isStoredOpenDocument(value: unknown): value is StoredOpenDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    'documentId' in value &&
    typeof value.documentId === 'string' &&
    value.documentId.length > 0 &&
    'version' in value &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    'fileName' in value &&
    (value.fileName === null || typeof value.fileName === 'string') &&
    'fileUrl' in value &&
    typeof value.fileUrl === 'string' &&
    value.fileUrl.length > 0
  )
}

async function restoreOpenDocument(
  isCancelled: () => boolean,
): Promise<(StoredOpenDocument & { bytes: Uint8Array }) | null> {
  const stored = readStoredDocument()
  if (!stored) {
    return null
  }

  try {
    const bytes = await getDocumentVersionFile(stored.documentId, stored.version)
    if (isCancelled()) {
      return null
    }
    return { ...stored, bytes }
  } catch {
    if (!isCancelled()) {
      clearStoredDocument()
    }
    return null
  }
}

function downloadPdf(bytes: Uint8Array, downloadName: string) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = downloadName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 15000)
}

function editedFileName(fileName: string | null): string {
  if (!fileName) {
    return 'edited.pdf'
  }

  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) {
    return `${fileName}-edited.pdf`
  }

  return `${fileName.slice(0, dot)}-edited.pdf`
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Saving this version failed. Your edits are still in the editor.'
}

function exportErrorMessage(error: unknown): string {
  if (error instanceof Error && /encrypt/i.test(error.message)) {
    return 'This PDF is encrypted and cannot be exported yet.'
  }

  return 'Could not export this PDF.'
}

function pageOperationErrorMessage(error: unknown): string {
  if (error instanceof PageOperationError) {
    return error.message
  }

  if (error instanceof Error && /encrypt/i.test(error.message)) {
    return 'This PDF is encrypted and cannot be edited yet.'
  }

  return 'That page change could not be applied.'
}

export default App
