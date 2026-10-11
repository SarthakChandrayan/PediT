import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'

export const BANNER_AUTO_DISMISS_MS = 6000

type BannerProps = {
  message: string
  onDismiss: () => void
  /** Omit to keep the banner until the user closes it. */
  autoDismissMs?: number
  className?: string
  tone?: 'error' | 'info'
}

export function Banner({
  message,
  onDismiss,
  autoDismissMs,
  className,
  tone = 'error',
}: BannerProps) {
  const onDismissRef = useRef(onDismiss)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (autoDismissMs === undefined || paused) {
      return
    }
    const timer = window.setTimeout(() => onDismissRef.current(), autoDismissMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [message, autoDismissMs, paused])

  return (
    <div
      className={className ? `banner ${className}` : 'banner'}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="banner__icon" aria-hidden="true">
        <Icon name={tone === 'error' ? 'alert' : 'check'} />
      </span>
      <span className="banner__message">{message}</span>
      <button
        type="button"
        className="banner__close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => onDismissRef.current()}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
