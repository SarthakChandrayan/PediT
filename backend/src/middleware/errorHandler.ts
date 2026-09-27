import type { ErrorRequestHandler } from 'express'

const INTERNAL_ERROR = 'Something went wrong. Please try again later.'

/**
 * Last middleware in the app. Clients only ever receive a fixed { error } message; the raw error,
 * which can carry database, storage, or filesystem details, is logged server-side only.
 */
export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error)
    return
  }

  const clientStatus = clientErrorStatus(error)
  if (clientStatus !== null) {
    response.status(clientStatus).json({ error: clientErrorMessage(error, clientStatus) })
    return
  }

  console.error('Unhandled request error.', {
    method: request.method,
    path: request.path,
    error,
  })
  response.status(500).json({ error: INTERNAL_ERROR })
}

/** Only body-parser style errors that mark themselves safe to expose keep their 4xx status. */
function clientErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const { status, statusCode, expose } = error as {
    status?: unknown
    statusCode?: unknown
    expose?: unknown
  }
  const value = typeof status === 'number' ? status : statusCode
  if (expose !== true || typeof value !== 'number' || value < 400 || value > 499) {
    return null
  }

  return value
}

function clientErrorMessage(error: unknown, status: number): string {
  const type = (error as { type?: unknown }).type
  if (status === 413 || type === 'entity.too.large') {
    return 'The request body is too large.'
  }
  if (type === 'entity.parse.failed') {
    return 'The request body could not be parsed.'
  }

  return 'The request could not be processed.'
}
