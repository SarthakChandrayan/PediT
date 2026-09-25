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
