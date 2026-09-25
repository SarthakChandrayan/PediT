export type DocumentSaveState = 'idle' | 'saved' | 'unsaved' | 'saving'

export function documentSaveState(input: {
  open: boolean
  saving: boolean
  dirty: boolean
}): DocumentSaveState {
  if (!input.open) {
    return 'idle'
  }
  if (input.saving) {
    return 'saving'
  }
  if (input.dirty) {
    return 'unsaved'
  }
  return 'saved'
}

export function documentSaveLabel(state: DocumentSaveState): string | null {
  if (state === 'saving') {
    return 'Saving…'
  }
  if (state === 'unsaved') {
    return 'Unsaved changes'
  }
  if (state === 'saved') {
    return 'Saved'
  }
  return null
}
