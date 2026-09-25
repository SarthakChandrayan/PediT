import { describe, expect, it } from 'vitest'
import { documentSaveLabel, documentSaveState } from './saveState.ts'

describe('documentSaveState', () => {
  it('is idle when no document is open', () => {
    expect(documentSaveState({ open: false, saving: false, dirty: true })).toBe('idle')
  })

  it('prefers saving over dirty while a save is in flight', () => {
    expect(documentSaveState({ open: true, saving: true, dirty: true })).toBe('saving')
  })

  it('is unsaved when the existing dirty flag is set', () => {
    expect(documentSaveState({ open: true, saving: false, dirty: true })).toBe('unsaved')
  })

  it('is saved when the document is open and clean', () => {
    expect(documentSaveState({ open: true, saving: false, dirty: false })).toBe('saved')
  })
})

describe('documentSaveLabel', () => {
  it('uses the existing save wording', () => {
    expect(documentSaveLabel('idle')).toBeNull()
    expect(documentSaveLabel('saved')).toBe('Saved')
    expect(documentSaveLabel('unsaved')).toBe('Unsaved changes')
    expect(documentSaveLabel('saving')).toBe('Saving…')
  })
})
