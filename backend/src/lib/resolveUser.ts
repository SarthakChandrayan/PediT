import { Prisma } from '@prisma/client'
import type { ApplicationUser, AuthIdentity } from './authIdentity.js'
import type { DocumentsDb } from './documentsDb.js'

export async function resolveApplicationUser(
  db: DocumentsDb,
  identity: AuthIdentity,
): Promise<ApplicationUser> {
  const existing = await db.user.findUnique({
    where: { authUserId: identity.authUserId },
  })
  if (existing) {
    return syncEmail(db, existing, identity.email)
  }

  const claimed = await db.user.updateMany({
    where: { email: identity.email, authUserId: null },
    data: { authUserId: identity.authUserId },
  })
  if (claimed.count > 0) {
    const linked = await db.user.findUnique({
      where: { authUserId: identity.authUserId },
    })
    if (linked) {
      return linked
    }
  }

  try {
    return await db.user.create({
      data: {
        email: identity.email,
        authUserId: identity.authUserId,
      },
    })
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error
    }
    const winner = await db.user.findUnique({
      where: { authUserId: identity.authUserId },
    })
    if (winner) {
      return syncEmail(db, winner, identity.email)
    }
    const byEmail = await db.user.findUnique({ where: { email: identity.email } })
    if (byEmail?.authUserId === identity.authUserId) {
      return byEmail
    }
    throw error
  }
}

async function syncEmail(
  db: DocumentsDb,
  user: ApplicationUser,
  email: string,
): Promise<ApplicationUser> {
  if (user.email === email) {
    return user
  }
  try {
    return await db.user.update({
      where: { id: user.id },
      data: { email },
    })
  } catch (error) {
    if (isUniqueConflict(error)) {
      return user
    }
    throw error
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  ) || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
}
