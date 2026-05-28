/**
 * Icon: the app's small icon set.
 *
 * Drawn on a 16 px grid with one stroke width so every icon has the same
 * visual weight. Icons are decorative by default (aria-hidden); the button
 * that holds one carries the accessible label.
 */

const PATHS = {
  mic:      'M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2Z M4.5 7.5a3.5 3.5 0 0 0 7 0 M8 11v2.5',
  stop:     'M4.5 4.5h7v7h-7Z',
  search:   'M7 3a4 4 0 1 1 0 8a4 4 0 0 1 0-8Z M10 10l3.5 3.5',
  sliders:  'M3 4.5h6 M12 4.5h1 M3 11.5h1 M7 11.5h6 M10.5 3v3 M5.5 10v3',
  screen:   'M2.5 3.5h11v7h-11Z M6 13.5h4 M8 10.5v3',
  send:     'M3 8h9 M8.5 4.5 12 8l-3.5 3.5',
  resend:   'M3.5 8a4.5 4.5 0 1 0 1.3-3.2 M3.5 3v2.5H6',
  check:    'M3.5 8.5 6.5 11.5 12.5 4.5',
  close:    'M4.5 4.5l7 7 M11.5 4.5l-7 7',
  copy:     'M5.5 5.5h7v7h-7Z M3.5 10.5v-7h7',
  alert:    'M8 2.5 14 13H2Z M8 6.5v3 M8 11.2v.3',
}

export default function Icon({ name, size = 16, className = '', title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  )
}
