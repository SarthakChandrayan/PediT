import { Router, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'

export type DocumentRateLimits = {
  windowMs: number
  uploadLimit: number
  versionLimit: number
  readLimit: number
}

const RATE_LIMITED_BODY = { error: 'Too many requests. Please try again later.' }

export function documentRateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): DocumentRateLimits {
  return {
    windowMs: readPositiveInteger(env, 'RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    uploadLimit: readPositiveInteger(env, 'RATE_LIMIT_UPLOAD_MAX', 10),
    versionLimit: readPositiveInteger(env, 'RATE_LIMIT_VERSION_MAX', 20),
    readLimit: readPositiveInteger(env, 'RATE_LIMIT_READ_MAX', 300),
  }
}

/**
 * Keys every bucket on req.ip, so it must be mounted before authentication and upload parsing.
 * Upload and version creation have their own buckets; every other document request shares the read bucket.
 */
export function documentRateLimiter(limits: DocumentRateLimits): Router {
  const router = Router()
  router.post('/', limiter(limits.windowMs, limits.uploadLimit), leaveRouter)
  router.post('/:documentId/versions', limiter(limits.windowMs, limits.versionLimit), leaveRouter)
  router.use(limiter(limits.windowMs, limits.readLimit))
  return router
}

const leaveRouter: RequestHandler = (_request, _response, next) => {
  next('router')
}

function limiter(windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: RATE_LIMITED_BODY,
  })
}

function readPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name]?.trim()
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}
