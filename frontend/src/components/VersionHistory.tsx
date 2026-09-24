import { useEffect, useState } from 'react'
import {
  getDocumentVersions,
  type DocumentVersionRecord,
} from '../api/documents.ts'

type VersionHistoryProps = {
  documentId: string | null
  currentVersion: number | null
  refreshKey: number
  onOpen: (version: DocumentVersionRecord) => void
}

export function VersionHistory({
  documentId,
  currentVersion,
  refreshKey,
  onOpen,
}: VersionHistoryProps) {
  const [loaded, setLoaded] = useState<{
    documentId: string | null
    versions: DocumentVersionRecord[]
    error: string | null
  }>({
    documentId: null,
    versions: [],
    error: null,
  })

  if (loaded.documentId !== documentId) {
    setLoaded({ documentId, versions: [], error: null })
  }

  useEffect(() => {
    if (!documentId) {
      return
    }

    let cancelled = false
    void getDocumentVersions(documentId)
      .then((versions) => {
        if (!cancelled) {
          setLoaded({ documentId, versions, error: null })
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return
        }
        setLoaded({
          documentId,
          versions: [],
          error: loadError instanceof Error ? loadError.message : 'Versions could not be loaded.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [documentId, refreshKey])

  if (!documentId) {
    return null
  }

  const versions = loaded.documentId === documentId ? loaded.versions : []
  const error = loaded.documentId === documentId ? loaded.error : null

  return (
    <section className="versions" aria-label="Version history">
      <h2>Versions</h2>
      {error ? <p className="versions__error">{error}</p> : null}
      {versions.length === 0 && !error ? <p>Loading versions…</p> : null}
      <ul>
        {versions.map((version) => {
          const current = version.version === currentVersion
          return (
            <li key={version.id} data-current={current ? 'true' : undefined}>
              <span>Version {version.version}</span>
              <time dateTime={version.createdAt}>{formatVersionTime(version.createdAt)}</time>
              {current ? <span>Current</span> : null}
              <button
                type="button"
                aria-label={`Open version ${version.version}`}
                onClick={() => onOpen(version)}
              >
                Open
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function formatVersionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}
