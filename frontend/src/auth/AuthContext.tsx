import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/accessToken.ts'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context.ts'
import { authClient, authConfigured } from './client.ts'

const OPEN_DOCUMENT_KEY = 'pdfforge.openDocument'

async function readAccessToken(): Promise<string | null> {
  if (!authClient) {
    return null
  }
  const result = await authClient.token()
  if (result.error) {
    return null
  }
  return jwtFromAuthResult(result.data)
}

function jwtFromAuthResult(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  if ('token' in data && isJwt(data.token)) {
    return data.token
  }
  if (
    'session' in data &&
    typeof data.session === 'object' &&
    data.session !== null &&
    'token' in data.session &&
    isJwt(data.session.token)
  ) {
    return data.session.token
  }
  return null
}

function isJwt(value: unknown): value is string {
  return typeof value === 'string' && value.split('.').length === 3
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(authConfigured ? 'loading' : 'anonymous')
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!authClient) {
      return
    }

    let cancelled = false
    void authClient.getSession().then((result) => {
      if (cancelled) {
        return
      }
      const sessionEmail = result.data?.user?.email
      if (result.data?.session && sessionEmail) {
        setEmail(sessionEmail)
        setStatus('authenticated')
        return
      }
      setEmail(null)
      setStatus('anonymous')
    }).catch(() => {
      if (!cancelled) {
        setEmail(null)
        setStatus('anonymous')
        setError('The sign-in service is unavailable.')
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (authClient && status === 'authenticated') {
    setAccessTokenProvider(readAccessToken)
    setUnauthorizedHandler(() => {
      sessionStorage.removeItem(OPEN_DOCUMENT_KEY)
      setEmail(null)
      setStatus('anonymous')
    })
  } else if (status !== 'loading') {
    setAccessTokenProvider(null)
    setUnauthorizedHandler(null)
  }

  const value = useMemo<AuthContextValue>(() => {
    return {
      configured: authConfigured,
      status,
      email,
      error,
      pending,
      async signIn(nextEmail, password) {
        if (!authClient) {
          setError('Sign-in is not configured.')
          return
        }
        setPending(true)
        setError(null)
        try {
          const result = await authClient.signIn.email({
            email: nextEmail.trim(),
            password,
          })
          if (result.error) {
            setError(result.error.message || 'Sign-in failed.')
            return
          }
          const sessionEmail = result.data?.user?.email ?? nextEmail.trim()
          setEmail(sessionEmail)
          setStatus('authenticated')
        } catch {
          setError('The sign-in service is unavailable.')
        } finally {
          setPending(false)
        }
      },
      async signUp(nextEmail, password) {
        if (!authClient) {
          setError('Sign-up is not configured.')
          return
        }
        setPending(true)
        setError(null)
        const trimmed = nextEmail.trim()
        try {
          const result = await authClient.signUp.email({
            email: trimmed,
            password,
            name: trimmed.split('@')[0] || 'User',
          })
          if (result.error) {
            setError(result.error.message || 'Sign-up failed.')
            return
          }
          const sessionEmail = result.data?.user?.email ?? trimmed
          setEmail(sessionEmail)
          setStatus('authenticated')
        } catch {
          setError('The sign-in service is unavailable.')
        } finally {
          setPending(false)
        }
      },
      async signOut() {
        setPending(true)
        setError(null)
        try {
          if (authClient) {
            await authClient.signOut()
          }
        } catch {
          setError('Sign-out could not reach the sign-in service.')
        } finally {
          sessionStorage.removeItem(OPEN_DOCUMENT_KEY)
          setEmail(null)
          setStatus('anonymous')
          setPending(false)
        }
      },
    }
  }, [email, error, pending, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
