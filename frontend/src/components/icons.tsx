type IconName =
  | 'select'
  | 'addText'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'image'
  | 'signature'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'fitPage'
  | 'search'
  | 'close'
  | 'previous'
  | 'next'
  | 'bold'
  | 'italic'
  | 'trash'
  | 'rotate'
  | 'duplicate'
  | 'moveUp'
  | 'moveDown'
  | 'addPage'
  | 'collapseSidebar'
  | 'expandSidebar'
  | 'open'
  | 'save'
  | 'export'
  | 'chevronDown'
  | 'chevronLeft'
  | 'page'
  | 'upload'
  | 'check'
  | 'history'
  | 'logout'
  | 'alert'
  | 'eye'
  | 'eyeOff'
  | 'sortDown'
  | 'mail'

const PATHS: Record<IconName, string> = {
  select: 'M4 2.75 12.25 8.6l-3.6.55 2 4.1-1.55.75-2-4.15L4.3 12.4z',
  addText: 'M3.5 4V3h7v1M7 3v9.5M5.5 12.5h3M11 10.5h4M13 8.5v4',
  highlight: 'M2.5 13.5h11M4.75 11.25l1.5-3.5 5-5 2 2-5 5-3.5 1.5zM9.25 4.25l2.5 2.5',
  underline: 'M4.5 2.75v4.5a3.5 3.5 0 0 0 7 0v-4.5M3.5 13.25h9',
  strikethrough: 'M2.75 8h10.5M10.75 4.5C10.3 3.5 9.3 2.9 8 2.9c-1.7 0-2.85.9-2.85 2.2 0 .7.3 1.25.9 1.65M5 11c.35 1.3 1.5 2.1 3 2.1 1.75 0 3-.95 3-2.35 0-.45-.1-.85-.35-1.2',
  pen: 'M10.25 2.75l3 3-7.5 7.5-3.75.75.75-3.75zM8.75 4.25l3 3',
  line: 'M3 13 13 3',
  arrow: 'M3 13 12.5 3.5M7.5 3.5h5v5',
  rectangle: 'M2.75 4.25h10.5v7.5H2.75z',
  ellipse: 'M8 3.75c3.04 0 5.25 1.9 5.25 4.25S11.04 12.25 8 12.25 2.75 10.35 2.75 8 4.96 3.75 8 3.75z',
  image: 'M2.75 3.25h10.5v9.5H2.75zM2.75 10.5l3-2.75 2.5 2.25 1.75-1.5 3.25 2.75M10 5.75h.01',
  signature: 'M2.5 11.5c1.1-2.4 2.3-3.1 2.75-2.1.45 1-.6 2.6.45 2.6.9 0 1.4-1.9 2.4-1.9.85 0 .8 1.35 1.65 1.35.5 0 .95-.35 1.35-.85M2.5 13.75h11M10.25 2.75l2 2-3.75 3.75H6.5v-2z',
  undo: 'M5.75 6.25H2.75v-3M3 6.1A5.25 5.25 0 1 1 3.75 11',
  redo: 'M10.25 6.25h3v-3M13 6.1A5.25 5.25 0 1 0 12.25 11',
  zoomIn: 'M7 2.75a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 0 1 0-8.5zM13.25 13.25 10 10M7 5v4M5 7h4',
  zoomOut: 'M7 2.75a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 0 1 0-8.5zM13.25 13.25 10 10M5 7h4',
  fitWidth: 'M2.5 3v10M13.5 3v10M5 8h6M6.75 6.25 5 8l1.75 1.75M9.25 6.25 11 8l-1.75 1.75',
  fitPage: 'M4.25 2.5h7.5v11h-7.5zM6.5 6.5h3v3h-3z',
  search: 'M7 2.75a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 0 1 0-8.5zM13.25 13.25 10 10',
  close: 'M4 4l8 8M12 4l-8 8',
  previous: 'M4 10l4-4 4 4',
  next: 'M4 6l4 4 4-4',
  bold: 'M4.75 3h3.9a2.5 2.5 0 0 1 0 5h-3.9zM4.75 8h4.4a2.5 2.5 0 0 1 0 5h-4.4z',
  italic: 'M6.5 3h5M4.5 13h5M9.5 3l-3 10',
  trash: 'M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.6 9h6.3l.6-9M6.75 6.75v4M9.25 6.75v4',
  rotate: 'M13 7.5A5 5 0 1 0 11.6 11.6M13 3.5v4h-4',
  duplicate: 'M5.75 5.75h7.5v7.5h-7.5zM10.25 5.75v-3h-7.5v7.5h3',
  moveUp: 'M8 13V3.25M4.25 7 8 3.25 11.75 7',
  moveDown: 'M8 3v9.75M4.25 9 8 12.75 11.75 9',
  addPage: 'M9 2.5H4.25v11h7.5V5.25zM9 2.5v2.75h2.75M8 7.5v4M6 9.5h4',
  collapseSidebar: 'M2.75 3.25h10.5v9.5H2.75zM6.25 3.25v9.5M10.5 6.25 8.75 8l1.75 1.75',
  expandSidebar: 'M2.75 3.25h10.5v9.5H2.75zM6.25 3.25v9.5M8.75 6.25 10.5 8l-1.75 1.75',
  open: 'M2.75 4.25v8.5h10.5v-7H7.5l-1.25-1.5z',
  save: 'M3 2.75h8l2 2v8.5H3zM5.25 2.75v3h5v-3M5.25 13.25v-4h5.5v4',
  export: 'M8 10V2.75M5.25 5.5 8 2.75l2.75 2.75M2.75 9.5v3.75h10.5V9.5',
  chevronDown: 'M5 6.5l3 3 3-3',
  chevronLeft: 'M9.5 4.5 6 8l3.5 3.5',
  page: 'M9 2.25H4v11.5h8V5.25zM9 2.25v3h3M6 8.25h4M6 10.75h4',
  upload: 'M8 10.5V2.75M5.25 5.5 8 2.75l2.75 2.75M2.75 10v3.25h10.5V10',
  check: 'M3.5 8.25 6.5 11.25 12.5 4.75',
  history: 'M2.75 8a5.25 5.25 0 1 0 1.55-3.7M2.75 2.75v2.5h2.5M8 5.25V8l1.75 1.75',
  logout: 'M6.25 2.75h-3.5v10.5h3.5M10.25 5.25 13 8l-2.75 2.75M13 8H6',
  alert: 'M8 2.5 14 13H2zM8 6.5v3M8 11.25h.01',
  eye: 'M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  eyeOff: 'M2.5 2.5l11 11M6.6 6.6a2 2 0 0 0 2.8 2.8M4.4 4.75C2.75 5.9 1.75 8 1.75 8S4 12.25 8 12.25c1.25 0 2.35-.4 3.25-1M7 3.85c.33-.07.66-.1 1-.1 4 0 6.25 4.25 6.25 4.25s-.45.85-1.3 1.85',
  sortDown: 'M4.5 3v10M2.5 11l2 2 2-2M8.5 4.5h5M8.5 8h3.5M8.5 11.5h2',
  mail: 'M2.25 3.75h11.5v8.5H2.25zM2.25 4.25 8 8.75l5.75-4.5',
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === 'select'
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      src="/logo.png"
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  )
}

export type { IconName }
