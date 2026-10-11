import { useEffect, useState } from 'react'
import {
  getDocumentVersions,
  type DocumentVersionRecord,
} from '../api/documents.ts'
import { formatFullTime, formatRelativeTime } from '../ui/relativeTime.ts'
import { Icon } from './icons.tsx'
import { Menu, MenuHeading, MenuItem } from './Menu.tsx'

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

  if (!documentId || currentVersion === null) {
    return null
  }

  const versions = loaded.documentId === documentId ? loaded.versions : []
  const error = loaded.documentId === documentId ? loaded.error : null

  return (
    <Menu
      label="Version history"
      align="end"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="button button--ghost version-trigger"
          aria-label={`Version ${currentVersion}. Version history`}
          data-tooltip="Version history"
        >
          <Icon name="history" />
          <span>v{currentVersion}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      )}
    >
      <MenuHeading>Saved versions</MenuHeading>
      {error ? <p className="menu__note menu__note--error">{error}</p> : null}
      {versions.length === 0 && !error ? <p className="menu__note">Loading…</p> : null}
      <div className="menu__scroll">
        {versions.map((version) => {
          const current = version.version === currentVersion
          return (
            <MenuItem
              key={version.id}
              checked={current}
              hint={
                <time dateTime={version.createdAt} title={formatFullTime(version.createdAt)}>
                  {formatRelativeTime(version.createdAt)}
                </time>
              }
              onSelect={() => {
                if (!current) {
                  onOpen(version)
                }
              }}
            >
              Version {version.version}
              {current ? <span className="menu__tag">Current</span> : null}
            </MenuItem>
          )
        })}
      </div>
    </Menu>
  )
}
