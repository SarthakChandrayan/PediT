import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { Express } from 'express'
import { createApp, type CreateAppOptions } from '../src/app.js'
import type { ApplicationUser, AuthIdentity } from '../src/lib/authIdentity.js'
import type { DocumentsDb } from '../src/lib/documentsDb.js'
import { resolveApplicationUser } from '../src/lib/resolveUser.js'
import {
  DOCUMENTS_DIRECTORY,
  removeStoredFile,
  resolveStoredFile,
} from '../src/lib/documentStorage.js'
import type { PdfStorage } from '../src/lib/pdfStorage.js'
import {
  LIST_LIMIT,
  MAX_DOCUMENTS_PER_USER,
  MAX_STORAGE_BYTES_PER_USER,
  MAX_VERSIONS_PER_DOCUMENT,
} from '../src/lib/storageQuota.js'
import { trustProxySetting } from '../src/lib/trustProxy.js'
import { documentRateLimitsFromEnv, type DocumentRateLimits } from '../src/middleware/rateLimit.js'
import { createMemoryPdfStorage } from './memoryPdfStorage.js'

const PDF_MIME_TYPE = 'application/pdf'
const RATE_LIMITED = { error: 'Too many requests. Please try again later.' }
const createdFiles: string[] = []

const USER_A: AuthIdentity = { authUserId: 'auth-user-a', email: 'owner-a@example.com' }
const USER_B: AuthIdentity = { authUserId: 'auth-user-b', email: 'owner-b@example.com' }

after(async () => {
  await Promise.all(createdFiles.map((filePath) => removeStoredFile(filePath)))
})

describe('document authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const { baseUrl, close } = await listen(appFor({}))
    try {
      const response = await fetch(`${baseUrl}/api/documents`, { method: 'POST' })
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Authentication is required.' })
    } finally {
      await close()
    }
  })

  it('lets a user create, read, version, and download only their own document', async () => {
    const db = memoryDb()
    const { baseUrl, close } = await listen(appFor(db))
    try {
      const spoofed = await postPdf(baseUrl, 'a', 'owned.pdf', pdfBytes('owned'), {
        email: USER_B.email,
        userId: 'client-supplied-user',
      })
      assert.equal(spoofed.status, 400)
      assert.deepEqual(await spoofed.json(), { error: 'Upload one PDF file.' })
      assert.equal(db.documents.length, 0)

      const created = await postPdf(baseUrl, 'a', 'owned.pdf', pdfBytes('owned'))
      assert.equal(created.status, 201)
      const document = (await created.json()) as { id: string; version: number }
      assert.equal(document.version, 1)
      const owner = db.users.find((user) => user.authUserId === USER_A.authUserId)
      const row = db.documents.find((item) => item.id === document.id)
      assert.ok(owner)
      assert.equal(row?.userId, owner.id)
      assert.equal(db.users.some((user) => user.email === USER_B.email), false)

      const read = await fetch(`${baseUrl}/api/documents/${document.id}`, {
        headers: auth('a'),
      })
      assert.equal(read.status, 200)
      const readBody = (await read.json()) as { id: string; version: number }
      assert.equal(readBody.id, document.id)
      assert.equal(readBody.version, 1)

      const file = await fetch(`${baseUrl}/api/documents/${document.id}/file`, {
        headers: auth('a'),
      })
      assert.equal(file.status, 200)
      assert.equal(file.headers.get('content-type'), PDF_MIME_TYPE)
      const fileBytes = Buffer.from(await file.arrayBuffer())
      assert.equal(fileBytes.subarray(0, 5).toString(), '%PDF-')

      const saved = await postPdf(baseUrl, 'a', 'edited.pdf', pdfBytes('edited'), undefined, document.id)
      assert.equal(saved.status, 201)
      const version = (await saved.json()) as { version: number }
      assert.equal(version.version, 2)

      const versions = await fetch(`${baseUrl}/api/documents/${document.id}/versions`, {
        headers: auth('a'),
      })
      assert.equal(versions.status, 200)
      const listed = (await versions.json()) as Array<{ version: number }>
      assert.deepEqual(listed.map((item) => item.version), [2, 1])

      const versionFile = await fetch(`${baseUrl}/api/documents/${document.id}/versions/2/file`, {
        headers: auth('a'),
      })
      assert.equal(versionFile.status, 200)
      const versionBytes = Buffer.from(await versionFile.arrayBuffer())
      assert.equal(versionBytes.includes(Buffer.from('edited')), true)

      const deniedRead = await fetch(`${baseUrl}/api/documents/${document.id}`, {
        headers: auth('b'),
      })
      assert.equal(deniedRead.status, 404)
      assert.deepEqual(await deniedRead.json(), { error: 'Document not found.' })

      const deniedFile = await fetch(`${baseUrl}/api/documents/${document.id}/file`, {
        headers: auth('b'),
      })
      assert.equal(deniedFile.status, 404)

      const deniedVersion = await postPdf(
        baseUrl,
        'b',
        'intruder.pdf',
        pdfBytes('intruder'),
        undefined,
        document.id,
      )
      assert.equal(deniedVersion.status, 404)
      assert.equal(db.documents.find((item) => item.id === document.id)?.versions.length, 2)

      const deniedList = await fetch(`${baseUrl}/api/documents/${document.id}/versions`, {
        headers: auth('b'),
      })
      assert.equal(deniedList.status, 404)

      const deniedVersionFile = await fetch(
        `${baseUrl}/api/documents/${document.id}/versions/1/file`,
        { headers: auth('b') },
      )
      assert.equal(deniedVersionFile.status, 404)
    } finally {
      remember(db)
      await close()
    }
  })

  it('still rejects a file that is not a PDF', async () => {
    const { baseUrl, close } = await listen(appFor(memoryDb()))
    try {
      const rejected = await postPdf(baseUrl, 'a', 'spoof.pdf', Buffer.from('not a pdf'))
      assert.equal(rejected.status, 400)
      assert.deepEqual(await rejected.json(), { error: 'Only PDF files can be uploaded.' })
    } finally {
      await close()
    }
  })

  it('lists only the authenticated user documents', async () => {
    const db = memoryDb()
    const { baseUrl, close } = await listen(appFor(db))
    try {
      const first = await postPdf(baseUrl, 'a', 'alpha.pdf', pdfBytes('alpha'))
      assert.equal(first.status, 201)
      const firstBody = (await first.json()) as { id: string }

      const second = await postPdf(baseUrl, 'a', 'beta.pdf', pdfBytes('beta'))
      assert.equal(second.status, 201)
      const secondBody = (await second.json()) as { id: string }

      await postPdf(baseUrl, 'b', 'other.pdf', pdfBytes('other'))

      const listed = await fetch(`${baseUrl}/api/documents`, { headers: auth('a') })
      assert.equal(listed.status, 200)
      const body = (await listed.json()) as Array<{
        id: string
        name: string
        version: number
      }>
      assert.deepEqual(
        body.map((item) => ({ id: item.id, name: item.name, version: item.version })),
        [
          { id: secondBody.id, name: 'beta.pdf', version: 1 },
          { id: firstBody.id, name: 'alpha.pdf', version: 1 },
        ],
      )

      const otherList = await fetch(`${baseUrl}/api/documents`, { headers: auth('b') })
      assert.equal(otherList.status, 200)
      const otherBody = (await otherList.json()) as Array<{ name: string }>
      assert.deepEqual(
        otherBody.map((item) => item.name),
        ['other.pdf'],
      )
    } finally {
      remember(db)
      await close()
    }
  })

  it('rejects an unauthenticated list request', async () => {
    const { baseUrl, close } = await listen(appFor(memoryDb()))
    try {
      const response = await fetch(`${baseUrl}/api/documents`)
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Authentication is required.' })
    } finally {
      await close()
    }
  })
})

