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

const PATHS: Record<IconName, string> = {
  select:
    'M3.5 2.5 12 8.2l-3.2.6 1.8 4.2-1.7.7-1.8-4.2-2.6 2.4z',
  addText:
    'M4 3.5h8M8 3.5v9M11 12.5h3M12.5 11v3',
  highlight:
    'M3 12.5h10M5.2 10.2 9.8 3.8l2.4 1.8-4.6 6.4z',
  underline:
    'M4.5 3.5v6a3.5 3.5 0 0 0 7 0v-6M4 13.5h8',
  strikethrough:
    'M4.5 4.5 8 3.5l3.5 1v3.2M3.5 8.5h9M5 10.5v1.2c0 1.5 1.3 2.3 3 2.3s3-.8 3-2.3',
  pen:
    'M9.8 3.2 12.8 6.2 6.2 12.8 3.2 13.8l1-3zM8.6 4.4 11.6 7.4',
  line: 'M3 13 13 3',
  arrow: 'M3 13 12.5 3.5M8.5 3.5h4v4',
  rectangle: 'M3.5 4.5h9v7h-9z',
  ellipse: 'M8 3.5a5.5 4.5 0 1 1 0 9a5.5 4.5 0 1 1 0-9',
  image:
    'M3.5 4.5h9v8h-9zM3.5 10.2 6.2 8l2.1 2 1.4-1.2 2.8 2.4M6.2 6.4h.01',
  undo: 'M6 6.5H3.5V4M3.7 6.5A5 5 0 1 1 3.5 9',
  redo: 'M10 6.5h2.5V4M12.3 6.5A5 5 0 1 0 12.5 9',
  zoomIn: 'M7 3.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9ZM13.5 13.5 10.4 10.4M7 5.8v4.4M4.8 8h4.4',
  zoomOut: 'M7 3.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9ZM13.5 13.5 10.4 10.4M4.8 8h4.4',
  fitWidth: 'M2.5 8h11M2.5 5.5 2.5 10.5M13.5 5.5v5M5 6l-2 2 2 2M11 6l2 2-2 2',
  fitPage: 'M4 3.5h8v9H4zM6 6.5h4v3H6z',
  search: 'M7 3.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9ZM13.5 13.5 10.4 10.4',
  close: 'M4 4 12 12M12 4 4 12',
  previous: 'M10 3.5 5.5 8 10 12.5',
  next: 'M6 3.5 10.5 8 6 12.5',
  bold: 'M5 3.5h3.4a2.4 2.4 0 0 1 0 4.8H5zm0 4.8h3.8A2.5 2.5 0 0 1 8.8 13H5z',
  italic: 'M7 3.5h5M4 12.5h5M9.5 3.5 6.5 12.5',
  trash: 'M3.5 5h9M6 5V3.5h4V5M5 5l.5 8h5l.5-8',
  rotate: 'M12.5 7A4.5 4.5 0 1 0 12 11M12.5 4v3h-3',
  duplicate: 'M6 5.5h7v7H6zM3.5 3.5H10v2',
  moveUp: 'M8 12.5V4M5 7l3-3 3 3',
  moveDown: 'M8 3.5V12M5 9l3 3 3-3',
  addPage: 'M5 3.5h4.5L11.5 5.5V12.5H5zM8 7.5v3M6.5 9h3',
  collapseSidebar: 'M3.5 3.5h9v9h-9zM7 3.5v9M9.5 6.5 8 8l1.5 1.5',
  expandSidebar: 'M3.5 3.5h9v9h-9zM7 3.5v9M5.5 6.5 7 8 5.5 9.5',
  open: 'M3.5 5.5h3l1 1.5h5v5.5h-9z',
  save: 'M3.5 3.5h7.5L12.5 5.5V12.5h-9zM5.5 3.5v3h5v-3M5.5 12.5v-3h5v3',
  export: 'M8 9.5V3.5M5.5 6 8 3.5 10.5 6M3.5 10.5v2h9v-2',
}

export function Icon({ name }: { name: IconName }) {
  const filled = name === 'select'
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export type { IconName }
