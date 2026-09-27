import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, describe, it } from 'node:test'
import type { Express } from 'express'
import { createApp, type CreateAppOptions } from '../src/app.js'
import type { ApplicationUser, AuthIdentity } from '../src/lib/authIdentity.js'
import type { DocumentsDb } from '../src/lib/documentsDb.js'
import { resolveApplicationUser } from '../src/lib/resolveUser.js'
import { removeStoredFile, resolveStoredFile } from '../src/lib/documentStorage.js'
import type { PdfStorage } from '../src/lib/pdfStorage.js'
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
      const created = await postPdf(baseUrl, 'a', 'owned.pdf', pdfBytes('owned'), {
        email: USER_B.email,
        userId: 'client-supplied-user',
      })
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
        await db.documentVersion.create({ data: { documentId: id, version: 2, fileUrl: lateKey } })
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
  createdAt: Date
}
type MemoryDocument = {
  id: string
  userId: string
  name: string
  createdAt: Date
  versions: MemoryVersion[]
}

function memoryDb(): DocumentsDb & { users: MemoryUser[]; documents: MemoryDocument[] } {
  const users: MemoryUser[] = []
  const documents: MemoryDocument[] = []
  let sequence = 0
  const nextId = (prefix: string) => {
    sequence += 1
    return `${prefix}-${sequence}`
  }

  const db: DocumentsDb & { users: MemoryUser[]; documents: MemoryDocument[] } = {
    users,
    documents,
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
        const version: MemoryVersion = {
          id: nextId('version'),
          documentId: '',
          version: data.versions.create.version,
          fileUrl: data.versions.create.fileUrl,
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
      async findMany({ where }) {
        return documents
          .filter((item) => item.userId === where.userId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
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
            versions: [...document.versions].sort((left, right) => right.version - left.version),
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
      async aggregate({ where }) {
        const document = documents.find((item) => item.id === where.documentId)
        const version = document?.versions.reduce(
          (max, item) => Math.max(max, item.version),
          0,
        )
        return { _max: { version: version && version > 0 ? version : null } }
      },
      async create({ data }) {
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
          createdAt: new Date(),
        }
        document.versions.push(version)
        return version
      },
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
