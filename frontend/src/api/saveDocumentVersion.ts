import { authorizedFetch, SessionExpiredError } from './accessToken.ts'
import { DOCUMENTS_URL } from './documents.ts'

export type SavedDocumentVersion = {
  id: string
  documentId: string
  version: number
  fileUrl: string
  createdAt: string
}

export async function saveDocumentVersion(
  documentId: string,
  pdf: Uint8Array,
): Promise<SavedDocumentVersion> {
  const copy = new Uint8Array(pdf.byteLength)
  copy.set(pdf)
  const body = new FormData()
  body.append('file', new File([copy], 'edited.pdf', { type: 'application/pdf' }))

  let response: Response
  try {
    response = await authorizedFetch(`${DOCUMENTS_URL}/${encodeURIComponent(documentId)}/versions`, {
      method: 'POST',
      body,
    })
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error
    }
    throw new Error('The server is unavailable. Your edits are still in the editor.', { cause: error })
  }

  if (response.ok) {
    const payload: unknown = await response.json()
    if (!isSavedDocumentVersion(payload)) {
      throw new Error('Saving this version failed. Your edits are still in the editor.')
    }
    return payload
  }

  if (response.status === 413) {
    throw new Error('This PDF is larger than 20 MB, so this version was not saved.')
  }

  if (response.status === 404) {
    throw new Error('This document is no longer on the server. Your edits are still in the editor.')
  }

  throw new Error('Saving this version failed. Your edits are still in the editor.')
}

function isSavedDocumentVersion(value: unknown): value is SavedDocumentVersion {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'documentId' in value &&
    typeof value.documentId === 'string' &&
    value.documentId.length > 0 &&
    'version' in value &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    'fileUrl' in value &&
    typeof value.fileUrl === 'string' &&
    value.fileUrl.length > 0 &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    value.createdAt.length > 0
  )
}
