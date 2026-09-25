import { Icon } from './icons.tsx'
import { documentSaveLabel, type DocumentSaveState } from '../ui/saveState.ts'

type EditorHeaderProps = {
  fileName: string | null
  saveState: DocumentSaveState
  canSave: boolean
  saving: boolean
  exporting: boolean
  hasDocument: boolean
  onOpen: () => void
  onSave: () => void
  onExport: () => void
  userEmail: string | null
  onLogout: () => void
}

export function EditorHeader({
  fileName,
  saveState,
  canSave,
  saving,
  exporting,
  hasDocument,
  onOpen,
  onSave,
  onExport,
  userEmail,
  onLogout,
}: EditorHeaderProps) {
  const status = documentSaveLabel(saveState)

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <img className="app-header__logo" src="/mainlogo.png" alt="PeDit" />
      </div>
      <p className="app-header__title" title={fileName ?? undefined}>
        {fileName ?? 'No PDF open'}
      </p>
      {status ? (
        <p className="app-header__state" data-state={saveState} aria-live="polite">
          <span className="app-header__dot" aria-hidden="true" />
          {status}
        </p>
      ) : null}
      <div className="app-header__actions">
        <button type="button" className="button button--ghost" onClick={onOpen}>
          <Icon name="open" />
          Open
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={onSave}
          disabled={!canSave || saving}
        >
          <Icon name="save" />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={onExport}
          disabled={!hasDocument || exporting}
        >
          <Icon name="export" />
          {exporting ? 'Exporting…' : 'Export'}
        </button>
        {userEmail ? (
          <p className="app-header__user" title={userEmail}>
            {userEmail}
          </p>
        ) : null}
        <button type="button" className="button button--ghost" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  )
}
