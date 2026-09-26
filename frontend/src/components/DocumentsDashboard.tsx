import { useEffect, useState } from 'react'
import {
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

  const loading = documents === null && error === null

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
              const busy = openingId === document.id
              return (
                <li key={document.id}>
                  <button
                    type="button"
                    className="dashboard__item"
                    disabled={openingId !== null}
                    onClick={() => onOpenDocument(document)}
                  >
                    <span className="dashboard__name" title={document.name}>
                      {document.name}
                    </span>
                    <span className="dashboard__meta">
                      {busy ? 'Opening…' : formatUpdated(document.updatedAt)}
                    </span>
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
