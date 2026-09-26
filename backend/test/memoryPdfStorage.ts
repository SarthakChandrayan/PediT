import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { PdfStorage } from '../src/lib/pdfStorage.js'

/** In-memory PDF store for tests — no R2 network or credentials. */
export function createMemoryPdfStorage(): PdfStorage {
  const objects = new Map<string, Buffer>()

  return {
    async uploadPdf(filePath, objectKey) {
      objects.set(objectKey, await readFile(filePath))
    },
    async deletePdf(objectKey) {
      objects.delete(objectKey)
    },
    async getPdf(objectKey) {
      const data = objects.get(objectKey)
      if (!data) {
        const error = new Error('The specified key does not exist.') as Error & {
          name: string
          $metadata: { httpStatusCode: number }
        }
        error.name = 'NoSuchKey'
        error.$metadata = { httpStatusCode: 404 }
        throw error
      }

      return {
        body: Readable.from(data),
        contentLength: data.byteLength,
      }
    },
  }
}