describe('application user mapping', () => {
  it('creates one application user when first logins race', async () => {
    const db = memoryDb()
    const [first, second] = await Promise.all([
      resolveApplicationUser(db, USER_A),
      resolveApplicationUser(db, USER_A),
    ])
    assert.equal(first.id, second.id)
    assert.equal(db.users.length, 1)
    assert.equal(first.authUserId, USER_A.authUserId)
  })
})

describe('document rate limiting', () => {
  it('allows uploads up to the limit and returns 429 JSON after it', async () => {
    const db = memoryDb()
    const { baseUrl, close } = await listen(appFor(db, { rateLimits: limits({ uploadLimit: 2 }) }))
    try {
      const first = await postPdf(baseUrl, 'a', 'one.pdf', pdfBytes('one'))
      assert.equal(first.status, 201)
      const second = await postPdf(baseUrl, 'a', 'two.pdf', pdfBytes('two'))
      assert.equal(second.status, 201)

      const limited = await postPdf(baseUrl, 'a', 'three.pdf', pdfBytes('three'))
      assert.equal(limited.status, 429)
      assert.match(limited.headers.get('content-type') ?? '', /application\/json/)
      assert.deepEqual(await limited.json(), RATE_LIMITED)
      assert.equal(db.documents.length, 2)

      const listed = await fetch(`${baseUrl}/api/documents`, { headers: auth('a') })
      assert.equal(listed.status, 200)
    } finally {
      remember(db)
      await close()
    }
  })

  it('limits version creation separately from uploads', async () => {
    const db = memoryDb()
    const app = appFor(db, { rateLimits: limits({ uploadLimit: 1, versionLimit: 2 }) })
    const { baseUrl, close } = await listen(app)
    try {
      const created = await postPdf(baseUrl, 'a', 'base.pdf', pdfBytes('base'))
      assert.equal(created.status, 201)
      const { id } = (await created.json()) as { id: string }

      for (const label of ['v2', 'v3']) {
        const saved = await postPdf(baseUrl, 'a', `${label}.pdf`, pdfBytes(label), undefined, id)
        assert.equal(saved.status, 201)
      }

      const limited = await postPdf(baseUrl, 'a', 'v4.pdf', pdfBytes('v4'), undefined, id)
      assert.equal(limited.status, 429)
      assert.deepEqual(await limited.json(), RATE_LIMITED)
      assert.equal(db.documents.find((item) => item.id === id)?.versions.length, 3)
    } finally {
      remember(db)
      await close()
    }
  })

  it('limits document reads, lists, versions, and files with a shared read budget', async () => {
    const db = memoryDb()
    const app = appFor(db, { rateLimits: limits({ readLimit: 4 }) })
    const { baseUrl, close } = await listen(app)
    try {
      const created = await postPdf(baseUrl, 'a', 'read.pdf', pdfBytes('read'))
      assert.equal(created.status, 201)
      const { id } = (await created.json()) as { id: string }

      for (const path of ['', `/${id}`, `/${id}/file`, `/${id}/versions`]) {
        const response = await fetch(`${baseUrl}/api/documents${path}`, { headers: auth('a') })
        assert.equal(response.status, 200, path)
        await response.arrayBuffer()
      }

      const limited = await fetch(`${baseUrl}/api/documents/${id}/versions/1/file`, {
        headers: auth('a'),
      })
      assert.equal(limited.status, 429)
      assert.deepEqual(await limited.json(), RATE_LIMITED)
    } finally {
      remember(db)
      await close()
    }
  })

  it('counts unauthenticated requests and keys on client IP, not user', async () => {
    const db = memoryDb()
    const { baseUrl, close } = await listen(appFor(db, { rateLimits: limits({ uploadLimit: 3 }) }))
    try {
      const anonymous = await fetch(`${baseUrl}/api/documents`, { method: 'POST' })
      assert.equal(anonymous.status, 401)
      const userA = await postPdf(baseUrl, 'a', 'a.pdf', pdfBytes('a'))
      assert.equal(userA.status, 201)
      const userB = await postPdf(baseUrl, 'b', 'b.pdf', pdfBytes('b'))
      assert.equal(userB.status, 201)

      const limitedAnonymous = await fetch(`${baseUrl}/api/documents`, { method: 'POST' })
      assert.equal(limitedAnonymous.status, 429)
      assert.deepEqual(await limitedAnonymous.json(), RATE_LIMITED)
      const limitedUser = await postPdf(baseUrl, 'b', 'b2.pdf', pdfBytes('b2'))
      assert.equal(limitedUser.status, 429)
    } finally {
      remember(db)
      await close()
    }
  })

  it('does not rate limit /health, even after document limits are exhausted', async () => {
    const app = appFor(memoryDb(), { rateLimits: limits({ uploadLimit: 1, readLimit: 1 }) })
    const { baseUrl, close } = await listen(app)
    try {
      const allowed = await fetch(`${baseUrl}/api/documents`, { headers: auth('a') })
      assert.equal(allowed.status, 200)
      await allowed.arrayBuffer()
      const limited = await fetch(`${baseUrl}/api/documents`, { headers: auth('a') })
      assert.equal(limited.status, 429)

      for (let index = 0; index < 25; index += 1) {
        const health = await fetch(`${baseUrl}/health`)
        assert.equal(health.status, 200)
        assert.deepEqual(await health.json(), { status: 'ok' })
      }
    } finally {
      await close()
    }
  })

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const app = appFor(memoryDb(), { rateLimits: limits({ readLimit: 1 }), trustProxy: false })
    const { baseUrl, close } = await listen(app)
    try {
      const first = await fetch(`${baseUrl}/api/documents`, {
        headers: { ...auth('a'), 'x-forwarded-for': '198.51.100.1' },
      })
      assert.equal(first.status, 200)
      const spoofed = await fetch(`${baseUrl}/api/documents`, {
        headers: { ...auth('a'), 'x-forwarded-for': '198.51.100.2' },
      })
      assert.equal(spoofed.status, 429)
    } finally {
      await close()
    }
  })

  it('uses only the proxy-appended address when one proxy hop is trusted', async () => {
    const app = appFor(memoryDb(), { rateLimits: limits({ readLimit: 2 }), trustProxy: 1 })
    const { baseUrl, close } = await listen(app)
    const read = (forwardedFor: string) =>
      fetch(`${baseUrl}/api/documents`, {
        headers: { ...auth('a'), 'x-forwarded-for': forwardedFor },
      })
    try {
      assert.equal((await read('10.0.0.1, 203.0.113.7')).status, 200)
      assert.equal((await read('10.0.0.2, 203.0.113.7')).status, 200)
      assert.equal((await read('10.0.0.3, 203.0.113.7')).status, 429)

      assert.equal((await read('10.0.0.1, 203.0.113.8')).status, 200)
    } finally {
      await close()
    }
  })
})

