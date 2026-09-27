/**
 * One-time backfill for DocumentVersion.sizeBytes.
 *
 * For every version it reads the stored PDF's byte size from R2 object metadata (HeadObject, so the
 * PDF body is never downloaded) and writes it to sizeBytes. R2 is only ever read. Versions whose
 * object is missing are left unchanged and reported. Re-running refreshes every size again.
 *
 * Run from backend/ after `npx prisma migrate deploy`:
 *   npm run backfill:sizes -- --dry-run   report what would change, write nothing
 *   npm run backfill:sizes                write the sizes
 */
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'

const PAGE_SIZE = 100
const CONCURRENCY = 8

type Version = { id: string; documentId: string; fileUrl: string; sizeBytes: bigint }
type Problem = { versionId: string; documentId: string; key: string; reason?: string }

const dryRun = process.argv.includes('--dry-run')

const summary = {
  checked: 0,
  updated: 0,
  unchanged: 0,
  deletedDuringRun: 0,
  missing: [] as Problem[],
  failed: [] as Problem[],
}

async function main(): Promise<void> {
  const { client, bucket } = r2ClientFromEnv()
  console.log(`Database host: ${databaseHost()}`)
  console.log(`R2 bucket:     ${bucket}`)
  console.log(dryRun ? 'Mode:          dry run (no database writes)\n' : 'Mode:          write\n')

  try {
    let cursor: string | undefined
    for (;;) {
      const page: Version[] = await prisma.documentVersion.findMany({
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, documentId: true, fileUrl: true, sizeBytes: true },
      })
      if (page.length === 0) {
        break
      }
      await forEachLimited(page, CONCURRENCY, (version) => backfill(client, bucket, version))
      cursor = page[page.length - 1]!.id
    }
  } finally {
    client.destroy()
  }

  printSummary()
  if (summary.failed.length > 0) {
    process.exitCode = 1
  }
}

async function backfill(client: S3Client, bucket: string, version: Version): Promise<void> {
  summary.checked += 1
  const problem = { versionId: version.id, documentId: version.documentId, key: version.fileUrl }

  let size: bigint
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: version.fileUrl }))
    if (typeof head.ContentLength !== 'number') {
      throw new Error('R2 returned no ContentLength.')
    }
    size = BigInt(head.ContentLength)
  } catch (error) {
    if (isMissingObject(error)) {
      summary.missing.push(problem)
    } else {
      summary.failed.push({ ...problem, reason: describe(error) })
    }
    return
  }

  if (size === version.sizeBytes) {
    summary.unchanged += 1
    return
  }

  const change = `${version.id}  ${version.fileUrl}  ${version.sizeBytes} -> ${size}`
  if (dryRun) {
    summary.updated += 1
    console.log(`would update ${change}`)
    return
  }

  try {
    const result = await prisma.documentVersion.updateMany({
      where: { id: version.id, fileUrl: version.fileUrl },
      data: { sizeBytes: size },
    })
    if (result.count === 0) {
      summary.deletedDuringRun += 1
      return
    }
    summary.updated += 1
    console.log(`updated ${change}`)
  } catch (error) {
    summary.failed.push({ ...problem, reason: describe(error) })
  }
}

function printSummary(): void {
  console.log('\nSummary')
  console.log(`  versions checked:           ${summary.checked}`)
  console.log(`  ${dryRun ? 'would update' : 'updated'}:               ${summary.updated}`)
  console.log(`  already correct:            ${summary.unchanged}`)
  console.log(`  deleted while running:      ${summary.deletedDuringRun}`)
  console.log(`  missing R2 object:          ${summary.missing.length}`)
  console.log(`  failed:                     ${summary.failed.length}`)

  if (summary.missing.length > 0) {
    console.log('\nMissing R2 objects (sizeBytes left unchanged):')
    for (const item of summary.missing) {
      console.log(`  version ${item.versionId}  document ${item.documentId}  ${item.key}`)
    }
  }
  if (summary.failed.length > 0) {
    console.log('\nFailures (sizeBytes left unchanged; safe to re-run):')
    for (const item of summary.failed) {
      console.log(`  version ${item.versionId}  document ${item.documentId}  ${item.key}  ${item.reason}`)
    }
  }
}

function r2ClientFromEnv(): { client: S3Client; bucket: string } {
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2 configuration is missing. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.',
    )
  }
  return {
    client: new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } }),
    bucket,
  }
}

function databaseHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').host || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** HeadObject has no body, so a missing key surfaces as NotFound / HTTP 404 rather than NoSuchKey. */
function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return value.name === 'NotFound' || value.name === 'NoSuchKey' || value.$metadata?.httpStatusCode === 404
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

async function forEachLimited<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!
      next += 1
      await run(item)
    }
  })
  await Promise.all(workers)
}

main()
  .catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
      console.error('DocumentVersion.sizeBytes does not exist yet. Run `npx prisma migrate deploy` first.')
    } else {
      console.error('Backfill stopped:', describe(error))
    }
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
