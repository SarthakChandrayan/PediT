import type { Response } from 'express'
import { r2PdfStorage, type PdfStorage } from './pdfStorage.js'

const PDF_MIME_TYPE = 'application/pdf'

export async function pipeStoredPdf(
  response: Response,
  fileUrl: string,
  downloadName: string,
  storage: PdfStorage = r2PdfStorage,
): Promise<void> {
  try {
    const { body, contentLength } = await storage.getPdf(fileUrl)

    if (response.writableEnded) {
      body.destroy()
      return
    }

    response.setHeader('Content-Type', PDF_MIME_TYPE)

    if (contentLength !== undefined) {
      response.setHeader('Content-Length', contentLength)
    }

    response.setHeader(
      'Content-Disposition',
      contentDisposition(downloadName),
    )

    body.on('error', () => {
      if (!response.headersSent) {
        response.status(500).json({
          error: 'The stored PDF could not be read.',
        })
        return
      }

      if (!response.destroyed) {
        response.destroy()
      }
    })

    body.pipe(response)
  } catch (error) {
    if (isMissingObject(error)) {
      sendMissingPdf(response)
      return
    }

    console.error('R2 PDF read failed.')

    if (!response.headersSent) {
      response.status(500).json({
        error: 'The stored PDF could not be read.',
      })
    }
  }
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const value = error as {
    name?: string
    $metadata?: {
      httpStatusCode?: number
    }
  }

  return (
    value.name === 'NoSuchKey' ||
    value.$metadata?.httpStatusCode === 404
  )
}

function sendMissingPdf(response: Response): void {
  if (response.headersSent || response.writableEnded) {
    if (!response.destroyed) {
      response.destroy()
    }
    return
  }

  response.status(404).json({ error: 'Stored PDF not found.' })
}

function contentDisposition(name: string): string {
  const cleaned = name.replace(/["\r\n]/g, '')
  return `inline; filename="${cleaned}"`
}
