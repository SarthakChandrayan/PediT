import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuth } from './useAuth.ts'

type AuthView =
  | 'sign-in'
  | 'sign-up'
  | 'verify-email'
  | 'otp-sign-in'
  | 'forgot-password'
  | 'reset-password'

export function AuthScreen() {
  const auth = useAuth()
  const [view, setView] = useState<AuthView>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const busy = !auth.configured || auth.pending || auth.status === 'loading'

  useEffect(() => {
    if (resendCooldown <= 0) {
      return
    }
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  function switchView(next: AuthView) {
    auth.clearError()
    setInfo(null)
    setOtp('')
    if (next === 'sign-in' || next === 'sign-up' || next === 'otp-sign-in') {
      setPassword('')
      setConfirmPassword('')
    }
    setView(next)
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInfo(null)
    if (view === 'sign-up') {
      const result = await auth.signUp(email, password)
      if (result === 'needs-verification') {
        setInfo(`Enter the 6-digit code sent to ${email.trim()}.`)
        setOtp('')
        setView('verify-email')
        setResendCooldown(60)
      }
      return
    }
    const result = await auth.signIn(email, password)
    if (result === 'needs-verification') {
      setInfo(`Enter the 6-digit code sent to ${email.trim()}.`)
      setOtp('')
      setView('verify-email')
      setResendCooldown(60)
    }
  }

  async function handleVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInfo(null)
    await auth.verifyEmail(email, otp, password || undefined)
  }

  async function handleSendSignInOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInfo(null)
    const sent = await auth.sendSignInOtp(email)
    if (sent) {
      setInfo(`Enter the 6-digit code sent to ${email.trim()}.`)
      setOtp('')
      setResendCooldown(60)
    }
  }

  async function handleConfirmSignInOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInfo(null)
    await auth.signInWithOtp(email, otp)
  }

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInfo(null)
    const sent = await auth.requestPasswordReset(email)
    if (sent) {
      setInfo(`Enter the reset code sent to ${email.trim()}, then choose a new password.`)
      setOtp('')
      setPassword('')
      setConfirmPassword('')
      setView('reset-password')
      setResendCooldown(60)
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInfo(null)
    if (password !== confirmPassword) {
      setInfo('Passwords do not match.')
      return
    }
    const ok = await auth.resetPassword(email, otp, password)
    if (ok) {
      setPassword('')
      setConfirmPassword('')
      setOtp('')
      setInfo('Password updated. Sign in with your new password.')
      setView('sign-in')
    }
  }

  const title =
    view === 'sign-up'
      ? 'Create your PeDit account'
      : view === 'verify-email'
        ? 'Verify your email'
        : view === 'otp-sign-in'
          ? 'Sign in with email code'
          : view === 'forgot-password'
            ? 'Reset your password'
            : view === 'reset-password'
              ? 'Choose a new password'
              : 'Sign in to PeDit'

  const subtitle = !auth.configured
    ? 'Sign-in is not configured. Set VITE_NEON_AUTH_URL and restart the app.'
    : view === 'verify-email'
      ? 'We sent a one-time code to confirm this email belongs to you.'
      : view === 'otp-sign-in'
        ? 'We’ll email you a one-time code. No password needed.'
        : view === 'forgot-password'
          ? 'Enter your account email and we’ll send a reset code.'
          : view === 'reset-password'
            ? 'Use the code from your inbox with a new password.'
            : 'Your PDFs stay with the account that uploads them.'

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <img className="app-header__logo" src="/mainlogo.png" alt="PeDit" />
        </div>
      </header>
      <main className="workspace">
        <div className="empty">
          <div className="empty__panel auth-panel">
            <img className="empty__logo" src="/logo.png" alt="" />
            <h1>{title}</h1>
            <p>{subtitle}</p>
            {auth.status === 'loading' ? <p>Checking your session…</p> : null}
            {auth.error ? (
              <p className="banner auth-panel__error" role="alert">
                {auth.error}
              </p>
            ) : null}
            {info ? <p className="auth-panel__info">{info}</p> : null}

            {view === 'sign-in' || view === 'sign-up' ? (
              <>
                <button
                  type="button"
                  className="button button--secondary auth-panel__google"
                  disabled={busy}
                  onClick={() => {
                    void auth.signInWithGoogle()
                  }}
                >
                  Continue with Google
                </button>
                <div className="auth-panel__divider" aria-hidden="true">
                  <span>or</span>
                </div>
                <form className="auth-panel__form" onSubmit={handlePasswordSubmit}>
                  <label className="auth-panel__field">
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      required
                      disabled={busy}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label className="auth-panel__field">
                    Password
                    <input
                      type="password"
                      autoComplete={view === 'sign-up' ? 'new-password' : 'current-password'}
                      value={password}
                      required
                      minLength={8}
                      disabled={busy}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="button button--primary auth-panel__submit" disabled={busy}>
                    {auth.pending ? 'Please wait…' : view === 'sign-up' ? 'Create account' : 'Sign in'}
                  </button>
                </form>
                {view === 'sign-in' ? (
                  <div className="auth-panel__links">
                    <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('forgot-password')}>
                      Forgot password?
                    </button>
                    <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('otp-sign-in')}>
                      Sign in with email code
                    </button>
                    <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('sign-up')}>
                      Need an account? Create one
                    </button>
                  </div>
                ) : (
                  <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('sign-in')}>
                    Already have an account? Sign in
                  </button>
                )}
              </>
            ) : null}

            {view === 'verify-email' ? (
              <form className="auth-panel__form" onSubmit={handleVerifyEmail}>
                <p className="auth-panel__muted">Code sent to {email.trim()}</p>
                <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                <button type="submit" className="button button--primary auth-panel__submit" disabled={busy || otp.length < 6}>
                  {auth.pending ? 'Please wait…' : 'Verify email'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy || resendCooldown > 0}
                  onClick={() => {
                    void auth.resendVerificationOtp(email).then((sent) => {
                      if (sent) {
                        setInfo('A new code is on the way.')
                        setResendCooldown(60)
                      }
                    })
                  }}
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </button>
                <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('sign-in')}>
                  Back to sign in
                </button>
              </form>
            ) : null}

            {view === 'otp-sign-in' ? (
              <form
                className="auth-panel__form"
                onSubmit={info || otp.length > 0 ? handleConfirmSignInOtp : handleSendSignInOtp}
              >
                <label className="auth-panel__field">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                {info || otp.length > 0 ? (
                  <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                ) : null}
                <button
                  type="submit"
                  className="button button--primary auth-panel__submit"
                  disabled={busy || ((info || otp.length > 0) && otp.length < 6)}
                >
                  {auth.pending
                    ? 'Please wait…'
                    : info || otp.length > 0
                      ? 'Sign in'
                      : 'Send code'}
                </button>
                {info || otp.length > 0 ? (
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={busy || resendCooldown > 0}
                    onClick={() => {
                      void auth.sendSignInOtp(email).then((sent) => {
                        if (sent) {
                          setInfo(`Enter the 6-digit code sent to ${email.trim()}.`)
                          setResendCooldown(60)
                        }
                      })
                    }}
                  >
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </button>
                ) : null}
                <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('sign-in')}>
                  Back to password sign in
                </button>
              </form>
            ) : null}

            {view === 'forgot-password' ? (
              <form className="auth-panel__form" onSubmit={handleForgotPassword}>
                <label className="auth-panel__field">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <button type="submit" className="button button--primary auth-panel__submit" disabled={busy}>
                  {auth.pending ? 'Please wait…' : 'Send reset code'}
                </button>
                <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('sign-in')}>
                  Back to sign in
                </button>
              </form>
            ) : null}

            {view === 'reset-password' ? (
              <form className="auth-panel__form" onSubmit={handleResetPassword}>
                <p className="auth-panel__muted">Resetting password for {email.trim()}</p>
                <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                <label className="auth-panel__field">
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    required
                    minLength={8}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label className="auth-panel__field">
                  Confirm password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    required
                    minLength={8}
                    disabled={busy}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
                <button type="submit" className="button button--primary auth-panel__submit" disabled={busy || otp.length < 6}>
                  {auth.pending ? 'Please wait…' : 'Update password'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy || resendCooldown > 0}
                  onClick={() => {
                    void auth.requestPasswordReset(email).then((sent) => {
                      if (sent) {
                        setInfo('A new reset code is on the way.')
                        setResendCooldown(60)
                      }
                    })
                  }}
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </button>
                <button type="button" className="button button--ghost" disabled={auth.pending} onClick={() => switchView('sign-in')}>
                  Back to sign in
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}

function OtpInput({
  value,
  onChange,
  disabled,
  length = 6,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  length?: number
}) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length }, (_, index) => value[index] ?? '')

  function focusInput(index: number) {
    inputsRef.current[index]?.focus()
  }

  function updateDigit(index: number, char: string) {
    if (!/^\d?$/.test(char)) {
      return
    }
    const next = [...digits]
    next[index] = char
    onChange(next.join(''))
    if (char && index < length - 1) {
      focusInput(index + 1)
    }
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault()
      const next = [...digits]
      next[index - 1] = ''
      onChange(next.join(''))
      focusInput(index - 1)
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      focusInput(index - 1)
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault()
      focusInput(index + 1)
    }
  }

  return (
    <div className="auth-panel__otp" role="group" aria-label="One-time code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            inputsRef.current[index] = node
          }}
          className="auth-panel__otp-digit"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          onChange={(event) => updateDigit(index, event.target.value.slice(-1))}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => {
            event.preventDefault()
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
            if (!pasted) {
              return
            }
            onChange(pasted)
            focusInput(Math.min(pasted.length, length - 1))
          }}
        />
      ))}
    </div>
  )
}