describe('document deletion', () => {
  it('lets the owner delete a document with every version and stored PDF', async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const doomedId = await createWithVersions(baseUrl, 'doomed.pdf', 3)
      const keptId = await createWithVersions(baseUrl, 'kept.pdf', 1)
      const doomedKeys = versionKeys(db, doomedId)
      const keptKeys = versionKeys(db, keptId)
      assert.equal(doomedKeys.length, 3)

      const deleted = await deleteDocument(baseUrl, doomedId, 'a')
      assert.equal(deleted.status, 204)
      assert.equal(await deleted.text(), '')

      assert.equal(db.documents.some((item) => item.id === doomedId), false)
      assert.equal(
        db.documents.flatMap((item) => item.versions).some((item) => item.documentId === doomedId),
        false,
      )
      assert.deepEqual([...tracked.deleted].sort(), [...doomedKeys].sort())
      for (const key of doomedKeys) {
        await assert.rejects(() => tracked.storage.getPdf(key))
      }

      assert.deepEqual(versionKeys(db, keptId), keptKeys)
      await tracked.storage.getPdf(keptKeys[0]!)
      assert.equal(db.users.some((user) => user.authUserId === USER_A.authUserId), true)

      const reread = await fetch(`${baseUrl}/api/documents/${doomedId}`, { headers: auth('a') })
      assert.equal(reread.status, 404)
      const listed = await fetch(`${baseUrl}/api/documents`, { headers: auth('a') })
      const body = (await listed.json()) as Array<{ id: string }>
      assert.deepEqual(body.map((item) => item.id), [keptId])
    } finally {
      remember(db)
      await close()
    }
  })

  it("returns the non-disclosing 404 for another user's document and deletes nothing", async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const id = await createWithVersions(baseUrl, 'private.pdf', 2)

      const denied = await deleteDocument(baseUrl, id, 'b')
      assert.equal(denied.status, 404)
      assert.deepEqual(await denied.json(), { error: 'Document not found.' })
      assert.equal(versionKeys(db, id).length, 2)
      assert.deepEqual(tracked.deleted, [])

      const stillThere = await fetch(`${baseUrl}/api/documents/${id}/file`, { headers: auth('a') })
      assert.equal(stillThere.status, 200)
      await stillThere.arrayBuffer()
    } finally {
      remember(db)
      await close()
    }
  })

  it('rejects unauthenticated deletion', async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const id = await createWithVersions(baseUrl, 'guarded.pdf', 1)

      const rejected = await fetch(`${baseUrl}/api/documents/${id}`, { method: 'DELETE' })
      assert.equal(rejected.status, 401)
      assert.deepEqual(await rejected.json(), { error: 'Authentication is required.' })
      assert.equal(db.documents.some((item) => item.id === id), true)
      assert.deepEqual(tracked.deleted, [])
    } finally {
      remember(db)
      await close()
    }
  })

  it('returns 404 for a document that does not exist', async () => {
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(memoryDb(), { pdfStorage: tracked.storage }))
    try {
      const missing = await deleteDocument(baseUrl, 'document-does-not-exist', 'a')
      assert.equal(missing.status, 404)
      assert.deepEqual(await missing.json(), { error: 'Document not found.' })
      assert.deepEqual(tracked.deleted, [])
    } finally {
      await close()
    }
  })

  it('treats an already-missing stored PDF as deleted', async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const id = await createWithVersions(baseUrl, 'partial.pdf', 2)
      const keys = versionKeys(db, id)
      tracked.missing.add(keys[0]!)

      const deleted = await deleteDocument(baseUrl, id, 'a')
      assert.equal(deleted.status, 204)
      assert.equal(db.documents.some((item) => item.id === id), false)
      assert.deepEqual([...tracked.deleted].sort(), [...keys].sort())
    } finally {
      remember(db)
      await close()
    }
  })

  it('keeps the document when storage cleanup fails and finishes on retry', async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const id = await createWithVersions(baseUrl, 'flaky.pdf', 3)
      const keys = versionKeys(db, id)
      tracked.failing.add(keys[1]!)

      const failed = await deleteDocument(baseUrl, id, 'a')
      assert.equal(failed.status, 500)
      assert.deepEqual(await failed.json(), { error: 'The document could not be deleted.' })
      assert.deepEqual(versionKeys(db, id), keys)

      tracked.failing.clear()
      const retried = await deleteDocument(baseUrl, id, 'a')
      assert.equal(retried.status, 204)
      assert.equal(db.documents.some((item) => item.id === id), false)
      for (const key of keys) {
        await assert.rejects(() => tracked.storage.getPdf(key))
      }
    } finally {
      remember(db)
      await close()
    }
  })

  it('also deletes a version saved while the deletion is in progress', async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const id = await createWithVersions(baseUrl, 'racing.pdf', 1)
      const lateKey = 'documents/late-version.pdf'
      let injected = false
      tracked.beforeDelete = async () => {
        if (injected) {
          return
        }
        injected = true
        await db.documentVersion.create({
          data: { documentId: id, version: 2, fileUrl: lateKey, sizeBytes: 0n },
        })
      }

      const deleted = await deleteDocument(baseUrl, id, 'a')
      assert.equal(deleted.status, 204)
      assert.equal(db.documents.some((item) => item.id === id), false)
      assert.equal(tracked.deleted.includes(lateKey), true)
    } finally {
      remember(db)
      await close()
    }
  })

  it('does not delete a stored PDF that another document still references', async () => {
    const db = memoryDb()
    const tracked = trackingStorage()
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage: tracked.storage }))
    try {
      const doomedId = await createWithVersions(baseUrl, 'doomed.pdf', 2)
      const otherId = await createWithVersions(baseUrl, 'other.pdf', 1)
      const [sharedKey, ownKey] = versionKeys(db, doomedId)
      const other = db.documents.find((item) => item.id === otherId)!
      other.versions[0]!.fileUrl = sharedKey!

      const deleted = await deleteDocument(baseUrl, doomedId, 'a')
      assert.equal(deleted.status, 204)
      assert.deepEqual(tracked.deleted, [ownKey])
      await tracked.storage.getPdf(sharedKey!)
    } finally {
      remember(db)
      await close()
    }
  })
})

