// Inline SVG icon set — stroke-based, inherits currentColor.
// Keeps the bundle lean (no icon dependency) and on-brand (hairline weight).

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const make =
  (paths) =>
  ({ className = '', size }) => (
    <svg
      {...base}
      width={size || base.width}
      height={size || base.height}
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  )

export const Check = make(<polyline points="20 6 9 17 4 12" />)
export const Camera = make(
  <>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </>,
)
export const Mic = make(
  <>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </>,
)
export const RotateCcw = make(
  <>
    <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
    <polyline points="3 3 3 8 8 8" />
  </>,
)
export const CheckCircle = make(
  <>
    <path d="M21.5 12a9.5 9.5 0 1 1-3.9-7.7" />
    <polyline points="9 11.5 12 14.5 21 5.5" />
  </>,
)
export const ShieldCheck = make(
  <>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />
    <polyline points="9 12 11 14 15 9.5" />
  </>,
)
export const Fingerprint = make(
  <>
    <path d="M12 11a2 2 0 0 1 2 2c0 2.5-.4 5-1.2 7" />
    <path d="M8 13a4 4 0 0 1 8 0c0 1.6-.2 3.2-.6 4.7" />
    <path d="M5.5 11.5a6.5 6.5 0 0 1 12.9-1" />
    <path d="M9 18.8c.5-1.5.7-3.1.7-4.8a2.3 2.3 0 0 1 4.6 0" />
  </>,
)
export const Bolt = make(<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />)
export const Sparkle = make(
  <path d="M12 3c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6Z" />,
)
export const Sun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
)
export const Moon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />)
export const ArrowRight = make(
  <>
    <line x1="4" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
  </>,
)
export const ArrowUpRight = make(
  <>
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="8 7 17 7 17 16" />
  </>,
)
export const ChevronRight = make(<polyline points="9 6 15 12 9 18" />)
export const FileText = make(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <polyline points="14 3 14 8 19 8" />
    <line x1="8.5" y1="13" x2="15" y2="13" />
    <line x1="8.5" y1="16.5" x2="13" y2="16.5" />
  </>,
)
export const Lock = make(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
)
export const Eye = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </>,
)
export const Clock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7.5 12 12 15 13.5" />
  </>,
)
export const Flag = make(
  <>
    <path d="M5 21V4.5h11l-1.5 4 1.5 4H5" />
    <line x1="5" y1="4.5" x2="5" y2="21" />
  </>,
)
export const Code = make(
  <>
    <polyline points="16 8 20 12 16 16" />
    <polyline points="8 8 4 12 8 16" />
    <line x1="13" y1="6" x2="11" y2="18" />
  </>,
)
export const User = make(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
  </>,
)
export const Download = make(
  <>
    <path d="M12 3v12" />
    <polyline points="7 11 12 16 17 11" />
    <path d="M5 20h14" />
  </>,
)
export const Link = make(
  <>
    <path d="M9.5 14.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M14.5 9.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  </>,
)
export const Slack = make(
  <>
    <rect x="10.5" y="3.5" width="3" height="9" rx="1.5" />
    <rect x="3.5" y="10.5" width="9" height="3" rx="1.5" />
    <rect x="10.5" y="11.5" width="3" height="9" rx="1.5" />
    <rect x="11.5" y="10.5" width="9" height="3" rx="1.5" />
  </>,
)
export const Github = make(
  <path d="M9 19c-4 1.2-4-2-5.5-2.5M15 21v-3.2a2.8 2.8 0 0 0-.8-2.2c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6 1.6 5 1.9 5 1.9a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.5 8.3c0 4.6 2.8 5.7 5.5 6a2.8 2.8 0 0 0-.8 2.1V21" />,
)
export const Play = make(<path d="M7 4.5v15l13-7.5-13-7.5Z" />)
export const Linkedin = make(
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <line x1="7.5" y1="10" x2="7.5" y2="16.5" />
    <circle cx="7.5" cy="7.2" r="0.6" />
    <path d="M11 16.5v-3.6a2.4 2.4 0 0 1 4.8 0v3.6" />
    <line x1="11" y1="10" x2="11" y2="16.5" />
  </>,
)
export const Mail = make(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <polyline points="3.5 7 12 13 20.5 7" />
  </>,
)
export const Plus = make(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
)
export const Menu = make(
  <>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </>,
)
export const X = make(
  <>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </>,
)
export const Grid = make(
  <>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </>,
)
export const Quote = make(
  <path d="M9 6c-3 1.2-4.5 3.6-4.5 7.2V18H10v-5H7.2c0-2 .8-3.4 2.6-4.2L9 6Zm9 0c-3 1.2-4.5 3.6-4.5 7.2V18H19v-5h-2.8c0-2 .8-3.4 2.6-4.2L18 6Z" />,
)
export const Compass = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <polygon points="15.5 8.5 11 11 8.5 15.5 13 13 15.5 8.5" />
  </>,
)
