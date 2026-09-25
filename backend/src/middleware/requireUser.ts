import type { RequestHandler } from 'express'
import type { ApplicationUser, AuthIdentity } from '../lib/authIdentity.js'
import type { DocumentsDb } from '../lib/documentsDb.js'
import { resolveApplicationUser } from '../lib/resolveUser.js'

export type RequestUser = ApplicationUser & { authUserId: string }

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser
    }
  }
}

export function requireUser(
  db: DocumentsDb,
  verifyAuthorization: (header: string | undefined) => Promise<AuthIdentity | null>,
): RequestHandler {
  return (request, response, next) => {
    void verifyAuthorization(request.header('authorization'))
      .then(async (identity) => {
        if (!identity) {
          response.status(401).json({ error: 'Authentication is required.' })
          return
        }
        const user = await resolveApplicationUser(db, identity)
        if (!user.authUserId) {
          response.status(401).json({ error: 'Authentication is required.' })
          return
        }
        request.user = { ...user, authUserId: user.authUserId }
        next()
      })
      .catch((error: unknown) => {
        next(error)
      })
  }
}