describe('storage quotas', () => {
  const DOCUMENT_LIMIT_ERROR = {
    error: 'You can store up to 50 documents. Delete a document to upload another.',
  }
  const VERSION_LIMIT_ERROR = { error: 'A document can have up to 50 versions.' }
  const STORAGE_LIMIT_ERROR = {
    error: 'This upload would exceed your 2 GB storage limit. Delete documents to free up space.',
  }

  it('accepts the 50th document and rejects the 51st before storing it', async () => {
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    seedDocuments(db, userId, MAX_DOCUMENTS_PER_USER - 1)
    const tracked = quotaStorage()
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const fiftieth = await postPdf(baseUrl, 'a', 'fiftieth.pdf', pdfBytes('fiftieth'))
      assert.equal(fiftieth.status, 201)
      assert.equal(ownedDocuments(db, userId).length, MAX_DOCUMENTS_PER_USER)

      const rejected = await postPdf(baseUrl, 'a', 'fifty-first.pdf', pdfBytes('fifty-first'))
      assert.equal(rejected.status, 413)
      assert.deepEqual(await rejected.json(), DOCUMENT_LIMIT_ERROR)
      assert.equal(ownedDocuments(db, userId).length, MAX_DOCUMENTS_PER_USER)
      assert.equal(tracked.uploaded.length, 1)
      assert.deepEqual(tracked.deleted, [])

      const otherUser = await postPdf(baseUrl, 'b', 'unaffected.pdf', pdfBytes('unaffected'))
      assert.equal(otherUser.status, 201)
    } finally {
      remember(db)
      await close()
    }
  })

  it('accepts the 50th version and rejects the 51st before storing it', async () => {
    const db = memoryDb()
    const tracked = quotaStorage()
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const created = await postPdf(baseUrl, 'a', 'versioned.pdf', pdfBytes('v1'))
      assert.equal(created.status, 201)
      const { id } = (await created.json()) as { id: string }
      seedVersions(db, id, MAX_VERSIONS_PER_DOCUMENT - 2)

      const fiftieth = await postPdf(baseUrl, 'a', 'v50.pdf', pdfBytes('v50'), undefined, id)
      assert.equal(fiftieth.status, 201)
      assert.equal(((await fiftieth.json()) as { version: number }).version, MAX_VERSIONS_PER_DOCUMENT)

      const rejected = await postPdf(baseUrl, 'a', 'v51.pdf', pdfBytes('v51'), undefined, id)
      assert.equal(rejected.status, 413)
      assert.deepEqual(await rejected.json(), VERSION_LIMIT_ERROR)
      assert.equal(versionKeys(db, id).length, MAX_VERSIONS_PER_DOCUMENT)
      assert.equal(tracked.uploaded.length, 2)
      assert.deepEqual(tracked.deleted, [])
    } finally {
      remember(db)
      await close()
    }
  })

  it('accepts uploads up to exactly 2 GB and rejects one that would exceed it before storing it', async () => {
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    const [seededId] = seedDocuments(db, userId, 1, MAX_STORAGE_BYTES_PER_USER - 1000n)
    const tracked = quotaStorage()
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const below = pdfBytes('below the limit')
      const accepted = await postPdf(baseUrl, 'a', 'below.pdf', below)
      assert.equal(accepted.status, 201)
      assert.equal(usedBytes(db, userId), MAX_STORAGE_BYTES_PER_USER - 1000n + BigInt(below.byteLength))

      const remaining = Number(MAX_STORAGE_BYTES_PER_USER - usedBytes(db, userId))
      const exact = await postPdf(baseUrl, 'a', 'exact.pdf', paddedPdf('exact fit', remaining))
      assert.equal(exact.status, 201)
      assert.equal(usedBytes(db, userId), MAX_STORAGE_BYTES_PER_USER)

      const documentsBefore = db.documents.length
      const overDocument = await postPdf(baseUrl, 'a', 'over.pdf', pdfBytes('over'))
      assert.equal(overDocument.status, 413)
      assert.deepEqual(await overDocument.json(), STORAGE_LIMIT_ERROR)
      const overVersion = await postPdf(baseUrl, 'a', 'over-v2.pdf', pdfBytes('over'), undefined, seededId)
      assert.equal(overVersion.status, 413)
      assert.deepEqual(await overVersion.json(), STORAGE_LIMIT_ERROR)

      assert.equal(db.documents.length, documentsBefore)
      assert.equal(versionKeys(db, seededId!).length, 1)
      assert.equal(usedBytes(db, userId), MAX_STORAGE_BYTES_PER_USER)
      assert.equal(tracked.uploaded.length, 2)
      assert.deepEqual(tracked.deleted, [])
    } finally {
      remember(db)
      await close()
    }
  })

  it('releases document and storage quota when a document is deleted', async () => {
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    const [largeId] = seedDocuments(db, userId, 1, MAX_STORAGE_BYTES_PER_USER)
    const [smallId] = seedDocuments(db, userId, MAX_DOCUMENTS_PER_USER - 1)
    const tracked = quotaStorage()
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    const bytes = pdfBytes('after delete')
    try {
      const atDocumentLimit = await postPdf(baseUrl, 'a', 'blocked.pdf', bytes)
      assert.equal(atDocumentLimit.status, 413)
      assert.deepEqual(await atDocumentLimit.json(), DOCUMENT_LIMIT_ERROR)

      assert.equal((await deleteDocument(baseUrl, smallId!, 'a')).status, 204)
      const atStorageLimit = await postPdf(baseUrl, 'a', 'blocked.pdf', bytes)
      assert.equal(atStorageLimit.status, 413)
      assert.deepEqual(await atStorageLimit.json(), STORAGE_LIMIT_ERROR)

      assert.equal((await deleteDocument(baseUrl, largeId!, 'a')).status, 204)
      const accepted = await postPdf(baseUrl, 'a', 'accepted.pdf', bytes)
      assert.equal(accepted.status, 201)
      assert.equal(ownedDocuments(db, userId).length, MAX_DOCUMENTS_PER_USER - 1)
      assert.equal(usedBytes(db, userId), BigInt(bytes.byteLength))
    } finally {
      remember(db)
      await close()
    }
  })

  it('does not count a failed storage upload against the quota', async (t) => {
    t.mock.method(console, 'error', () => undefined)
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    const bytes = pdfBytes('retry after failure')
    seedDocuments(db, userId, MAX_DOCUMENTS_PER_USER - 2)
    seedDocuments(db, userId, 1, MAX_STORAGE_BYTES_PER_USER - BigInt(bytes.byteLength))
    const tracked = quotaStorage()
    tracked.failUploads = 1
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const failed = await postPdf(baseUrl, 'a', 'flaky.pdf', bytes)
      assert.equal(failed.status, 500)
      assert.deepEqual(await failed.json(), { error: 'The document could not be saved.' })
      assert.equal(ownedDocuments(db, userId).length, MAX_DOCUMENTS_PER_USER - 1)
      assert.equal(usedBytes(db, userId), MAX_STORAGE_BYTES_PER_USER - BigInt(bytes.byteLength))

      const retried = await postPdf(baseUrl, 'a', 'flaky.pdf', bytes)
      assert.equal(retried.status, 201)
      assert.equal(ownedDocuments(db, userId).length, MAX_DOCUMENTS_PER_USER)
      assert.equal(usedBytes(db, userId), MAX_STORAGE_BYTES_PER_USER)
    } finally {
      remember(db)
      await close()
    }
  })

  it('lets only one of two simultaneous uploads take the last document slot', async () => {
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    seedDocuments(db, userId, MAX_DOCUMENTS_PER_USER - 1)
    const tracked = quotaStorage()
    tracked.holdUntil = 2
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const responses = await Promise.all([
        postPdf(baseUrl, 'a', 'racer-1.pdf', pdfBytes('racer 1')),
        postPdf(baseUrl, 'a', 'racer-2.pdf', pdfBytes('racer 2')),
      ])
      await assertOneQuotaWinner(db, tracked, responses, DOCUMENT_LIMIT_ERROR)
      assert.equal(ownedDocuments(db, userId).length, MAX_DOCUMENTS_PER_USER)
    } finally {
      remember(db)
      await close()
    }
  })

  it('lets only one of two simultaneous uploads use the last storage bytes', async () => {
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    const bytes = pdfBytes('racing for bytes')
    seedDocuments(db, userId, 1, MAX_STORAGE_BYTES_PER_USER - BigInt(bytes.byteLength))
    const tracked = quotaStorage()
    tracked.holdUntil = 2
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const responses = await Promise.all([
        postPdf(baseUrl, 'a', 'bytes-1.pdf', bytes),
        postPdf(baseUrl, 'a', 'bytes-2.pdf', bytes),
      ])
      await assertOneQuotaWinner(db, tracked, responses, STORAGE_LIMIT_ERROR)
      assert.equal(usedBytes(db, userId), MAX_STORAGE_BYTES_PER_USER)
    } finally {
      remember(db)
      await close()
    }
  })

  it('lets only one of two simultaneous saves become the 50th version', async () => {
    const db = memoryDb()
    const tracked = quotaStorage()
    const { baseUrl, close } = await listen(quotaApp(db, tracked.storage))
    try {
      const created = await postPdf(baseUrl, 'a', 'versioned.pdf', pdfBytes('v1'))
      assert.equal(created.status, 201)
      const { id } = (await created.json()) as { id: string }
      seedVersions(db, id, MAX_VERSIONS_PER_DOCUMENT - 2)
      tracked.uploaded.length = 0
      tracked.holdUntil = 2

      const responses = await Promise.all([
        postPdf(baseUrl, 'a', 'save-1.pdf', pdfBytes('save 1'), undefined, id),
        postPdf(baseUrl, 'a', 'save-2.pdf', pdfBytes('save 2'), undefined, id),
      ])
      await assertOneQuotaWinner(db, tracked, responses, VERSION_LIMIT_ERROR)
      assert.equal(versionKeys(db, id).length, MAX_VERSIONS_PER_DOCUMENT)
    } finally {
      remember(db)
      await close()
    }
  })

  it('returns every document and version up to the quota and bounds larger legacy lists', async () => {
    const db = memoryDb()
    const userId = seedUser(db, USER_A)
    const [versionedId] = seedDocuments(db, userId, MAX_DOCUMENTS_PER_USER)
    seedVersions(db, versionedId!, MAX_VERSIONS_PER_DOCUMENT - 1)
    const takes: number[] = []
    const findMany = db.document.findMany
    db.document.findMany = (args) => {
      takes.push(args.take)
      return findMany(args)
    }
    const { baseUrl, close } = await listen(quotaApp(db, quotaStorage().storage))
    const list = async (path: string) => {
      const response = await fetch(`${baseUrl}/api/documents${path}`, { headers: auth('a') })
      assert.equal(response.status, 200)
      return (await response.json()) as Array<Record<string, unknown>>
    }
    try {
      assert.ok(LIST_LIMIT >= MAX_DOCUMENTS_PER_USER && LIST_LIMIT >= MAX_VERSIONS_PER_DOCUMENT)

      const documents = await list('')
      assert.equal(documents.length, MAX_DOCUMENTS_PER_USER)
      assert.deepEqual(Object.keys(documents[0]!).sort(), [
        'createdAt',
        'fileUrl',
        'id',
        'name',
        'updatedAt',
        'version',
      ])
      assert.deepEqual(takes, [LIST_LIMIT])

      const versions = await list(`/${versionedId}/versions`)
      assert.equal(versions.length, MAX_VERSIONS_PER_DOCUMENT)
      assert.deepEqual(Object.keys(versions[0]!).sort(), ['createdAt', 'fileUrl', 'id', 'version'])
      assert.deepEqual(
        versions.map((item) => item.version),
        Array.from({ length: MAX_VERSIONS_PER_DOCUMENT }, (_, index) => MAX_VERSIONS_PER_DOCUMENT - index),
      )

      seedDocuments(db, userId, LIST_LIMIT)
      seedVersions(db, versionedId!, LIST_LIMIT)
      assert.equal((await list('')).length, LIST_LIMIT)
      assert.equal((await list(`/${versionedId}/versions`)).length, LIST_LIMIT)
    } finally {
      await close()
    }
  })
})

