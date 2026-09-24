import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import express from 'express'
import multer from 'multer'
import {
  DOCUMENTS_DIRECTORY,
  ensureDocumentsDirectory,
  fileHasPdfMagic,
  hasPdfMagic,
  maxPdfBytes,
  removeStoredFile,
  storedFileUrl,
  storedPdfName,
  uploadedPdfRejection,
} from '../src/lib/documentStorage.js'
import { pipeStoredPdf } from '../src/lib/pdfResponse.js'

const PDF_MIME_TYPE = 'application/pdf'
const createdFiles: string[] = []

after(async () => {
  await Promise.all(createdFiles.map((filePath) => removeStoredFile(filePath)))
})

describe('missing stored PDF', () => {
  it('returns 404, stays alive, and still serves /health', async () => {
    const app = express()
    app.get('/health', (_request, response) => {
      response.json({ status: 'ok' })
    })
    app.get('/api/documents/:documentId/versions/:version/file', async (_request, response) => {
      await pipeStoredPdf(response, `documents/${storedPdfName()}`, 'missing.pdf')
    })

    const { baseUrl, close } = await listen(app)
    const failures: unknown[] = []
    const onFailure = (error: unknown) => {
      failures.push(error)
    }
    process.once('uncaughtException', onFailure)
    process.once('unhandledRejection', onFailure)
    try {
      const missing = await fetch(`${baseUrl}/api/documents/doc-1/versions/1/file`)
      assert.equal(missing.status, 404)
      const body = (await missing.json()) as { error?: string }
      assert.equal(body.error, 'Stored PDF not found.')
      const serialized = JSON.stringify(body)
      assert.equal(serialized.includes(path.sep), false)
      assert.equal(serialized.includes('storage'), false)

      const health = await fetch(`${baseUrl}/health`)
      assert.equal(health.status, 200)
      assert.deepEqual(await health.json(), { status: 'ok' })
      assert.equal(failures.length, 0)
    } finally {
      process.off('uncaughtException', onFailure)
      process.off('unhandledRejection', onFailure)
      await close()
    }
  })

  it('still streams a PDF that exists', async () => {
    await ensureDocumentsDirectory()
    const filename = storedPdfName()
    const filePath = path.join(DOCUMENTS_DIRECTORY, filename)
    const bytes = Buffer.from('%PDF-1.4\n% stored file stream fixture\n')
    await writeFile(filePath, bytes)
    createdFiles.push(filePath)

    const app = express()
    app.get('/api/documents/:documentId/versions/:version/file', async (_request, response) => {
      await pipeStoredPdf(response, storedFileUrl(filename), 'fixture.pdf')
    })

    const { baseUrl, close } = await listen(app)
    try {
      const response = await fetch(`${baseUrl}/api/documents/doc-1/versions/1/file`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), PDF_MIME_TYPE)
      const body = Buffer.from(await response.arrayBuffer())
      assert.deepEqual(body, bytes)
    } finally {
      await close()
    }
  })
})

describe('PDF magic header validation', () => {
  it('accepts a file that starts with %PDF- and rejects a spoofed PDF', async () => {
    await ensureDocumentsDirectory()
    const validName = storedPdfName()
    const spoofName = storedPdfName()
    const validPath = path.join(DOCUMENTS_DIRECTORY, validName)
    const spoofPath = path.join(DOCUMENTS_DIRECTORY, spoofName)
    const validBytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')
    const spoofBytes = Buffer.from('not a pdf')
    await writeFile(validPath, validBytes)
    await writeFile(spoofPath, spoofBytes)
    createdFiles.push(validPath, spoofPath)

    assert.equal(hasPdfMagic(validBytes), true)
    assert.equal(hasPdfMagic(spoofBytes), false)
    assert.equal(await fileHasPdfMagic(validPath), true)
    assert.equal(await fileHasPdfMagic(spoofPath), false)

    assert.equal(
      await uploadedPdfRejection({
        size: validBytes.byteLength,
        originalname: 'valid.pdf',
        mimetype: PDF_MIME_TYPE,
        path: validPath,
      }),
      null,
    )
    assert.equal(
      await uploadedPdfRejection({
        size: spoofBytes.byteLength,
        originalname: 'spoof.pdf',
        mimetype: PDF_MIME_TYPE,
        path: spoofPath,
      }),
      'Only PDF files can be uploaded.',
    )

    const app = uploadApp()
    const { baseUrl, close } = await listen(app)
    try {
      const accepted = await postPdf(baseUrl, 'valid.pdf', validBytes)
      assert.equal(accepted.status, 201)

      const rejected = await postPdf(baseUrl, 'spoof.pdf', spoofBytes)
      assert.equal(rejected.status, 400)
      assert.deepEqual(await rejected.json(), { error: 'Only PDF files can be uploaded.' })
    } finally {
      await close()
    }
  })

  it('keeps the existing 20 MB limit', () => {
    assert.equal(maxPdfBytes(), 20 * 1024 * 1024)
  })
})

function uploadApp() {
  const app = express()
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        callback(null, DOCUMENTS_DIRECTORY)
      },
      filename: (_request, _file, callback) => {
        callback(null, storedPdfName())
      },
    }),
    limits: {
      fileSize: maxPdfBytes(),
      files: 1,
    },
  })

  app.post('/api/documents', (request, response, next) => {
    void ensureDocumentsDirectory()
      .then(() => {
        upload.single('file')(request, response, (error) => {
          if (error) {
            next(error)
            return
          }
          next()
        })
      })
      .catch(next)
  }, async (request, response) => {
    const file = request.file
    if (!file) {
      response.status(400).json({ error: 'A PDF file is required.' })
      return
    }
    createdFiles.push(file.path)
    const rejection = await uploadedPdfRejection(file)
    if (rejection) {
      await removeStoredFile(file.path)
      response.status(400).json({ error: rejection })
      return
    }
    response.status(201).json({ accepted: true })
  })

  return app
}

async function postPdf(baseUrl: string, filename: string, bytes: Buffer): Promise<Response> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const form = new FormData()
  form.append('file', new Blob([copy], { type: PDF_MIME_TYPE }), filename)
  form.append('email', 'audit@example.com')
  return fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    body: form,
  })
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('The test server did not bind a port.')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}
