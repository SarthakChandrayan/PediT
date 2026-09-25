import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth.ts'

export function AuthScreen() {
  const auth = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'sign-up') {
      void auth.signUp(email, password)
      return
    }
    void auth.signIn(email, password)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <img className="app-header__logo" src="/mainlogo.png" alt="PeDit" />
        </div>
      </header>
      <main className="workspace">
        <div className="empty">
          <form className="empty__panel auth-panel" onSubmit={handleSubmit}>
            <img className="empty__logo" src="/logo.png" alt="" />
            <h1>{mode === 'sign-up' ? 'Create your PeDit account' : 'Sign in to PeDit'}</h1>
            <p>
              {auth.configured
                ? 'Your PDFs stay with the account that uploads them.'
                : 'Sign-in is not configured. Set VITE_NEON_AUTH_URL and restart the app.'}
            </p>
            {auth.status === 'loading' ? <p>Checking your session…</p> : null}
            {auth.error ? (
              <p className="banner auth-panel__error" role="alert">
                {auth.error}
              </p>
            ) : null}
            <label className="auth-panel__field">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                required
                disabled={!auth.configured || auth.pending || auth.status === 'loading'}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="auth-panel__field">
              Password
              <input
                type="password"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                value={password}
                required
                minLength={8}
                disabled={!auth.configured || auth.pending || auth.status === 'loading'}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="button button--primary auth-panel__submit"
              disabled={!auth.configured || auth.pending || auth.status === 'loading'}
            >
              {auth.pending ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={auth.pending}
              onClick={() => {
                setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))
              }}
            >
              {mode === 'sign-up' ? 'Already have an account? Sign in' : 'Need an account? Create one'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