describe('rate limit configuration', () => {
  it('uses the documented defaults when no environment values are set', () => {
    assert.deepEqual(documentRateLimitsFromEnv({}), {
      windowMs: 15 * 60 * 1000,
      uploadLimit: 10,
      versionLimit: 20,
      readLimit: 300,
    })
  })

  it('reads limits from the environment and rejects invalid values', () => {
    assert.deepEqual(
      documentRateLimitsFromEnv({
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_UPLOAD_MAX: '5',
        RATE_LIMIT_VERSION_MAX: '7',
        RATE_LIMIT_READ_MAX: '900',
      }),
      { windowMs: 60_000, uploadLimit: 5, versionLimit: 7, readLimit: 900 },
    )
    for (const value of ['0', '-1', '1.5', 'ten']) {
      assert.throws(() => documentRateLimitsFromEnv({ RATE_LIMIT_UPLOAD_MAX: value }), /RATE_LIMIT_UPLOAD_MAX/)
    }
  })

  it('trusts one proxy hop only on Render unless TRUST_PROXY is set', () => {
    assert.equal(trustProxySetting({}), false)
    assert.equal(trustProxySetting({ RENDER: 'true' }), 1)
    assert.equal(trustProxySetting({ RENDER: 'true', TRUST_PROXY: '0' }), false)
    assert.equal(trustProxySetting({ TRUST_PROXY: '2' }), 2)
    for (const value of ['true', '*', 'loopback', '-1']) {
      assert.throws(() => trustProxySetting({ TRUST_PROXY: value }), /TRUST_PROXY/)
    }
  })
})

