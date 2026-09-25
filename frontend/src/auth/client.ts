import { createAuthClient } from '@neondatabase/neon-js/auth'
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js/auth/vanilla/adapters'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL

export const authConfigured = typeof authUrl === 'string' && authUrl.length > 0

export const authClient = authConfigured
  ? createAuthClient(authUrl, {
      adapter: BetterAuthVanillaAdapter({
        fetchOptions: {
          credentials: 'include',
        },
      }),
    })
  : null

type AuthResult<T = unknown> = Promise<{ data: T; error: { message?: string } | null }>

/** Runtime email-otp plugin methods are present but missing from SDK typings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pluginClient = authClient as any

export type OtpType = 'email-verification' | 'sign-in' | 'forget-password'

export const emailOtpApi = {
  sendVerificationOtp(email: string, type: OtpType): AuthResult {
    return pluginClient.emailOtp.sendVerificationOtp({ email, type })
  },
  verifyEmail(email: string, otp: string): AuthResult {
    return pluginClient.emailOtp.verifyEmail({ email, otp })
  },
  resetPassword(email: string, otp: string, password: string): AuthResult {
    return pluginClient.emailOtp.resetPassword({ email, otp, password })
  },
  forgetPassword(email: string): AuthResult {
    return pluginClient.forgetPassword.emailOtp({ email })
  },
  signInWithOtp(email: string, otp: string): AuthResult {
    return pluginClient.signIn.emailOtp({ email, otp })
  },
}

export function signInWithGoogle(callbackURL: string): AuthResult {
  return pluginClient.signIn.social({
    provider: 'google',
    callbackURL,
  })
}
