import { authorizedFetch, SessionExpiredError } from './accessToken.ts'
import { DOCUMENTS_URL } from './documents.ts'

export type UploadedDocument = {
  id: string
  version: number
  fileUrl: string
}

export async function uploadDocument(file: File): Promise<UploadedDocument> {
  const body = new FormData()
  body.append('file', file)

  let response: Response
  try {
    response = await authorizedFetch(DOCUMENTS_URL, {
      method: 'POST',
      body,
    })
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error
    }
    throw new Error('The server is unavailable. This PDF is still open locally.', { cause: error })
  }

  if (response.ok) {
    const payload: unknown = await response.json()
    if (!isUploadedDocument(payload)) {
      throw new Error('Saving this PDF to the server failed. It is still open locally.')
    }
    return payload
  }

  if (response.status === 413) {
    throw new Error(
      'This PDF is larger than 20 MB, so it was not saved on the server. It is still open locally.',
    )
  }

  throw new Error('Saving this PDF to the server failed. It is still open locally.')
}

function isUploadedDocument(value: unknown): value is UploadedDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'version' in value &&
    isPositiveInteger(value.version) &&
    'fileUrl' in value &&
    typeof value.fileUrl === 'string' &&
    value.fileUrl.length > 0
  )
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
