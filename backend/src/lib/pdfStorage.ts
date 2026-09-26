import type { Readable } from 'node:stream'
import { deletePdf, getPdf, uploadPdf } from './r2.js'

export type PdfObject = {
  body: Readable
  contentLength?: number
}

export type PdfStorage = {
  uploadPdf(filePath: string, objectKey: string): Promise<void>
  deletePdf(objectKey: string): Promise<void>
  getPdf(objectKey: string): Promise<PdfObject>
}

/** Production PDF binary storage (Cloudflare R2). */
export const r2PdfStorage: PdfStorage = {
  uploadPdf,
  deletePdf,
  getPdf,
}
