import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  deleteDocument,
  listDocuments,
  type DocumentListItem,
} from '../api/documents.ts'
import { SessionExpiredError } from '../api/accessToken.ts'
import { formatFullTime, formatRelativeTime } from '../ui/relativeTime.ts'
import { Banner, BANNER_AUTO_DISMISS_MS } from './Banner.tsx'
import { useConfirm } from './confirm.ts'
import { Icon } from './icons.tsx'
import { Menu, MenuItem } from './Menu.tsx'

type DocumentsDashboardProps = {
  refreshKey: number
  openingId: string | null
  onUpload: () => void
  onDropFile: (file: File) => void
  onOpenDocument: (document: DocumentListItem) => void
}

type SortKey = 'recent' | 'name' | 'oldest'

/** Mirrors MAX_DOCUMENTS_PER_USER in backend/src/lib/storageQuota.ts. */
const DOCUMENT_LIMIT = 50

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Last edited',
  name: 'Name',
  oldest: 'Oldest first',
}

export function DocumentsDashboard({
  refreshKey,
  openingId,
  onUpload,
  onDropFile,
  onOpenDocument,
}: DocumentsDashboardProps) {
  const confirm = useConfirm()
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    let cancelled = false

    void listDocuments()
      .then((items) => {
        if (!cancelled) {
          setDocuments(items)
          setError(null)
          setLoadFailed(false)
          setSessionExpired(false)
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        setLoadFailed(true)
        if (cause instanceof SessionExpiredError) {
          setSessionExpired(true)
          setError('Your session expired. Sign in again to see your documents.')
          return
        }
        setSessionExpired(false)
        // Keep any list already on screen; a failed refresh shouldn't empty it.
        setError(cause instanceof Error ? cause.message : 'Documents could not be loaded.')
      })

    return () => {
      cancelled = true
    }
  }, [refreshKey, retryKey])

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete(document: DocumentListItem) {
    const confirmed = await confirm({
      title: 'Delete this document?',
      body: `“${document.name}” and all ${document.version === 1 ? 'of its saved versions' : `${document.version} saved versions`} will be permanently removed. This can’t be undone.`,
      confirmLabel: 'Delete document',
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setDeletingId(document.id)
    setDeleteError(null)
    try {
      await deleteDocument(document.id)
      setDocuments((current) => current?.filter((item) => item.id !== document.id) ?? current)
    } catch (cause) {
      if (cause instanceof SessionExpiredError) {
        setDeleteError('Your session expired. Sign in again to delete documents.')
        return
      }
      setDeleteError(cause instanceof Error ? cause.message : 'The document could not be deleted.')
    } finally {
      setDeletingId(null)
    }
  }

  const visible = useMemo(() => {
    if (!documents) {
      return []
    }
    const needle = query.trim().toLocaleLowerCase()
    const filtered = needle
      ? documents.filter((item) => item.name.toLocaleLowerCase().includes(needle))
      : documents
    return [...filtered].sort((left, right) => {
      if (sort === 'name') {
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      }
      const delta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      return sort === 'oldest' ? -delta : delta
    })
  }, [documents, query, sort])

  const loading = documents === null && !loadFailed
  const busy = openingId !== null || deletingId !== null
  const total = documents?.length ?? 0
  const hasDocuments = total > 0

  function isFileDrag(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  return (
    <div
      className="dashboard"
      data-dragging={dragging ? 'true' : undefined}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) {
          return
        }
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (isFileDrag(event)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) {
          setDragging(false)
        }
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) {
          return
        }
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) {
          onDropFile(file)
        }
      }}
    >
      <div className="dashboard__panel">
        <div className="dashboard__header">
          <div className="dashboard__heading">
            <h1>Documents</h1>
            {hasDocuments ? (
              <span className="dashboard__count" title={`You can store up to ${DOCUMENT_LIMIT} documents`}>
                {total} of {DOCUMENT_LIMIT}
              </span>
            ) : null}
          </div>
          <button type="button" className="button button--primary" onClick={onUpload}>
            <Icon name="upload" />
            Upload PDF
          </button>
        </div>

        {error && hasDocuments ? (
          <Banner message={error} onDismiss={() => setError(null)} />
        ) : null}

        {deleteError ? (
          <Banner
            message={deleteError}
            onDismiss={() => setDeleteError(null)}
            autoDismissMs={BANNER_AUTO_DISMISS_MS}
          />
        ) : null}

        {hasDocuments ? (
          <div className="dashboard__controls">
            <label className="search-field">
              <Icon name="search" />
              <span className="sr-only">Filter documents</span>
              <input
                type="search"
                placeholder="Filter by name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Menu
              label="Sort documents"
              align="end"
              trigger={(props) => (
                <button {...props} type="button" className="button button--ghost">
                  <Icon name="sortDown" />
                  {SORT_LABELS[sort]}
                </button>
              )}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <MenuItem key={key} checked={sort === key} onSelect={() => setSort(key)}>
                  {SORT_LABELS[key]}
                </MenuItem>
              ))}
            </Menu>
          </div>
        ) : null}

        {loading ? <DocumentSkeleton /> : null}

        {loadFailed && !hasDocuments ? (
          <div className="dashboard__state dashboard__state--error" role="alert">
            <span className="dashboard__state-icon" aria-hidden="true">
              <Icon name="alert" size={18} />
            </span>
            <p className="dashboard__state-title">Couldn’t load your documents</p>
            <p className="dashboard__state-text">
              {error ?? 'Documents could not be loaded.'}
              {sessionExpired ? null : ' Check your connection and try again.'}
            </p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setLoadFailed(false)
                setError(null)
                setDocuments(null)
                setRetryKey((current) => current + 1)
              }}
            >
              Try again
            </button>
          </div>
        ) : null}

        {!loading && documents && total === 0 && !loadFailed ? (
          <button type="button" className="dropzone" onClick={onUpload}>
            <span className="dropzone__icon" aria-hidden="true">
              <Icon name="upload" size={20} />
            </span>
            <span className="dropzone__title">Upload your first PDF</span>
            <span className="dropzone__hint">Drop a PDF here or click to browse. Edits stay private to your account.</span>
          </button>
        ) : null}

        {hasDocuments ? (
          visible.length > 0 ? (
            <div className="doc-table" role="table" aria-label="Documents">
              <div className="doc-table__head" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader" className="doc-table__col-version">
                  Version
                </span>
                <span role="columnheader" className="doc-table__col-date">
                  Last edited
                </span>
                <span role="columnheader" className="doc-table__col-actions">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
              {visible.map((document) => {
                const opening = openingId === document.id
                const deleting = deletingId === document.id
                return (
                  <div
                    key={document.id}
                    className="doc-row"
                    role="row"
                    data-busy={opening || deleting ? 'true' : undefined}
                  >
                    <span role="cell" className="doc-row__name-cell">
                      <button
                        type="button"
                        className="doc-row__open"
                        disabled={busy}
                        onClick={() => onOpenDocument(document)}
                      >
                        <span className="file-glyph" aria-hidden="true">
                          PDF
                        </span>
                        <span className="doc-row__name" title={document.name}>
                          {document.name}
                        </span>
                        {opening ? (
                          <span className="doc-row__status">
                            <span className="spinner spinner--sm" aria-hidden="true" />
                            Opening
                          </span>
                        ) : deleting ? (
                          <span className="doc-row__status">Deleting…</span>
                        ) : null}
                      </button>
                    </span>
                    <span role="cell" className="doc-table__col-version doc-row__meta">
                      v{document.version}
                    </span>
                    <span role="cell" className="doc-table__col-date doc-row__meta">
                      <time dateTime={document.updatedAt} title={formatFullTime(document.updatedAt)}>
                        {formatRelativeTime(document.updatedAt)}
                      </time>
                    </span>
                    <span role="cell" className="doc-table__col-actions">
                      <button
                        type="button"
                        className="icon-button icon-button--danger doc-row__delete"
                        aria-label={`Delete ${document.name}`}
                        data-tooltip="Delete"
                        disabled={busy}
                        onClick={() => {
                          void handleDelete(document)
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="dashboard__state">
              <p>No documents match “{query.trim()}”.</p>
              <button type="button" className="button button--ghost" onClick={() => setQuery('')}>
                Clear filter
              </button>
            </div>
          )
        ) : null}

        {hasDocuments ? (
          <p className="dashboard__footnote">Tip: drop a PDF anywhere on this page to upload it.</p>
        ) : null}
      </div>
      {dragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__card">
            <Icon name="upload" size={20} />
            Drop to upload
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DocumentSkeleton() {
  return (
    <div className="doc-table doc-table--loading" role="status" aria-label="Loading documents">
      {[0.62, 0.44, 0.71].map((width, index) => (
        <div key={index} className="doc-row doc-row--skeleton" aria-hidden="true">
          <span className="skeleton skeleton--glyph" />
          <span className="skeleton" style={{ width: `${width * 100}%` }} />
        </div>
      ))}
    </div>
  )
}
