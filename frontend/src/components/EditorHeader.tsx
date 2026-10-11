import type { ReactNode } from 'react'
import { BrandMark, Icon } from './icons.tsx'
import { Menu, MenuHeading, MenuItem } from './Menu.tsx'
import { documentSaveLabel, type DocumentSaveState } from '../ui/saveState.ts'

type EditorHeaderProps = {
  fileName: string | null
  saveState: DocumentSaveState
  uploading: boolean
  canSave: boolean
  saving: boolean
  exporting: boolean
  hasDocument: boolean
  versions: ReactNode
  onDocuments: () => void
  onOpen: () => void
  onSave: () => void
  onExport: () => void
  userEmail: string | null
  onLogout: () => void
}

export function EditorHeader({
  fileName,
  saveState,
  uploading,
  canSave,
  saving,
  exporting,
  hasDocument,
  versions,
  onDocuments,
  onOpen,
  onSave,
  onExport,
  userEmail,
  onLogout,
}: EditorHeaderProps) {
  const status = uploading ? 'Uploading…' : documentSaveLabel(saveState)
  const state = uploading ? 'saving' : saveState

  return (
    <header className="app-header">
      <AppBrand onClick={hasDocument ? onDocuments : undefined} />
      {hasDocument ? (
        <nav className="crumbs" aria-label="Breadcrumb">
          <button type="button" className="crumbs__link" onClick={onDocuments}>
            Documents
          </button>
          <span className="crumbs__sep" aria-hidden="true">
            /
          </span>
          <span className="crumbs__current" title={fileName ?? undefined} aria-current="page">
            {fileName}
          </span>
        </nav>
      ) : null}
      {hasDocument && status ? (
        <p className="save-state" data-state={state} aria-live="polite" title={status}>
          {state === 'saving' ? (
            <span className="spinner spinner--sm" aria-hidden="true" />
          ) : state === 'saved' ? (
            <Icon name="check" size={14} />
          ) : (
            <span className="save-state__dot" aria-hidden="true" />
          )}
          <span className="save-state__label">{status}</span>
        </p>
      ) : null}
      <div className="app-header__actions">
        {hasDocument ? (
          <>
            {versions}
            <button
              type="button"
              className="icon-button"
              aria-label="Open another PDF"
              data-tooltip="Open another PDF"
              onClick={onOpen}
            >
              <Icon name="open" />
            </button>
            <span className="app-header__divider" aria-hidden="true" />
            <button
              type="button"
              className="button button--secondary"
              onClick={onExport}
              disabled={exporting}
            >
              <Icon name="export" />
              {exporting ? 'Exporting…' : 'Download'}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={onSave}
              disabled={!canSave || saving}
              aria-keyshortcuts="Control+S Meta+S"
              title={canSave ? 'Save as a new version' : undefined}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : null}
        <AccountMenu email={userEmail} onLogout={onLogout} />
      </div>
    </header>
  )
}

export function AppBrand({ onClick }: { onClick?: () => void }) {
  const content = (
    <>
      <BrandMark />
      <span className="brand__name">PeDit</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className="brand" onClick={onClick} aria-label="PeDit, back to documents">
        {content}
      </button>
    )
  }
  return <div className="brand">{content}</div>
}

function AccountMenu({ email, onLogout }: { email: string | null; onLogout: () => void }) {
  const initial = (email?.trim()[0] ?? '?').toUpperCase()
  return (
    <Menu
      label="Account"
      align="end"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="avatar-button"
          aria-label={email ? `Account: ${email}` : 'Account'}
        >
          <span className="avatar" aria-hidden="true">
            {initial}
          </span>
        </button>
      )}
    >
      <MenuHeading>
        <span className="menu__account-label">Signed in as</span>
        <span className="menu__account-email" title={email ?? undefined}>
          {email ?? 'Unknown account'}
        </span>
      </MenuHeading>
      <MenuItem icon="logout" onSelect={onLogout}>
        Sign out
      </MenuItem>
    </Menu>
  )
}
