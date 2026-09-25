import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AuthIdentity } from './authIdentity.js'

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

export async function verifyAuthorizationHeader(
  header: string | undefined,
): Promise<AuthIdentity | null> {
  const token = bearerToken(header)
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim()
  if (!token || !baseUrl) {
    return null
  }

  let issuer: string
  let jwksUrl: string
  try {
    const url = new URL(baseUrl)
    issuer = url.origin
    const path = url.pathname.replace(/\/$/, '')
    jwksUrl = `${url.origin}${path}/.well-known/jwks.json`
  } catch {
    return null
  }

  jwks ??= createRemoteJWKSet(new URL(jwksUrl))

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: issuer,
    })
    return identityFromPayload(payload)
  } catch {
    return null
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null
  }
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header)
  return match?.[1] ?? null
}

function identityFromPayload(payload: JWTPayload): AuthIdentity | null {
  if (payload.banned === true) {
    return null
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    return null
  }
  if (typeof payload.email !== 'string') {
    return null
  }
  const email = payload.email.trim().toLowerCase()
  if (email.length === 0 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null
  }
  return { authUserId: payload.sub, email }
}
