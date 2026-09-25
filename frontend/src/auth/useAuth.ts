import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context.ts'

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }
  return value
}

export type { AuthContextValue }