describe('production hardening', () => {
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'

  it('sends security headers without breaking CORS or PDF streaming', async () => {
    const db = memoryDb()
    const { baseUrl, close } = await listen(appFor(db))
    try {
      const health = await fetch(`${baseUrl}/health`, { headers: { origin: frontendOrigin } })
      assert.equal(health.status, 200)
      assert.deepEqual(await health.json(), { status: 'ok' })
      assertSecurityHeaders(health)
      assert.equal(health.headers.get('access-control-allow-origin'), frontendOrigin)

      const preflight = await fetch(`${baseUrl}/api/documents/doc-1`, {
        method: 'OPTIONS',
        headers: {
          origin: frontendOrigin,
          'access-control-request-method': 'DELETE',
          'access-control-request-headers': 'authorization',
        },
      })
      assert.equal(preflight.status, 204)
      assert.equal(preflight.headers.get('access-control-allow-origin'), frontendOrigin)
      assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /DELETE/)

      const bytes = pdfBytes('headers')
      const created = await postPdf(baseUrl, 'a', 'headers.pdf', bytes)
      assert.equal(created.status, 201)
      const { id } = (await created.json()) as { id: string }

      const file = await fetch(`${baseUrl}/api/documents/${id}/file`, {
        headers: { ...auth('a'), origin: frontendOrigin },
      })
      assert.equal(file.status, 200)
      assert.equal(file.headers.get('content-type'), PDF_MIME_TYPE)
      assert.equal(file.headers.get('access-control-allow-origin'), frontendOrigin)
      assertSecurityHeaders(file)
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes)
    } finally {
      remember(db)
      await close()
    }
  })

  it('rejects oversized and malformed JSON or URL-encoded bodies with a JSON error', async () => {
    const { baseUrl, close } = await listen(appFor(memoryDb()))
    const post = (contentType: string, body: string) =>
      fetch(`${baseUrl}/api/documents`, {
        method: 'POST',
        headers: { ...auth('a'), 'content-type': contentType },
        body,
      })
    try {
      const oversizedJson = await post(
        'application/json',
        JSON.stringify({ data: 'x'.repeat(150 * 1024) }),
      )
      assert.equal(oversizedJson.status, 413)
      assert.match(oversizedJson.headers.get('content-type') ?? '', /application\/json/)
      assert.deepEqual(await oversizedJson.json(), { error: 'The request body is too large.' })

      const oversizedForm = await post(
        'application/x-www-form-urlencoded',
        `data=${'x'.repeat(150 * 1024)}`,
      )
      assert.equal(oversizedForm.status, 413)
      assert.deepEqual(await oversizedForm.json(), { error: 'The request body is too large.' })

      const malformed = await post('application/json', '{"data":')
      assert.equal(malformed.status, 400)
      const malformedText = await malformed.text()
      assert.deepEqual(JSON.parse(malformedText), {
        error: 'The request body could not be parsed.',
      })
      assert.equal(/SyntaxError|node_modules|\bat\s/.test(malformedText), false)

      const withinLimit = await post('application/json', JSON.stringify({ data: 'x'.repeat(50 * 1024) }))
      assert.equal(withinLimit.status, 400)
      assert.deepEqual(await withinLimit.json(), { error: 'A PDF file is required.' })
    } finally {
      await close()
    }
  })

  it('still accepts multipart PDFs above the JSON limit and keeps the 20 MB cap', async () => {
    const db = memoryDb()
    const { baseUrl, close } = await listen(appFor(db))
    try {
      const large = Buffer.concat([pdfBytes('large'), Buffer.alloc(512 * 1024, 0x20)])
      const accepted = await postPdf(baseUrl, 'a', 'large.pdf', large)
      assert.equal(accepted.status, 201)

      const oversized = Buffer.concat([pdfBytes('oversized'), Buffer.alloc(20 * 1024 * 1024, 0x20)])
      const rejected = await postPdf(baseUrl, 'a', 'oversized.pdf', oversized)
      assert.equal(rejected.status, 413)
      assert.deepEqual(await rejected.json(), { error: 'PDF files must be 20 MB or smaller.' })
      assert.equal(db.documents.length, 1)
    } finally {
      remember(db)
      await close()
    }
  })

  it('rejects multipart uploads with text fields or extra parts without storing anything', async () => {
    const db = memoryDb()
    const memoryStorage = createMemoryPdfStorage()
    const uploaded: string[] = []
    const pdfStorage: PdfStorage = {
      async uploadPdf(filePath, objectKey) {
        await memoryStorage.uploadPdf(filePath, objectKey)
        uploaded.push(objectKey)
      },
      getPdf: (objectKey) => memoryStorage.getPdf(objectKey),
      deletePdf: (objectKey) => memoryStorage.deletePdf(objectKey),
    }
    const { baseUrl, close } = await listen(appFor(db, { pdfStorage }))
    const marker = 'rejected multipart upload'
    const pdf = () => new Blob([new Uint8Array(pdfBytes(marker))], { type: PDF_MIME_TYPE })
    const send = (route: string, build: (form: FormData) => void) => {
      const form = new FormData()
      build(form)
      return fetch(`${baseUrl}${route}`, { method: 'POST', headers: auth('a'), body: form })
    }
    try {
      const created = await postPdf(baseUrl, 'a', 'base.pdf', pdfBytes('base'))
      assert.equal(created.status, 201)
      const { id } = (await created.json()) as { id: string }

      const rejected = [
        await send('/api/documents', (form) => {
          form.append('file', pdf(), 'field-after.pdf')
          form.append('userId', 'client-supplied-user')
        }),
        await send('/api/documents', (form) => {
          form.append('email', USER_B.email)
          form.append('file', pdf(), 'field-before.pdf')
        }),
        await send('/api/documents', (form) => {
          for (let index = 0; index < 64; index += 1) {
            form.append(`field${index}`, 'x'.repeat(64 * 1024))
          }
        }),
        await send('/api/documents', (form) => {
          form.append('file', pdf(), 'first.pdf')
          form.append('file', pdf(), 'second.pdf')
        }),
        await send(`/api/documents/${id}/versions`, (form) => {
          form.append('file', pdf(), 'version.pdf')
          form.append('note', 'x'.repeat(2048))
        }),
      ]
      for (const response of rejected) {
        assert.equal(response.status, 400)
        assert.deepEqual(await response.json(), { error: 'Upload one PDF file.' })
      }

      assert.equal(db.documents.length, 1)
      assert.equal(db.documents[0]?.versions.length, 1)
      assert.equal(uploaded.length, 1)
      for (const name of await readdir(DOCUMENTS_DIRECTORY)) {
        const contents = await readFile(join(DOCUMENTS_DIRECTORY, name)).catch(() => Buffer.alloc(0))
        assert.equal(contents.includes(marker), false, `temp upload left behind: ${name}`)
      }

      const saved = await postPdf(baseUrl, 'a', 'edited.pdf', pdfBytes('edited'), undefined, id)
      assert.equal(saved.status, 201)
      assert.equal(((await saved.json()) as { version: number }).version, 2)
      assert.equal(uploaded.length, 2)

      const health = await fetch(`${baseUrl}/health`)
      assert.equal(health.status, 200)
    } finally {
      remember(db)
      await close()
    }
  })

  it('returns a generic 500 for unexpected errors without exposing internals', async (t) => {
    const logged = t.mock.method(console, 'error', () => undefined)
    const secret =
      'connect ECONNREFUSED postgresql://pedit:super-secret-password@db.internal:5432/pedit ' +
      'R2_SECRET_ACCESS_KEY=r2-secret-key at E:\\pdf editor\\backend\\src\\lib\\prisma.ts:12:7'
    const db = memoryDb()
    db.document.findMany = async () => {
      throw Object.assign(new Error(secret), { code: 'P1001', clientVersion: '7.10.0' })
    }
    const brokenAuth = appFor(db, {
      verifyAuthorization: () => Promise.reject(new Error(secret)),
    })
    const failures: unknown[] = []
    const onFailure = (error: unknown) => {
      failures.push(error)
    }
    process.once('uncaughtException', onFailure)
    process.once('unhandledRejection', onFailure)

    const server = await listen(appFor(db))
    const authServer = await listen(brokenAuth)
    try {
      for (const response of [
        await fetch(`${server.baseUrl}/api/documents`, { headers: auth('a') }),
        await fetch(`${authServer.baseUrl}/api/documents`, { headers: auth('a') }),
      ]) {
        assert.equal(response.status, 500)
        assert.match(response.headers.get('content-type') ?? '', /application\/json/)
        const text = await response.text()
        assert.deepEqual(JSON.parse(text), {
          error: 'Something went wrong. Please try again later.',
        })
        for (const leak of ['super-secret', 'r2-secret', 'postgresql', 'prisma', 'P1001', 'Error', 'E:\\']) {
          assert.equal(text.includes(leak), false, leak)
        }
      }

      assert.equal(logged.mock.callCount(), 2)
      for (const call of logged.mock.calls) {
        const [, details] = call.arguments as [string, { path: string; error: Error }]
        assert.equal(details.path, '/api/documents')
        assert.equal(details.error.message, secret)
      }

      const health = await fetch(`${server.baseUrl}/health`)
      assert.equal(health.status, 200)
      assert.equal(failures.length, 0)
    } finally {
      process.off('uncaughtException', onFailure)
      process.off('unhandledRejection', onFailure)
      await server.close()
      await authServer.close()
    }
  })
})

function assertSecurityHeaders(response: Response) {
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/)
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/)
  assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=\d+/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(response.headers.get('x-powered-by'), null)
}

async function createWithVersions(baseUrl: string, name: string, count: number): Promise<string> {
  const created = await postPdf(baseUrl, 'a', name, pdfBytes(`${name} v1`))
  assert.equal(created.status, 201)
  const { id } = (await created.json()) as { id: string }
  for (let version = 2; version <= count; version += 1) {
    const saved = await postPdf(baseUrl, 'a', name, pdfBytes(`${name} v${version}`), undefined, id)
    assert.equal(saved.status, 201)
  }
  return id
}

