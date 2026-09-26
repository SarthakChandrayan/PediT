import type { ApplicationUser } from './authIdentity.js'
import { prisma } from './prisma.js'

export type DocumentsDb = {
  user: {
    findUnique(args: {
      where: { authUserId: string } | { email: string } | { id: string }
    }): Promise<ApplicationUser | null>
    updateMany(args: {
      where: { email: string; authUserId: null }
      data: { authUserId: string }
    }): Promise<{ count: number }>
    create(args: { data: { email: string; authUserId: string } }): Promise<ApplicationUser>
    update(args: {
      where: { id: string }
      data: { email: string }
    }): Promise<ApplicationUser>
  }
  document: {
    create(args: {
      data: {
        name: string
        userId: string
        versions: { create: { version: number; fileUrl: string } }
      }
      include: { versions: true }
    }): Promise<{
      id: string
      name: string
      createdAt: Date
      versions: Array<{ version: number; fileUrl: string }>
    }>
    findMany(args: {
      where: { userId: string }
      orderBy: { createdAt: 'desc' }
      select: {
        id: true
        name: true
        createdAt: true
        versions: {
          orderBy: { version: 'desc' }
          take: 1
          select: {
            version: true
            createdAt: true
            fileUrl: true
          }
        }
      }
    }): Promise<
      Array<{
        id: string
        name: string
        createdAt: Date
        versions: Array<{ version: number; createdAt: Date; fileUrl: string }>
      }>
    >
    findFirst(args: {
      where: { id: string; userId: string }
      select?: { id: true } | {
        versions: {
          orderBy: { version: 'desc' }
          select: {
            id: true
            version: true
            fileUrl: true
            createdAt: true
          }
        }
      }
      include?: {
        versions: {
          orderBy: { version: 'desc' }
          take: 1
        }
      }
    }): Promise<{
      id: string
      name?: string
      createdAt?: Date
      versions?: Array<{
        id?: string
        version: number
        fileUrl: string
        createdAt?: Date
      }>
    } | null>
  }
  documentVersion: {
    findFirst(args: {
      where: {
        documentId: string
        version: number
        document: { userId: string }
      }
      include: { document: { select: { name: true } } }
    }): Promise<{
      fileUrl: string
      document: { name: string }
    } | null>
    aggregate(args: {
      where: { documentId: string }
      _max: { version: true }
    }): Promise<{ _max: { version: number | null } }>
    create(args: {
      data: { documentId: string; version: number; fileUrl: string }
    }): Promise<{
      id: string
      documentId: string
      version: number
      fileUrl: string
      createdAt: Date
    }>
  }
}

export const documentsDb = prisma as unknown as DocumentsDb
