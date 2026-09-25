import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/accessToken.ts'
import { AuthContext, type AuthContextValue, type AuthStatus, type SignInResult } from './auth-context.ts'
import { authClient, authConfigured, emailOtpApi, signInWithGoogle as startGoogleSignIn } from './client.ts'

const OPEN_DOCUMENT_KEY = 'pdfforge.openDocument'
const EMAIL_NOT_VERIFIED_RE = /email.*(not|isn['’]?t)\s*verified/i

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

function errorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message?.trim() || fallback
}

function sessionUser(result: Awaited<ReturnType<NonNullable<typeof authClient>['getSession']>>) {
  const user = result.data?.user
  if (!result.data?.session || !user?.email) {
    return null
  }
  return user
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(authConfigured ? 'loading' : 'anonymous')
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function markAuthenticated(nextEmail: string) {
    setEmail(nextEmail)
    setStatus('authenticated')
    setError(null)
  }

  function markAnonymous() {
    setEmail(null)
    setStatus('anonymous')
  }

  async function refreshSession(): Promise<boolean> {
    if (!authClient) {
      markAnonymous()
      return false
    }
    const result = await authClient.getSession()
    const user = sessionUser(result)
    if (user && user.emailVerified) {
      markAuthenticated(user.email)
      return true
    }
    markAnonymous()
    return false
  }

  useEffect(() => {
    if (!authClient) {
      return
    }

    let cancelled = false
    void authClient
      .getSession()
      .then((result) => {
        if (cancelled) {
          return
        }
        const user = sessionUser(result)
        if (user && user.emailVerified) {
          markAuthenticated(user.email)
          return
        }
        markAnonymous()
      })
      .catch(() => {
        if (!cancelled) {
          markAnonymous()
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
      markAnonymous()
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
      clearError() {
        setError(null)
      },
      async signIn(nextEmail, password): Promise<SignInResult> {
        if (!authClient) {
          setError('Sign-in is not configured.')
          return 'failed'
        }
        setPending(true)
        setError(null)
        const trimmed = nextEmail.trim()
        try {
          const result = await authClient.signIn.email({
            email: trimmed,
            password,
          })
          if (result.error) {
            if (EMAIL_NOT_VERIFIED_RE.test(result.error.message || '')) {
              const otpResult = await emailOtpApi.sendVerificationOtp(trimmed, 'email-verification')
              if (otpResult.error) {
                setError(errorMessage(otpResult.error, 'Could not send a verification code.'))
                return 'failed'
              }
              return 'needs-verification'
            }
            setError(errorMessage(result.error, 'Sign-in failed.'))
            return 'failed'
          }
          const user = result.data?.user
          if (user && !user.emailVerified) {
            const otpResult = await emailOtpApi.sendVerificationOtp(trimmed, 'email-verification')
            if (otpResult.error) {
              setError(errorMessage(otpResult.error, 'Could not send a verification code.'))
              return 'failed'
            }
            return 'needs-verification'
          }
          const sessionEmail = user?.email ?? trimmed
          markAuthenticated(sessionEmail)
          return 'authenticated'
        } catch {
          setError('The sign-in service is unavailable.')
          return 'failed'
        } finally {
          setPending(false)
        }
      },
      async signUp(nextEmail, password) {
        if (!authClient) {
          setError('Sign-up is not configured.')
          return 'failed'
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
            setError(errorMessage(result.error, 'Sign-up failed.'))
            return 'failed'
          }
          return 'needs-verification'
        } catch {
          setError('The sign-in service is unavailable.')
          return 'failed'
        } finally {
          setPending(false)
        }
      },
      async verifyEmail(nextEmail, otp, password) {
        if (!authClient) {
          setError('Sign-in is not configured.')
          return false
        }
        setPending(true)
        setError(null)
        const trimmed = nextEmail.trim()
        try {
          const result = await emailOtpApi.verifyEmail(trimmed, otp.trim())
          if (result.error) {
            setError(errorMessage(result.error, 'Invalid verification code.'))
            return false
          }
          if (await refreshSession()) {
            return true
          }
          if (password) {
            const signInResult = await authClient.signIn.email({
              email: trimmed,
              password,
            })
            if (signInResult.error) {
              setError(errorMessage(signInResult.error, 'Email verified. Sign in again.'))
              return false
            }
            const sessionEmail = signInResult.data?.user?.email ?? trimmed
            markAuthenticated(sessionEmail)
            return true
          }
          setError('Email verified. Sign in to continue.')
          return false
        } catch {
          setError('The sign-in service is unavailable.')
          return false
        } finally {
          setPending(false)
        }
      },
      async resendVerificationOtp(nextEmail) {
        setPending(true)
        setError(null)
        try {
          const result = await emailOtpApi.sendVerificationOtp(nextEmail.trim(), 'email-verification')
          if (result.error) {
            setError(errorMessage(result.error, 'Could not resend the code.'))
            return false
          }
          return true
        } catch {
          setError('The sign-in service is unavailable.')
          return false
        } finally {
          setPending(false)
        }
      },
      async sendSignInOtp(nextEmail) {
        setPending(true)
        setError(null)
        try {
          const result = await emailOtpApi.sendVerificationOtp(nextEmail.trim(), 'sign-in')
          if (result.error) {
            setError(errorMessage(result.error, 'Could not send a sign-in code.'))
            return false
          }
          return true
        } catch {
          setError('The sign-in service is unavailable.')
          return false
        } finally {
          setPending(false)
        }
      },
      async signInWithOtp(nextEmail, otp) {
        setPending(true)
        setError(null)
        const trimmed = nextEmail.trim()
        try {
          const result = await emailOtpApi.signInWithOtp(trimmed, otp.trim())
          if (result.error) {
            setError(errorMessage(result.error, 'Invalid sign-in code.'))
            return false
          }
          if (!(await refreshSession())) {
            const sessionEmail =
              result.data &&
              typeof result.data === 'object' &&
              'user' in result.data &&
              result.data.user &&
              typeof result.data.user === 'object' &&
              'email' in result.data.user &&
              typeof result.data.user.email === 'string'
                ? result.data.user.email
                : trimmed
            markAuthenticated(sessionEmail)
          }
          return true
        } catch {
          setError('The sign-in service is unavailable.')
          return false
        } finally {
          setPending(false)
        }
      },
      async requestPasswordReset(nextEmail) {
        setPending(true)
        setError(null)
        try {
          const result = await emailOtpApi.forgetPassword(nextEmail.trim())
          if (result.error) {
            setError(errorMessage(result.error, 'Could not send a reset code.'))
            return false
          }
          return true
        } catch {
          setError('The sign-in service is unavailable.')
          return false
        } finally {
          setPending(false)
        }
      },
      async resetPassword(nextEmail, otp, password) {
        setPending(true)
        setError(null)
        try {
          const result = await emailOtpApi.resetPassword(nextEmail.trim(), otp.trim(), password)
          if (result.error) {
            setError(errorMessage(result.error, 'Could not reset the password.'))
            return false
          }
          return true
        } catch {
          setError('The sign-in service is unavailable.')
          return false
        } finally {
          setPending(false)
        }
      },
      async signInWithGoogle() {
        if (!authClient) {
          setError('Sign-in is not configured.')
          return
        }
        setPending(true)
        setError(null)
        try {
          const result = await startGoogleSignIn(window.location.origin)
          if (result.error) {
            setError(errorMessage(result.error, 'Google sign-in failed.'))
          }
        } catch {
          setError('Google sign-in is unavailable.')
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
          markAnonymous()
          setPending(false)
        }
      },
    }
  }, [email, error, pending, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
