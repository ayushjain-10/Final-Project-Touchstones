import { useEffect, useId, useRef } from 'react'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Animated 0 to 100 score ring. Ultramarine gradient arc on a hairline track;
// the number counts up to the value once it scrolls into view.
export default function ScoreRing({ value = 92, size = 168, stroke = 12, suffix = '/100' }) {
  // Sanitize once: a non-numeric/NaN, negative, or >100 score must never reach
  // the count-up, the reduced-motion branch, or the SVG arc. Everything below
  // uses `safe`, so the ring can never flash "-2" / "NaN" / an overshooting arc.
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const gradientId = `score-ring-gradient-${useId()}`
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReduced() || typeof IntersectionObserver === 'undefined' || !el.animate) return

    const vh = window.innerHeight || document.documentElement.clientHeight || 0
    const rect = el.getBoundingClientRect()
    if (rect.top < vh && rect.bottom > 0) return

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          io.disconnect()
          // Keep the score and arc accurate throughout. The ring gets a subtle
          // entrance without ever displaying a partial or misleading value.
          el.animate(
            [
              { opacity: 0.65, transform: 'scale(0.94)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          )
        }
      },
      { threshold: 0, rootMargin: '0px 0px 12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const offset = circ - (safe / 100) * circ

  return (
    <div ref={ref} className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7484E3" />
            <stop offset="55%" stopColor="#4358D0" />
            <stop offset="100%" stopColor="#3448C5" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E6FF" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-serif text-4xl font-semibold leading-none text-ink tabular-nums">
          {safe}
        </span>
        <span className="mt-1 text-xs font-medium text-stone-400">{suffix}</span>
      </div>
    </div>
  )
}
