import { Prisma } from '@prisma/client'
import { Router, type ErrorRequestHandler, type RequestHandler } from 'express'
import multer from 'multer'
import type { DocumentsDb } from '../lib/documentsDb.js'
import { documentsDb } from '../lib/documentsDb.js'
import {
  DOCUMENTS_DIRECTORY,
  displayFileName,
  ensureDocumentsDirectory,
  maxPdfBytes,
  removeStoredFile,
  storedFileUrl,
  storedPdfName,
  uploadedPdfRejection,
} from '../lib/documentStorage.js'
import { pipeStoredPdf } from '../lib/pdfResponse.js'
import { r2PdfStorage, type PdfStorage } from '../lib/pdfStorage.js'

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

export function createDocumentsRouter(
  db: DocumentsDb = documentsDb,
  storage: PdfStorage = r2PdfStorage,
): Router {
  const router = Router()
  router.post('/', receivePdf, (request, response) => {
    void createDocument(db, storage, request, response)
  })
  router.post('/:documentId/versions', receivePdf, (request, response) => {
    void createDocumentVersion(db, storage, request, response)
  })
  router.get('/:documentId/versions/:version/file', (request, response) => {
    void sendVersionFile(db, storage, request, response)
  })
  router.get('/:documentId/versions', (request, response) => {
    void listVersions(db, request, response)
  })
  router.get('/:id/file', (request, response) => {
    void sendDocumentFile(db, storage, request, response)
  })
  router.get('/:id', (request, response) => {
    void readDocument(db, request, response)
  })
  router.use(handleUploadError)
  return router
}

const receivePdf: RequestHandler = (request, response, next) => {
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
}

