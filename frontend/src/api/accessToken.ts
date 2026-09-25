let provider: (() => Promise<string | null>) | null = null
let onUnauthorized: (() => void) | null = null

export function setAccessTokenProvider(next: (() => Promise<string | null>) | null) {
  provider = next
}

export function setUnauthorizedHandler(next: (() => void) | null) {
  onUnauthorized = next
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Sign in again.')
    this.name = 'SessionExpiredError'
  }
}

export async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = provider ? await provider() : null
  if (!token) {
    throw new SessionExpiredError()
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  if (response.status === 401) {
    onUnauthorized?.()
    throw new SessionExpiredError()
  }
  return response
}
