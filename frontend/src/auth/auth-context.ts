import { createContext } from 'react'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export type SignInResult = 'authenticated' | 'needs-verification' | 'failed'
export type SignUpResult = 'needs-verification' | 'failed'

export type AuthContextValue = {
  configured: boolean
  status: AuthStatus
  email: string | null
  error: string | null
  pending: boolean
  clearError: () => void
  signIn: (email: string, password: string) => Promise<SignInResult>
  signUp: (email: string, password: string) => Promise<SignUpResult>
  verifyEmail: (email: string, otp: string, password?: string) => Promise<boolean>
  resendVerificationOtp: (email: string) => Promise<boolean>
  sendSignInOtp: (email: string) => Promise<boolean>
  signInWithOtp: (email: string, otp: string) => Promise<boolean>
  requestPasswordReset: (email: string) => Promise<boolean>
  resetPassword: (email: string, otp: string, password: string) => Promise<boolean>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
