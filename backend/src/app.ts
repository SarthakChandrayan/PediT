import cors from 'cors'
import express, { type Express } from 'express'
import type { AuthIdentity } from './lib/authIdentity.js'
import type { DocumentsDb } from './lib/documentsDb.js'
import { documentsDb } from './lib/documentsDb.js'
import { r2PdfStorage, type PdfStorage } from './lib/pdfStorage.js'
import { prisma } from './lib/prisma.js'
import { trustProxySetting } from './lib/trustProxy.js'
import { verifyAuthorizationHeader } from './lib/verifyNeonToken.js'
import {
  documentRateLimiter,
  documentRateLimitsFromEnv,
  type DocumentRateLimits,
} from './middleware/rateLimit.js'
import { requireUser } from './middleware/requireUser.js'
import { createDocumentsRouter } from './routes/documents.js'

export type CreateAppOptions = {
  db?: DocumentsDb
  pdfStorage?: PdfStorage
  verifyAuthorization?: (header: string | undefined) => Promise<AuthIdentity | null>
  rateLimits?: DocumentRateLimits
  trustProxy?: number | false
}

export function createApp(options: CreateAppOptions = {}): Express {
  const db = options.db ?? documentsDb
  const pdfStorage = options.pdfStorage ?? r2PdfStorage
  const verifyAuthorization = options.verifyAuthorization ?? verifyAuthorizationHeader
  const rateLimits = options.rateLimits ?? documentRateLimitsFromEnv()
  const app = express()
  const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'

  app.set('trust proxy', options.trustProxy ?? trustProxySetting())

  app.use(
    cors({
      origin,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(
    '/api/documents',
    documentRateLimiter(rateLimits),
    requireUser(db, verifyAuthorization),
    createDocumentsRouter(db, pdfStorage),
  )

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/health/db', async (_request, response) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      response.json({ status: 'ok', database: 'connected' })
    } catch {
      console.error('Database health check failed.')
      response.status(500).json({
        status: 'error',
        database: 'unavailable',
      })
    }
  })

  return app
}
