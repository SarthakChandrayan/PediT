import { Prisma } from '@prisma/client'
import { Router, type ErrorRequestHandler, type RequestHandler } from 'express'
import multer from 'multer'
import { prisma } from '../lib/prisma.js'
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

export const documentsRouter = Router()

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

  const email = readEmail(request.body)
  if (!email) {
    await removeStoredFile(file.path)
    response.status(400).json({ error: 'A valid email is required.' })
    return
  }

  const fileUrl = storedFileUrl(file.filename)

  try {
    // The Neon driver does not start interactive transactions reliably, so
    // the user upsert and the document insert are separate statements.
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    })

    const document = await prisma.document.create({
      data: {
        name: displayFileName(file.originalname),
        userId: user.id,
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
      await removeStoredFile(file.path)
      response.status(500).json({ error: 'The document could not be saved.' })
      return
    }

    response.status(201).json({
      id: document.id,
      name: document.name,
      version: version.version,
      createdAt: document.createdAt,
      fileUrl: version.fileUrl,
    })
  } catch {
    await removeStoredFile(file.path)
    console.error('Document upload failed.')
    response.status(500).json({ error: 'The document could not be saved.' })
  }
}

async function createDocumentVersion(
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

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true },
  })
  if (!document) {
    await removeStoredFile(file.path)
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const fileUrl = storedFileUrl(file.filename)

  try {
    const saved = await insertNextVersion(documentId, fileUrl)
    response.status(201).json({
      id: saved.id,
      documentId: saved.documentId,
      version: saved.version,
      fileUrl: saved.fileUrl,
      createdAt: saved.createdAt,
    })
  } catch (error) {
    await removeStoredFile(file.path)
    if (prismaCode(error) === 'P2003') {
      response.status(404).json({ error: 'Document not found.' })
      return
    }
    console.error('Document version save failed.')
    response.status(500).json({ error: 'The version could not be saved.' })
  }
}

async function listVersions(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const documentId = routeId(request.params.documentId)
  if (!documentId) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
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
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const documentId = routeId(request.params.documentId)
  const versionNumber = routeVersion(request.params.version)
  if (!documentId || versionNumber === null) {
    response.status(404).json({ error: 'Document version not found.' })
    return
  }

  const version = await prisma.documentVersion.findUnique({
    where: {
      documentId_version: {
        documentId,
        version: versionNumber,
      },
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

  await pipeStoredPdf(response, version.fileUrl, version.document.name)
}

async function readDocument(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const id = routeId(request.params.id)
  if (!id) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  })
  const version = document?.versions[0]
  if (!document || !version) {
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
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): Promise<void> {
  const id = routeId(request.params.id)
  if (!id) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  })
  const version = document?.versions[0]
  if (!document || !version) {
    response.status(404).json({ error: 'Document not found.' })
    return
  }

  await pipeStoredPdf(response, version.fileUrl, document.name)
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

function readEmail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('email' in body)) {
    return null
  }

  const value = body.email
  if (typeof value !== 'string') {
    return null
  }

  const email = value.trim().toLowerCase()
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null
  }

  return email
}

function routeId(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/') || value.includes('\\')) {
    return null
  }

  return value
}

const VERSION_INSERT_ATTEMPTS = 8

/** Allocates max(version)+1. A unique conflict means another save won that number, so the insert is retried. */
async function insertNextVersion(documentId: string, fileUrl: string) {
  for (let attempt = 0; attempt < VERSION_INSERT_ATTEMPTS; attempt += 1) {
    const latest = await prisma.documentVersion.aggregate({
      where: { documentId },
      _max: { version: true },
    })
    const nextVersion = (latest._max.version ?? 0) + 1

    try {
      return await prisma.documentVersion.create({
        data: {
          documentId,
          version: nextVersion,
          fileUrl,
        },
      })
    } catch (error) {
      const retry = prismaCode(error) === 'P2002' && attempt < VERSION_INSERT_ATTEMPTS - 1
      if (!retry) {
        throw error
      }
    }
  }

  throw new Error('A version number could not be allocated.')
}

function prismaCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code
  }
  return null
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

documentsRouter.post('/', receivePdf, createDocument)
documentsRouter.post('/:documentId/versions', receivePdf, createDocumentVersion)
documentsRouter.get('/:documentId/versions/:version/file', sendVersionFile)
documentsRouter.get('/:documentId/versions', listVersions)
documentsRouter.get('/:id/file', sendDocumentFile)
documentsRouter.get('/:id', readDocument)
documentsRouter.use(handleUploadError)