async function createDocument(
  db: DocumentsDb,
  storage: PdfStorage,
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const file = request.file
  if (!file) {
    response.status(400).json({ error: 'A PDF file is required.' })
    return
  }

  const rejection = await uploadedPdfRejection(file)
  if (rejection) {
    await removeStoredFile(file.path)
    response.status(400).json({ error: rejection })
    return
  }

  const ownerId = request.user?.id
  if (!ownerId) {
    await removeStoredFile(file.path)
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  const fileUrl = storedFileUrl(file.filename)

  try {
    await storage.uploadPdf(file.path, fileUrl)

    const document = await db.document.create({
      data: {
        name: displayFileName(file.originalname),
        userId: ownerId,
        versions: {
          create: {
            version: 1,
            fileUrl,
          },
        },
      },
      include: {
        versions: true,
      },
    })

    const version = document.versions[0]
    if (!version) {
      await storage.deletePdf(fileUrl).catch(() => undefined)
      await removeStoredFile(file.path)
      response.status(500).json({ error: 'The document could not be saved.' })
      return
    }

    await removeStoredFile(file.path)

    response.status(201).json({
      id: document.id,
      name: document.name,
      version: version.version,
      createdAt: document.createdAt,
      fileUrl: version.fileUrl,
    })
  } catch {
    await storage.deletePdf(fileUrl).catch(() => undefined)
    await removeStoredFile(file.path)

    console.error('Document upload failed.')
    response.status(500).json({ error: 'The document could not be saved.' })
  }
}

async function createDocumentVersion(
  db: DocumentsDb,
  storage: PdfStorage,
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const documentId = routeId(request.params.documentId)
  const file = request.file
  if (!documentId) {
    if (file) {
      await removeStoredFile(file.path)
    }
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  if (!file) {
    response.status(400).json({ error: 'A PDF file is required.' })
    return
  }

  const rejection = await uploadedPdfRejection(file)
  if (rejection) {
    await removeStoredFile(file.path)
    response.status(400).json({ error: rejection })
    return
  }

  const ownerId = request.user?.id
  if (!ownerId) {
    await removeStoredFile(file.path)
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  const document = await db.document.findFirst({
    where: { id: documentId, userId: ownerId },
    select: { id: true },
  })
  if (!document) {
    await removeStoredFile(file.path)
    response.status(404).json({ error: 'Document not found.' })
    return
  }
  const fileUrl = storedFileUrl(file.filename)

  try {
    await storage.uploadPdf(file.path, fileUrl)

    const saved = await insertNextVersion(db, documentId, fileUrl)
    await removeStoredFile(file.path)

    response.status(201).json({
      id: saved.id,
      documentId: saved.documentId,
      version: saved.version,
      fileUrl: saved.fileUrl,
      createdAt: saved.createdAt,
    })
  } catch (error) {
    await storage.deletePdf(fileUrl).catch(() => undefined)
    await removeStoredFile(file.path)

    if (isPrismaCode(error, 'P2003')) {
      response.status(404).json({ error: 'Document not found.' })
      return
    }
    console.error('Document version save failed.')
    response.status(500).json({ error: 'The version could not be saved.' })
  }
}

async function listVersions(
  db: DocumentsDb,
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const documentId = routeId(request.params.documentId)
  if (!documentId) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const ownerId = request.user?.id
  if (!ownerId) {
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  const document = await db.document.findFirst({
    where: { id: documentId, userId: ownerId },
    select: {
      versions: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          fileUrl: true,
          createdAt: true,
        },
      },
    },
  })
  if (!document) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  response.json(document.versions)
}

async function sendVersionFile(
  db: DocumentsDb,
  storage: PdfStorage,
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const documentId = routeId(request.params.documentId)
  const versionNumber = routeVersion(request.params.version)
  if (!documentId || versionNumber === null) {
    response.status(404).json({ error: 'Document version not found.' })
    return
  }

  const ownerId = request.user?.id
  if (!ownerId) {
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  const version = await db.documentVersion.findFirst({
    where: {
      documentId,
      version: versionNumber,
      document: { userId: ownerId },
    },
    include: {
      document: {
        select: { name: true },
      },
    },
  })
  if (!version) {
    response.status(404).json({ error: 'Document version not found.' })
    return
  }

  await pipeStoredPdf(response, version.fileUrl, version.document.name, storage)
}

async function readDocument(
  db: DocumentsDb,
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const id = routeId(request.params.id)
  if (!id) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const ownerId = request.user?.id
  if (!ownerId) {
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  const document = await db.document.findFirst({
    where: { id, userId: ownerId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  })
  const version = document?.versions?.[0]
  if (!document || !version || !document.name || !document.createdAt) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  response.json({
    id: document.id,
    name: document.name,
    version: version.version,
    createdAt: document.createdAt,
    fileUrl: version.fileUrl,
  })
}

async function sendDocumentFile(
  db: DocumentsDb,
  storage: PdfStorage,
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const id = routeId(request.params.id)
  if (!id) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const ownerId = request.user?.id
  if (!ownerId) {
    response.status(401).json({ error: 'Authentication is required.' })
    return
  }

  const document = await db.document.findFirst({
    where: { id, userId: ownerId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  })
  const version = document?.versions?.[0]
  if (!document || !version || !document.name) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  await pipeStoredPdf(response, version.fileUrl, document.name, storage)
}

const handleUploadError: ErrorRequestHandler = (error, request, response, next) => {
  void removeStoredFile(request.file?.path ?? '')

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'PDF files must be 20 MB or smaller.' })
      return
    }

    response.status(400).json({ error: 'Upload one PDF file.' })
    return
  }

  next(error)
}

function routeId(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/') || value.includes('\\')) {
    return null
  }

  return value
}

const VERSION_INSERT_ATTEMPTS = 8

/** Allocates max(version)+1. A unique conflict means another save won that number, so the insert is retried. */
async function insertNextVersion(db: DocumentsDb, documentId: string, fileUrl: string) {
  for (let attempt = 0; attempt < VERSION_INSERT_ATTEMPTS; attempt += 1) {
    const latest = await db.documentVersion.aggregate({
      where: { documentId },
      _max: { version: true },
    })
    const nextVersion = (latest._max.version ?? 0) + 1

    try {
      return await db.documentVersion.create({
        data: {
          documentId,
          version: nextVersion,
          fileUrl,
        },
      })
    } catch (error) {
      const retry = isPrismaCode(error, 'P2002') && attempt < VERSION_INSERT_ATTEMPTS - 1
      if (!retry) {
        throw error
      }
    }
  }

  throw new Error('A version number could not be allocated.')
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

function routeVersion(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) {
    return null
  }

  const version = Number(value)
  if (!Number.isSafeInteger(version) || version > 2_147_483_647) {
    return null
  }

  return version
}

export const documentsRouter = createDocumentsRouter()

