import { useEffect, useState } from 'react'
import {
  deleteDocument,
  listDocuments,
  type DocumentListItem,
} from '../api/documents.ts'
import { SessionExpiredError } from '../api/accessToken.ts'
import { Banner, BANNER_AUTO_DISMISS_MS } from './Banner.tsx'
import { Icon } from './icons.tsx'

type DocumentsDashboardProps = {
  refreshKey: number
  openingId: string | null
  onUpload: () => void
  onOpenDocument: (document: DocumentListItem) => void
}

export function DocumentsDashboard({
  refreshKey,
  openingId,
  onUpload,
  onOpenDocument,
}: DocumentsDashboardProps) {
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    void listDocuments()
      .then((items) => {
        if (!cancelled) {
          setDocuments(items)
          setError(null)
          setLoadFailed(false)
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        setLoadFailed(true)
        if (cause instanceof SessionExpiredError) {
          setError('Your session expired. Sign in again to see your documents.')
          return
        }
        setError(cause instanceof Error ? cause.message : 'Documents could not be loaded.')
        setDocuments([])
      })

    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete(document: DocumentListItem) {
    const confirmed = window.confirm(
      `Delete "${document.name}" and all of its saved versions? This cannot be undone.`,
    )
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

  const loading = documents === null && !loadFailed
  const busy = openingId !== null || deletingId !== null

  return (
    <div className="dashboard">
      <div className="dashboard__panel">
        <div className="dashboard__header">
          <div>
            <h1>Your documents</h1>
            <p>Open a saved PDF or upload a new one to edit.</p>
          </div>
          <button type="button" className="button button--primary" onClick={onUpload}>
            <Icon name="open" />
            Upload PDF
          </button>
        </div>

        {error ? <Banner message={error} onDismiss={() => setError(null)} /> : null}

        {deleteError ? (
          <Banner
            message={deleteError}
            onDismiss={() => setDeleteError(null)}
            autoDismissMs={BANNER_AUTO_DISMISS_MS}
          />
        ) : null}

        {loading ? <p className="dashboard__status">Loading documents…</p> : null}

        {!loading && documents && documents.length === 0 && !loadFailed ? (
          <div className="dashboard__empty">
            <p>No documents yet.</p>
            <button type="button" className="button button--secondary" onClick={onUpload}>
              Upload your first PDF
            </button>
          </div>
        ) : null}

        {documents && documents.length > 0 ? (
          <ul className="dashboard__list">
            {documents.map((document) => {
              const opening = openingId === document.id
              const deleting = deletingId === document.id
              return (
                <li key={document.id} className="dashboard__row">
                  <button
                    type="button"
                    className="dashboard__item"
                    disabled={busy}
                    onClick={() => onOpenDocument(document)}
                  >
                    <span className="dashboard__name" title={document.name}>
                      {document.name}
                    </span>
                    <span className="dashboard__meta">
                      {opening
                        ? 'Opening…'
                        : deleting
                          ? 'Deleting…'
                          : `Version ${document.version} · ${formatUpdated(document.updatedAt)}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dashboard__delete"
                    title="Delete document"
                    aria-label={`Delete ${document.name}`}
                    disabled={busy}
                    onClick={() => {
                      void handleDelete(document)
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function formatUpdated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently'
  }
  return `Updated ${date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`
}
