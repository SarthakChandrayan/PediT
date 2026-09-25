import { createContext } from 'react'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export type AuthContextValue = {
  configured: boolean
  status: AuthStatus
  email: string | null
  error: string | null
  pending: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