function versionKeys(db: { documents: MemoryDocument[] }, documentId: string): string[] {
  const document = db.documents.find((item) => item.id === documentId)
  return [...(document?.versions ?? [])]
    .sort((left, right) => left.version - right.version)
    .map((version) => version.fileUrl)
}

function deleteDocument(baseUrl: string, documentId: string, token: 'a' | 'b'): Promise<Response> {
  return fetch(`${baseUrl}/api/documents/${documentId}`, {
    method: 'DELETE',
    headers: auth(token),
  })
}

/** Memory storage that records successful deletes and can simulate missing or failing objects. */
function trackingStorage() {
  const base = createMemoryPdfStorage()
  const tracked = {
    deleted: [] as string[],
    missing: new Set<string>(),
    failing: new Set<string>(),
    beforeDelete: undefined as undefined | ((key: string) => Promise<void>),
    storage: {
      uploadPdf: (filePath, objectKey) => base.uploadPdf(filePath, objectKey),
      getPdf: (objectKey) => base.getPdf(objectKey),
      async deletePdf(objectKey) {
        await tracked.beforeDelete?.(objectKey)
        if (tracked.failing.has(objectKey)) {
          throw new Error('Storage is unavailable.')
        }
        await base.deletePdf(objectKey)
        tracked.deleted.push(objectKey)
        if (tracked.missing.has(objectKey)) {
          throw Object.assign(new Error('The specified key does not exist.'), {
            name: 'NoSuchKey',
            $metadata: { httpStatusCode: 404 },
          })
        }
      },
    } satisfies PdfStorage,
  }
  return tracked
}

function limits(overrides: Partial<DocumentRateLimits>): DocumentRateLimits {
  return { windowMs: 60_000, uploadLimit: 100, versionLimit: 100, readLimit: 100, ...overrides }
}

function quotaApp(db: MemoryDb, pdfStorage: PdfStorage): Express {
  return appFor(db, {
    pdfStorage,
    rateLimits: limits({ uploadLimit: 1000, versionLimit: 1000, readLimit: 1000 }),
  })
}

/** Memory storage that records uploads and deletes, can fail uploads, and can hold uploads until several arrive. */
function quotaStorage() {
  const base = createMemoryPdfStorage()
  const held: Array<() => void> = []
  const tracked = {
    uploaded: [] as string[],
    deleted: [] as string[],
    failUploads: 0,
    holdUntil: 0,
    storage: {
      async uploadPdf(filePath, objectKey) {
        if (tracked.failUploads > 0) {
          tracked.failUploads -= 1
          throw new Error('Storage is unavailable.')
        }
        await base.uploadPdf(filePath, objectKey)
        tracked.uploaded.push(objectKey)
        if (tracked.holdUntil > 0) {
          await new Promise<void>((resolve) => {
            held.push(resolve)
            if (held.length === tracked.holdUntil) {
              tracked.holdUntil = 0
              for (const release of held.splice(0)) {
                release()
              }
            }
          })
        }
      },
      getPdf: (objectKey) => base.getPdf(objectKey),
      async deletePdf(objectKey) {
        await base.deletePdf(objectKey)
        tracked.deleted.push(objectKey)
      },
    } satisfies PdfStorage,
  }
  return tracked
}

/** Both uploads passed the pre-check and reached storage; the locked re-check must keep exactly one. */
async function assertOneQuotaWinner(
  db: MemoryDb,
  tracked: ReturnType<typeof quotaStorage>,
  responses: Response[],
  expectedError: { error: string },
) {
  assert.deepEqual(
    responses.map((response) => response.status).sort((left, right) => left - right),
    [201, 413],
  )
  const loser = responses.find((response) => response.status === 413)!
  assert.deepEqual(await loser.json(), expectedError)

  assert.equal(tracked.uploaded.length, 2)
  assert.equal(tracked.deleted.length, 1)
  const kept = tracked.uploaded.filter((key) => !tracked.deleted.includes(key))
  const referenced = new Set(db.documents.flatMap((item) => item.versions).map((item) => item.fileUrl))
  assert.equal(kept.length, 1)
  assert.equal(referenced.has(kept[0]!), true)
  assert.equal(referenced.has(tracked.deleted[0]!), false)
  assert.equal(db.quotaLocks.length >= 2, true)
}

let seededSequence = 0

function seedUser(db: MemoryDb, identity: AuthIdentity): string {
  const id = `seeded-${identity.authUserId}`
  db.users.push({ id, email: identity.email, authUserId: identity.authUserId })
  return id
}

/** Adds documents with one version each directly to the store, as if they were uploaded earlier. */
function seedDocuments(db: MemoryDb, userId: string, count: number, sizeBytes = 0n): string[] {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    seededSequence += 1
    const id = `seeded-document-${seededSequence}`
    db.documents.push({
      id,
      userId,
      name: `${id}.pdf`,
      createdAt: new Date(),
      versions: [
        {
          id: `${id}-v1`,
          documentId: id,
          version: 1,
          fileUrl: `documents/${id}-v1.pdf`,
          sizeBytes,
          createdAt: new Date(),
        },
      ],
    })
    ids.push(id)
  }
  return ids
}

function seedVersions(db: MemoryDb, documentId: string, count: number, sizeBytes = 0n) {
  const document = db.documents.find((item) => item.id === documentId)
  assert.ok(document)
  for (let index = 0; index < count; index += 1) {
    seededSequence += 1
    const id = `seeded-version-${seededSequence}`
    document.versions.push({
      id,
      documentId,
      version: Math.max(...document.versions.map((item) => item.version)) + 1,
      fileUrl: `documents/${id}.pdf`,
      sizeBytes,
      createdAt: new Date(),
    })
  }
}

function ownedDocuments(db: MemoryDb, userId: string): MemoryDocument[] {
  return db.documents.filter((item) => item.userId === userId)
}

function usedBytes(db: MemoryDb, userId: string): bigint {
  return ownedDocuments(db, userId)
    .flatMap((item) => item.versions)
    .reduce((sum, item) => sum + item.sizeBytes, 0n)
}

function paddedPdf(label: string, size: number): Buffer {
  const header = pdfBytes(label)
  assert.ok(size >= header.byteLength)
  return Buffer.concat([header, Buffer.alloc(size - header.byteLength, 0x20)])
}

function appFor(db: DocumentsDb, overrides: Partial<CreateAppOptions> = {}): Express {
  return createApp({
    db,
    pdfStorage: createMemoryPdfStorage(),
    verifyAuthorization(header) {
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
      if (token === 'a') {
        return Promise.resolve(USER_A)
      }
      if (token === 'b') {
        return Promise.resolve(USER_B)
      }
      return Promise.resolve(null)
    },
    ...overrides,
  })
}

function auth(token: 'a' | 'b'): HeadersInit {
  return { authorization: `Bearer ${token}` }
}

