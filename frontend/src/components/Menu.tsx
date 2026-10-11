import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './icons.tsx'

type TriggerProps = {
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void
  ref: RefObject<HTMLButtonElement | null>
}

const MenuCloseContext = createContext<() => void>(() => {})

/**
 * Popup menu with roving focus. Pointer presses inside never move focus away
 * from the document, so a text selection made on the page survives opening it.
 */
export function Menu({
  label,
  align = 'start',
  className,
  trigger,
  children,
}: {
  label: string
  align?: 'start' | 'end'
  className?: string
  trigger: (props: TriggerProps, open: boolean) => ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const focusFirst = useRef<'first' | 'last' | null>(null)
  const id = useId()
  const menuId = `${id}-menu`

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) {
      triggerRef.current?.focus()
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const list = listRef.current
    const anchor = triggerRef.current
    if (!list || !anchor) {
      return
    }
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const width = list.offsetWidth
      const height = list.offsetHeight
      const margin = 8
      let left = align === 'end' ? rect.right - width : rect.left
      left = Math.min(Math.max(margin, left), window.innerWidth - width - margin)
      let top = rect.bottom + 4
      if (top + height > window.innerHeight - margin && rect.top - height - 4 > margin) {
        top = rect.top - height - 4
      }
      list.style.left = `${Math.round(left)}px`
      list.style.top = `${Math.round(top)}px`
      list.style.maxHeight = `${Math.max(160, window.innerHeight - top - margin)}px`
    }
    place()

    const items = menuItems(list)
    const target = focusFirst.current === 'last' ? items[items.length - 1] : items[0]
    if (focusFirst.current) {
      target?.focus()
    } else {
      list.focus()
    }
    focusFirst.current = null

    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (rootRef.current?.contains(event.target) || list.contains(event.target))
      ) {
        return
      }
      setOpen(false)
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && list.contains(event.target)) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open, align])

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems(listRef.current)
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  const triggerProps: TriggerProps = {
    id: `${id}-trigger`,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    ref: triggerRef,
    onClick: () => {
      setOpen((current) => !current)
    },
    onMouseDown: (event) => {
      event.preventDefault()
    },
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        focusFirst.current = event.key === 'ArrowDown' ? 'first' : 'last'
        setOpen(true)
      } else if ((event.key === 'Enter' || event.key === ' ') && !open) {
        focusFirst.current = 'first'
      }
    },
  }

  return (
    <div ref={rootRef} className={className ? `menu ${className}` : 'menu'}>
      {trigger(triggerProps, open)}
      {open
        ? createPortal(
        <div
          ref={listRef}
          id={menuId}
          className="menu__list"
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
        >
          <MenuCloseContext.Provider value={close}>{children}</MenuCloseContext.Provider>
        </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function MenuItem({
  icon,
  children,
  hint,
  danger,
  disabled,
  checked,
  onSelect,
}: {
  icon?: IconName
  children: ReactNode
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
}) {
  const close = useContext(MenuCloseContext)
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={danger ? 'menu__item menu__item--danger' : 'menu__item'}
      tabIndex={-1}
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
    >
      <span className="menu__icon" aria-hidden="true">
        {checked ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null}
      </span>
      <span className="menu__text">{children}</span>
      {hint ? <span className="menu__hint">{hint}</span> : null}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="menu__separator" role="separator" />
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="menu__heading" role="presentation">
      {children}
    </div>
  )
}

function menuItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return []
  }
  return Array.from(
    root.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'),
  )
}
