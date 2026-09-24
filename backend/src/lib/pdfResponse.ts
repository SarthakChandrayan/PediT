import { createReadStream } from 'node:fs'
import type { Response } from 'express'
import { storedPdfInfo } from './documentStorage.js'

const PDF_MIME_TYPE = 'application/pdf'

export async function pipeStoredPdf(
  response: Response,
  fileUrl: string,
  downloadName: string,
): Promise<void> {
  const info = await storedPdfInfo(fileUrl)
  if (!info) {
    sendMissingPdf(response)
    return
  }

  const stream = createReadStream(info.absolutePath)
  let piping = false

  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (!piping || !response.headersSent) {
      if (error.code === 'ENOENT') {
        sendMissingPdf(response)
        return
      }
      if (!response.headersSent) {
        response.status(500).json({ error: 'The stored PDF could not be read.' })
      }
      return
    }

    if (!response.destroyed) {
      response.destroy()
    }
  })

  if (response.writableEnded) {
    stream.destroy()
    return
  }

  response.setHeader('Content-Type', PDF_MIME_TYPE)
  response.setHeader('Content-Length', info.size)
  response.setHeader('Content-Disposition', contentDisposition(downloadName))
  piping = true
  stream.pipe(response)
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
