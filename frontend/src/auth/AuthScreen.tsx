import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Banner } from '../components/Banner.tsx'
import { AppBrand } from '../components/EditorHeader.tsx'
import { BrandMark, Icon } from '../components/icons.tsx'
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
  const busy = !auth.configured || auth.pending

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
      ? 'Create your account'
      : view === 'verify-email'
        ? 'Check your email'
        : view === 'otp-sign-in'
          ? 'Sign in with a code'
          : view === 'forgot-password'
            ? 'Reset your password'
            : view === 'reset-password'
              ? 'Choose a new password'
              : 'Sign in to PeDit'

  const subtitle = !auth.configured
    ? null
    : view === 'sign-up'
      ? 'Upload, mark up and sign PDFs. Every save is kept as a version.'
      : view === 'verify-email'
        ? 'We sent a 6-digit code to confirm this address is yours.'
        : view === 'otp-sign-in'
          ? 'We’ll email you a one-time code — no password needed.'
          : view === 'forgot-password'
            ? 'Enter your account email and we’ll send a reset code.'
            : view === 'reset-password'
              ? 'Enter the code from your inbox and a new password.'
              : 'Welcome back. Your documents are where you left them.'

  const codeSent = info !== null || otp.length > 0

  return (
    <div className="auth">
      <main className="auth__main">
        <div className="auth__brand">
          <AppBrand />
        </div>
        <div className="auth__form-wrap">
          <div className="auth__form">
            <h1 className="auth__title">{title}</h1>
            {subtitle ? <p className="auth__subtitle">{subtitle}</p> : null}
            {!auth.configured ? (
              <p className="auth__info auth__info--warning" role="alert">
                <Icon name="alert" size={14} />
                Sign-in is not configured. Set VITE_NEON_AUTH_URL and restart the app.
              </p>
            ) : null}
            {auth.error ? (
              <Banner className="auth__notice" message={auth.error} onDismiss={auth.clearError} />
            ) : null}
            {info ? (
              <p className="auth__info" role="status">
                <Icon name="mail" size={14} />
                {info}
              </p>
            ) : null}

            {view === 'sign-in' || view === 'sign-up' ? (
              <>
                <button
                  type="button"
                  className="button button--secondary button--lg button--block"
                  disabled={busy}
                  onClick={() => {
                    void auth.signInWithGoogle()
                  }}
                >
                  <GoogleMark />
                  Continue with Google
                </button>
                <div className="auth__divider" aria-hidden="true">
                  <span>or</span>
                </div>
                <form className="auth__fields" onSubmit={handlePasswordSubmit}>
                  <Field label="Email">
                    <EmailInput value={email} disabled={busy} onChange={setEmail} />
                  </Field>
                  <PasswordField
                    label="Password"
                    value={password}
                    disabled={busy}
                    autoComplete={view === 'sign-up' ? 'new-password' : 'current-password'}
                    hint={view === 'sign-up' ? 'At least 8 characters.' : undefined}
                    action={
                      view === 'sign-in' ? (
                        <button
                          type="button"
                          className="link-button"
                          disabled={auth.pending}
                          onClick={() => switchView('forgot-password')}
                        >
                          Forgot password?
                        </button>
                      ) : null
                    }
                    onChange={setPassword}
                  />
                  <SubmitButton pending={auth.pending} disabled={busy}>
                    {view === 'sign-up' ? 'Create account' : 'Sign in'}
                  </SubmitButton>
                </form>
                {view === 'sign-in' ? (
                  <button
                    type="button"
                    className="link-button auth__alt"
                    disabled={auth.pending}
                    onClick={() => switchView('otp-sign-in')}
                  >
                    Email me a sign-in code instead
                  </button>
                ) : null}
                <p className="auth__switch">
                  {view === 'sign-in' ? 'New to PeDit?' : 'Already have an account?'}{' '}
                  <button
                    type="button"
                    className="link-button"
                    disabled={auth.pending}
                    onClick={() => switchView(view === 'sign-in' ? 'sign-up' : 'sign-in')}
                  >
                    {view === 'sign-in' ? 'Create an account' : 'Sign in'}
                  </button>
                </p>
              </>
            ) : null}

            {view === 'verify-email' ? (
              <form className="auth__fields" onSubmit={handleVerifyEmail}>
                <div className="field">
                  <span className="field__label">
                    Code sent to <strong>{email.trim()}</strong>
                  </span>
                  <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                </div>
                <SubmitButton pending={auth.pending} disabled={busy || otp.length < 6}>
                  Verify email
                </SubmitButton>
                <div className="auth__row">
                  <ResendButton
                    cooldown={resendCooldown}
                    disabled={busy}
                    onResend={() => {
                      void auth.resendVerificationOtp(email).then((sent) => {
                        if (sent) {
                          setInfo('A new code is on the way.')
                          setResendCooldown(60)
                        }
                      })
                    }}
                  />
                  <BackButton disabled={auth.pending} onBack={() => switchView('sign-in')} />
                </div>
              </form>
            ) : null}

            {view === 'otp-sign-in' ? (
              <form
                className="auth__fields"
                onSubmit={codeSent ? handleConfirmSignInOtp : handleSendSignInOtp}
              >
                <Field label="Email">
                  <EmailInput value={email} disabled={busy} onChange={setEmail} />
                </Field>
                {codeSent ? (
                  <div className="field">
                    <span className="field__label">6-digit code</span>
                    <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                  </div>
                ) : null}
                <SubmitButton pending={auth.pending} disabled={busy || (codeSent && otp.length < 6)}>
                  {codeSent ? 'Sign in' : 'Send code'}
                </SubmitButton>
                <div className="auth__row">
                  {codeSent ? (
                    <ResendButton
                      cooldown={resendCooldown}
                      disabled={busy}
                      onResend={() => {
                        void auth.sendSignInOtp(email).then((sent) => {
                          if (sent) {
                            setInfo(`Enter the 6-digit code sent to ${email.trim()}.`)
                            setResendCooldown(60)
                          }
                        })
                      }}
                    />
                  ) : (
                    <span />
                  )}
                  <BackButton
                    label="Use password instead"
                    disabled={auth.pending}
                    onBack={() => switchView('sign-in')}
                  />
                </div>
              </form>
            ) : null}

            {view === 'forgot-password' ? (
              <form className="auth__fields" onSubmit={handleForgotPassword}>
                <Field label="Email">
                  <EmailInput value={email} disabled={busy} onChange={setEmail} />
                </Field>
                <SubmitButton pending={auth.pending} disabled={busy}>
                  Send reset code
                </SubmitButton>
                <div className="auth__row auth__row--end">
                  <BackButton disabled={auth.pending} onBack={() => switchView('sign-in')} />
                </div>
              </form>
            ) : null}

            {view === 'reset-password' ? (
              <form className="auth__fields" onSubmit={handleResetPassword}>
                <div className="field">
                  <span className="field__label">
                    Reset code for <strong>{email.trim()}</strong>
                  </span>
                  <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                </div>
                <PasswordField
                  label="New password"
                  value={password}
                  disabled={busy}
                  autoComplete="new-password"
                  hint="At least 8 characters."
                  onChange={setPassword}
                />
                <PasswordField
                  label="Confirm password"
                  value={confirmPassword}
                  disabled={busy}
                  autoComplete="new-password"
                  onChange={setConfirmPassword}
                />
                <SubmitButton pending={auth.pending} disabled={busy || otp.length < 6}>
                  Update password
                </SubmitButton>
                <div className="auth__row">
                  <ResendButton
                    cooldown={resendCooldown}
                    disabled={busy}
                    onResend={() => {
                      void auth.requestPasswordReset(email).then((sent) => {
                        if (sent) {
                          setInfo('A new reset code is on the way.')
                          setResendCooldown(60)
                        }
                      })
                    }}
                  />
                  <BackButton disabled={auth.pending} onBack={() => switchView('sign-in')} />
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </main>
      <AuthShowcase />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  )
}

function EmailInput({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <input
      className="input"
      type="email"
      autoComplete="email"
      spellCheck={false}
      value={value}
      required
      disabled={disabled}
      placeholder="you@example.com"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function PasswordField({
  label,
  value,
  disabled,
  autoComplete,
  hint,
  action,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  autoComplete: string
  hint?: string
  action?: ReactNode
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  return (
    <div className="field">
      <div className="field__label-row">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {action}
      </div>
      <div className="input-affix">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          required
          minLength={8}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="input-affix__button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {hint ? (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

function SubmitButton({
  pending,
  disabled,
  children,
}: {
  pending: boolean
  disabled: boolean
  children: ReactNode
}) {
  return (
    <button
      type="submit"
      className="button button--primary button--lg button--block"
      disabled={disabled}
      aria-busy={pending || undefined}
    >
      {pending ? (
        <>
          <span className="spinner spinner--sm spinner--inverse" aria-hidden="true" />
          Please wait…
        </>
      ) : (
        children
      )}
    </button>
  )
}

function ResendButton({
  cooldown,
  disabled,
  onResend,
}: {
  cooldown: number
  disabled: boolean
  onResend: () => void
}) {
  return (
    <button
      type="button"
      className="link-button"
      disabled={disabled || cooldown > 0}
      onClick={onResend}
    >
      {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
    </button>
  )
}

function BackButton({
  label = 'Back to sign in',
  disabled,
  onBack,
}: {
  label?: string
  disabled: boolean
  onBack: () => void
}) {
  return (
    <button
      type="button"
      className="link-button link-button--muted"
      disabled={disabled}
      onClick={onBack}
    >
      <Icon name="chevronLeft" size={14} />
      {label}
    </button>
  )
}

function GoogleMark() {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

/** A drawn page showing what the editor does: markup, a note and a signature. */
function AuthShowcase() {
  return (
    <aside className="auth__showcase" aria-hidden="true">
      <div className="showcase__brand">
        <BrandMark size={52} />
        <div className="showcase__brand-text">
          <span className="showcase__name">PeDit</span>
          <span className="showcase__tagline">PDF editor</span>
        </div>
      </div>
      <div className="showcase">
        <div className="showcase__page">
          <div className="showcase__head">
            <span className="showcase__stamp">
              <BrandMark size={16} />
              <span className="showcase__line showcase__line--title" />
            </span>
            <span className="showcase__meta">2 / 6</span>
          </div>
          <span className="showcase__line" style={{ width: '92%' }} />
          <span className="showcase__line" style={{ width: '86%' }} />
          <span className="showcase__line showcase__line--highlight" style={{ width: '74%' }} />
          <span className="showcase__line" style={{ width: '89%' }} />
          <span className="showcase__line" style={{ width: '58%' }} />
          <span className="showcase__gap" />
          <span className="showcase__line" style={{ width: '90%' }} />
          <span className="showcase__line showcase__line--underline" style={{ width: '81%' }} />
          <span className="showcase__line" style={{ width: '67%' }} />
          <span className="showcase__note">Confirm clause 4.2 before Friday</span>
          <div className="showcase__sign">
            <svg viewBox="0 0 160 48" className="showcase__ink">
              <path d="M6 34c10-18 18-24 21-16s-6 20 2 19 10-20 18-20 4 16 12 15 9-12 16-12 3 9 9 9c8 0 14-8 22-10 9-2 16 2 26-2" />
            </svg>
            <span className="showcase__sign-line" />
            <span className="showcase__sign-label">Signature</span>
          </div>
        </div>
      </div>
      <ul className="showcase__points">
        <li>Highlight, underline and add text</li>
        <li>Draw, place images and sign in place</li>
        <li>Rotate, reorder and duplicate pages</li>
        <li>Every save is kept as a version</li>
      </ul>
    </aside>
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
    <div className="otp" role="group" aria-label="One-time code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            inputsRef.current[index] = node
          }}
          className="otp__digit"
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
