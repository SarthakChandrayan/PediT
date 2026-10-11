import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 450
const GAP = 6

type Tip = { text: string; left: number; top: number; above: boolean }

/**
 * One tooltip for the whole app, driven by `data-tooltip` attributes. It is
 * positioned in the viewport, so scrolling toolbars and menus never clip it.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const warmRef = useRef(false)

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    const hide = () => {
      clearTimer()
      targetRef.current = null
      setTip(null)
    }
    const show = (element: HTMLElement) => {
      const text = element.dataset.tooltip
      if (!text || element.matches(':disabled') || element.getAttribute('aria-expanded') === 'true') {
        return
      }
      const rect = element.getBoundingClientRect()
      const above = rect.bottom + 40 > window.innerHeight
      setTip({
        text,
        left: rect.left + rect.width / 2,
        top: above ? rect.top - GAP : rect.bottom + GAP,
        above,
      })
    }
    const schedule = (element: HTMLElement) => {
      if (targetRef.current === element) {
        return
      }
      clearTimer()
      targetRef.current = element
      setTip(null)
      if (warmRef.current) {
        show(element)
        return
      }
      timerRef.current = window.setTimeout(() => {
        warmRef.current = true
        show(element)
      }, SHOW_DELAY_MS)
    }

    let coolTimer: number | null = null
    const onOver = (event: Event) => {
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tooltip]')
          : null
      if (element) {
        if (coolTimer !== null) {
          window.clearTimeout(coolTimer)
          coolTimer = null
        }
        schedule(element)
        return
      }
      if (targetRef.current) {
        hide()
        coolTimer = window.setTimeout(() => {
          warmRef.current = false
        }, 300)
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
        onOver(event)
      } else {
        hide()
      }
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimer()
      if (coolTimer !== null) {
        window.clearTimeout(coolTimer)
      }
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  useEffect(() => {
    const element = tipRef.current
    if (!tip || !element) {
      return
    }
    const width = element.offsetWidth
    const left = Math.min(Math.max(8, tip.left - width / 2), window.innerWidth - width - 8)
    element.style.left = `${Math.round(left)}px`
    element.style.visibility = 'visible'
  }, [tip])

  if (!tip) {
    return null
  }
  const [label, keys] = tip.text.split('  ')

  return createPortal(
    <div
      ref={tipRef}
      className="tooltip"
      role="presentation"
      aria-hidden="true"
      style={{
        top: tip.top,
        transform: tip.above ? 'translateY(-100%)' : undefined,
        visibility: 'hidden',
      }}
    >
      {label}
      {keys ? <span className="tooltip__keys">{keys}</span> : null}
    </div>,
    document.body,
  )
}
