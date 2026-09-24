export const DOCUMENTS_URL = 'http://localhost:8000/api/documents'

export type DocumentVersionRecord = {
  id: string
  version: number
  fileUrl: string
  createdAt: string
}

export async function getDocumentVersions(
  documentId: string,
): Promise<DocumentVersionRecord[]> {
  let response: Response
  try {
    response = await fetch(`${DOCUMENTS_URL}/${encodeURIComponent(documentId)}/versions`)
  } catch {
    throw new Error('The server is unavailable.')
  }

  if (response.status === 404) {
    throw new Error('This document could not be found.')
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
    response = await fetch(
      `${DOCUMENTS_URL}/${encodeURIComponent(documentId)}/versions/${version}/file`,
    )
  } catch {
    throw new Error('The server is unavailable.')
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
