import type { DocumentsDb, DocumentsTx } from './documentsDb.js'

export const MAX_DOCUMENTS_PER_USER = 50
export const MAX_VERSIONS_PER_DOCUMENT = 50
export const MAX_STORAGE_BYTES_PER_USER = 2n * 1024n * 1024n * 1024n

/** Above the per-user limits, so list responses are bounded without ever being truncated. */
export const LIST_LIMIT = 100

const DOCUMENT_LIMIT_MESSAGE = `You can store up to ${MAX_DOCUMENTS_PER_USER} documents. Delete a document to upload another.`
const VERSION_LIMIT_MESSAGE = `A document can have up to ${MAX_VERSIONS_PER_DOCUMENT} versions.`
const STORAGE_LIMIT_MESSAGE =
  'This upload would exceed your 2 GB storage limit. Delete documents to free up space.'

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

type QuotaReader = Pick<DocumentsDb, 'document' | 'documentVersion'>

export async function documentQuotaRejection(
  db: QuotaReader,
  userId: string,
  sizeBytes: number,
): Promise<string | null> {
  const documents = await db.document.count({ where: { userId } })
  if (documents >= MAX_DOCUMENTS_PER_USER) {
    return DOCUMENT_LIMIT_MESSAGE
  }
  return storageQuotaRejection(db, userId, sizeBytes)
}

export async function versionQuotaRejection(
  db: QuotaReader,
  userId: string,
  documentId: string,
  sizeBytes: number,
): Promise<string | null> {
  const versions = await db.documentVersion.count({ where: { documentId } })
  if (versions >= MAX_VERSIONS_PER_DOCUMENT) {
    return VERSION_LIMIT_MESSAGE
  }
  return storageQuotaRejection(db, userId, sizeBytes)
}

/** Every version has its own stored object, so usage is the sum over all of the user's versions. */
async function storageQuotaRejection(
  db: QuotaReader,
  userId: string,
  sizeBytes: number,
): Promise<string | null> {
  const usage = await db.documentVersion.aggregate({
    where: { document: { userId } },
    _sum: { sizeBytes: true },
  })
  const used = usage._sum?.sizeBytes ?? 0n
  return used + BigInt(sizeBytes) > MAX_STORAGE_BYTES_PER_USER ? STORAGE_LIMIT_MESSAGE : null
}

/**
 * Locks the user's row until the transaction ends. Every quota-counted insert takes this lock
 * first and re-checks the quota under it, so concurrent uploads by one user commit one at a time
 * and the last check before each insert sees every earlier commit.
 */
export async function lockUserQuota(tx: DocumentsTx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}

export async function assertDocumentQuota(
  tx: DocumentsTx,
  userId: string,
  sizeBytes: number,
): Promise<void> {
  const rejection = await documentQuotaRejection(tx, userId, sizeBytes)
  if (rejection) {
    throw new QuotaExceededError(rejection)
  }
}

export async function assertVersionQuota(
  tx: DocumentsTx,
  userId: string,
  documentId: string,
  sizeBytes: number,
): Promise<void> {
  const rejection = await versionQuotaRejection(tx, userId, documentId, sizeBytes)
  if (rejection) {
    throw new QuotaExceededError(rejection)
  }
}
