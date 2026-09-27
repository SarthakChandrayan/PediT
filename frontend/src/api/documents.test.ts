import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionExpiredError, setAccessTokenProvider } from './accessToken.ts'
import { DOCUMENTS_URL, deleteDocument } from './documents.ts'

describe('deleteDocument', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    setAccessTokenProvider(() => Promise.resolve('token-123'))
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    setAccessTokenProvider(null)
  })

  it('sends an authorized DELETE for the encoded document id', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await deleteDocument('doc/1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${DOCUMENTS_URL}/doc%2F1`)
    expect(init?.method).toBe('DELETE')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-123')
  })

  it('treats a document that is already gone as deleted', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Document not found.' }, { status: 404 }))

    await expect(deleteDocument('doc-1')).resolves.toBeUndefined()
  })

  it('reports a failed deletion', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'x' }, { status: 500 }))

    await expect(deleteDocument('doc-1')).rejects.toThrow('The document could not be deleted. Try again.')
  })

  it('reports rate limiting', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'x' }, { status: 429 }))

    await expect(deleteDocument('doc-1')).rejects.toThrow('Too many requests.')
  })

  it('reports an unreachable server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(deleteDocument('doc-1')).rejects.toThrow('The server is unavailable.')
  })

  it('requires a signed-in session', async () => {
    setAccessTokenProvider(() => Promise.resolve(null))

    await expect(deleteDocument('doc-1')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
