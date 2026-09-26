import { authorizedFetch, SessionExpiredError } from './accessToken.ts'

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:8000'

export const DOCUMENTS_URL = `${API_ORIGIN}/api/documents`

export type DocumentListItem = {
  id: string
  name: string
  version: number
  fileUrl: string
  createdAt: string
  updatedAt: string
}

export type DocumentVersionRecord = {
  id: string
  version: number
  fileUrl: string
  createdAt: string
}

export async function listDocuments(): Promise<DocumentListItem[]> {
  let response: Response
  try {
    response = await authorizedFetch(DOCUMENTS_URL)
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error
    }
    throw new Error('The server is unavailable.', { cause: error })
  }

  if (response.status === 401) {
    throw new SessionExpiredError()
  }

  if (!response.ok) {
    throw new Error('Documents could not be loaded.')
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload) || !payload.every(isDocumentListItem)) {
    throw new Error('Documents could not be loaded.')
  }

  return payload
}

export async function getDocumentVersions(
  documentId: string,
): Promise<DocumentVersionRecord[]> {
  let response: Response
  try {
    response = await authorizedFetch(`${DOCUMENTS_URL}/${encodeURIComponent(documentId)}/versions`)
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error
    }
    throw new Error('The server is unavailable.', { cause: error })
  }

  if (response.status === 404) {
    throw new Error('This document could not be found.')
  }

  if (response.status === 401) {
    throw new SessionExpiredError()
  }

  if (!response.ok) {
    throw new Error('Versions could not be loaded.')
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload) || !payload.every(isDocumentVersionRecord)) {
    throw new Error('Versions could not be loaded.')
  }

  return payload
}

export async function getDocumentVersionFile(
  documentId: string,
  version: number,
): Promise<Uint8Array> {
  let response: Response
  try {
    response = await authorizedFetch(
      `${DOCUMENTS_URL}/${encodeURIComponent(documentId)}/versions/${version}/file`,
    )
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error
    }
    throw new Error('The server is unavailable.', { cause: error })
  }

  if (response.status === 404) {
    throw new Error('That version could not be opened.')
  }

  if (!response.ok) {
    throw new Error('That version could not be opened.')
  }

  return new Uint8Array(await response.arrayBuffer())
}

function isDocumentVersionRecord(value: unknown): value is DocumentVersionRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
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

function isDocumentListItem(value: unknown): value is DocumentListItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    'version' in value &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    'fileUrl' in value &&
    typeof value.fileUrl === 'string' &&
    value.fileUrl.length > 0 &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    value.createdAt.length > 0 &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'string' &&
    value.updatedAt.length > 0
  )
}