function pdfBytes(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n`)
}

async function postPdf(
  baseUrl: string,
  token: 'a' | 'b',
  filename: string,
  bytes: Buffer,
  extra?: { email: string; userId: string },
  documentId?: string,
): Promise<Response> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const form = new FormData()
  form.append('file', new Blob([copy], { type: PDF_MIME_TYPE }), filename)
  if (extra) {
    form.append('email', extra.email)
    form.append('userId', extra.userId)
  }
  const path = documentId
    ? `/api/documents/${documentId}/versions`
    : '/api/documents'
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: auth(token),
    body: form,
  })
}

type MemoryUser = ApplicationUser
type MemoryVersion = {
  id: string
  documentId: string
  version: number
  fileUrl: string
  sizeBytes: bigint
  createdAt: Date
}
type MemoryDocument = {
  id: string
  userId: string
  name: string
  createdAt: Date
  versions: MemoryVersion[]
}

type MemoryDb = DocumentsDb & {
  users: MemoryUser[]
  documents: MemoryDocument[]
  quotaLocks: string[]
}

/** Yields to the event loop so concurrent requests interleave between quota reads and inserts. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function memoryDb(): MemoryDb {
  const users: MemoryUser[] = []
  const documents: MemoryDocument[] = []
  const quotaLocks: string[] = []
  const userLocks = new Map<string, Promise<void>>()
  let sequence = 0
  const nextId = (prefix: string) => {
    sequence += 1
    return `${prefix}-${sequence}`
  }
  const ownedVersions = (userId: string) =>
    documents.filter((item) => item.userId === userId).flatMap((item) => item.versions)

  const db: MemoryDb = {
    users,
    documents,
    quotaLocks,
    user: {
      async findUnique({ where }) {
        if ('authUserId' in where) {
          return users.find((user) => user.authUserId === where.authUserId) ?? null
        }
        if ('email' in where) {
          return users.find((user) => user.email === where.email) ?? null
        }
        return users.find((user) => user.id === where.id) ?? null
      },
      async updateMany({ where, data }) {
        const matches = users.filter(
          (user) => user.email === where.email && user.authUserId === null,
        )
        for (const user of matches) {
          user.authUserId = data.authUserId
        }
        return { count: matches.length }
      },
      async create({ data }) {
        if (users.some((user) => user.authUserId === data.authUserId || user.email === data.email)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        const user: MemoryUser = {
          id: nextId('user'),
          email: data.email,
          authUserId: data.authUserId,
        }
        users.push(user)
        return user
      },
      async update({ where, data }) {
        const user = users.find((item) => item.id === where.id)
        if (!user) {
          throw new Error('missing user')
        }
        if (users.some((item) => item.id !== user.id && item.email === data.email)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        user.email = data.email
        return user
      },
    },
    document: {
      async create({ data }) {
        await tick()
        const version: MemoryVersion = {
          id: nextId('version'),
          documentId: '',
          version: data.versions.create.version,
          fileUrl: data.versions.create.fileUrl,
          sizeBytes: data.versions.create.sizeBytes,
          createdAt: new Date(),
        }
        const document: MemoryDocument = {
          id: nextId('document'),
          userId: data.userId,
          name: data.name,
          createdAt: new Date(),
          versions: [version],
        }
        version.documentId = document.id
        documents.push(document)
        return {
          id: document.id,
          name: document.name,
          createdAt: document.createdAt,
          versions: document.versions.map((item) => ({
            version: item.version,
            fileUrl: item.fileUrl,
          })),
        }
      },
      async count({ where }) {
        await tick()
        return documents.filter((item) => item.userId === where.userId).length
      },
      async findMany({ where, take }) {
        return documents
          .filter((item) => item.userId === where.userId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .slice(0, take)
          .map((document) => {
            const latest = [...document.versions].sort(
              (left, right) => right.version - left.version,
            )[0]
            return {
              id: document.id,
              name: document.name,
              createdAt: document.createdAt,
              versions: latest
                ? [
                    {
                      version: latest.version,
                      createdAt: latest.createdAt,
                      fileUrl: latest.fileUrl,
                    },
                  ]
                : [],
            }
          })
      },
      async findFirst(args) {
        const document = documents.find(
          (item) => item.id === args.where.id && item.userId === args.where.userId,
        )
        if (!document) {
          return null
        }
        if (args.select && 'id' in args.select) {
          return { id: document.id }
        }
        if (args.select && 'versions' in args.select) {
          return {
            id: document.id,
            versions: [...document.versions]
              .sort((left, right) => right.version - left.version)
              .slice(0, args.select.versions.take)
              .map(({ id, version, fileUrl, createdAt }) => ({ id, version, fileUrl, createdAt })),
          }
        }
        const latest = [...document.versions].sort((left, right) => right.version - left.version)[0]
        return {
          id: document.id,
          name: document.name,
          createdAt: document.createdAt,
          versions: latest ? [latest] : [],
        }
      },
      async deleteMany({ where }) {
        const allowed = where.versions.every.id.in
        const index = documents.findIndex(
          (item) =>
            item.id === where.id &&
            item.userId === where.userId &&
            item.versions.every((version) => allowed.includes(version.id)),
        )
        if (index === -1) {
          return { count: 0 }
        }
        documents.splice(index, 1)
        return { count: 1 }
      },
    },
    documentVersion: {
      async findMany({ where }) {
        return documents
          .filter((item) => item.id !== where.documentId.not)
          .flatMap((item) => item.versions)
          .filter((version) => where.fileUrl.in.includes(version.fileUrl))
          .map((version) => ({ fileUrl: version.fileUrl }))
      },
      async findFirst({ where }) {
        const document = documents.find(
          (item) => item.id === where.documentId && item.userId === where.document.userId,
        )
        const version = document?.versions.find((item) => item.version === where.version)
        if (!document || !version) {
          return null
        }
        return { fileUrl: version.fileUrl, document: { name: document.name } }
      },
      async count({ where }) {
        await tick()
        return documents.find((item) => item.id === where.documentId)?.versions.length ?? 0
      },
      async aggregate({ where, _sum }) {
        await tick()
        if ('document' in where) {
          const total = ownedVersions(where.document.userId).reduce(
            (sum, item) => sum + item.sizeBytes,
            0n,
          )
          return _sum ? { _sum: { sizeBytes: total } } : {}
        }
        const document = documents.find((item) => item.id === where.documentId)
        const version = document?.versions.reduce(
          (max, item) => Math.max(max, item.version),
          0,
        )
        return { _max: { version: version && version > 0 ? version : null } }
      },
      async create({ data }) {
        await tick()
        const document = documents.find((item) => item.id === data.documentId)
        if (!document) {
          throw Object.assign(new Error('missing document'), { code: 'P2003' })
        }
        if (document.versions.some((item) => item.version === data.version)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        const version: MemoryVersion = {
          id: nextId('version'),
          documentId: data.documentId,
          version: data.version,
          fileUrl: data.fileUrl,
          sizeBytes: data.sizeBytes,
          createdAt: new Date(),
        }
        document.versions.push(version)
        return version
      },
    },
    /** Models the Postgres row lock: a second locker for the same user waits until the first transaction ends. */
    async $transaction(run) {
      const releases: Array<() => void> = []
      const tx = {
        document: db.document,
        documentVersion: db.documentVersion,
        async $queryRaw(_query: TemplateStringsArray, ...values: unknown[]) {
          const userId = String(values[0])
          const previous = userLocks.get(userId) ?? Promise.resolve()
          let release: () => void = () => undefined
          const held = new Promise<void>((resolve) => {
            release = resolve
          })
          userLocks.set(userId, previous.then(() => held))
          await previous
          releases.push(release)
          quotaLocks.push(userId)
          return []
        },
      }
      try {
        return await run(tx)
      } finally {
        for (const release of releases) {
          release()
        }
      }
    },
  }

  return db
}

function remember(db: { documents: MemoryDocument[] }) {
  for (const document of db.documents) {
    for (const version of document.versions) {
      const filePath = resolveStoredFile(version.fileUrl)
      if (filePath) {
        createdFiles.push(filePath)
      }
    }
  }
}

async function listen(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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
