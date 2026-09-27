import { useEffect, useState } from 'react'
import {
  deleteDocument,
  listDocuments,
  type DocumentListItem,
} from '../api/documents.ts'
import { SessionExpiredError } from '../api/accessToken.ts'
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

  useEffect(() => {
    let cancelled = false
    setError(null)

    void listDocuments()
      .then((items) => {
        if (!cancelled) {
          setDocuments(items)
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
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

  const loading = documents === null && error === null
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

        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}

        {deleteError ? (
          <p className="banner" role="alert">
            {deleteError}
          </p>
        ) : null}

        {loading ? <p className="dashboard__status">Loading documents…</p> : null}

        {!loading && documents && documents.length === 0 && !error ? (
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
                          : formatUpdated(document.updatedAt)}
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
