import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, describe, it } from 'node:test'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import type { ApplicationUser, AuthIdentity } from '../src/lib/authIdentity.js'
import type { DocumentsDb } from '../src/lib/documentsDb.js'
import { resolveApplicationUser } from '../src/lib/resolveUser.js'
import { removeStoredFile, resolveStoredFile } from '../src/lib/documentStorage.js'
import { createMemoryPdfStorage } from './memoryPdfStorage.js'

const PDF_MIME_TYPE = 'application/pdf'
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

function appFor(db: DocumentsDb): Express {
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
    },
    documentVersion: {
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
