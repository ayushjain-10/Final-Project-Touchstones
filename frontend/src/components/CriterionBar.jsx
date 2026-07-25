import { useEffect, useRef } from 'react'

// A single scored criterion: label, points, and a bar that fills on reveal.
// `pct` 0–100 drives the fill width. Tone shifts colour for weak criteria.
export default function CriterionBar({ label, points, pct, note, delay = 0 }) {
  const ref = useRef(null)
  const fillRef = useRef(null)

  useEffect(() => {
    const el = ref.current
    const fill = fillRef.current
    if (!el || !fill) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || typeof IntersectionObserver === 'undefined' || !fill.animate) return

    const vh = window.innerHeight || document.documentElement.clientHeight || 0
    const rect = el.getBoundingClientRect()
    if (rect.top < vh && rect.bottom > 0) return

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          fill.animate(
            [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
            { duration: 1000, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          )
          io.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px 12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [delay])

  const tone = pct >= 75 ? 'bg-brand-500' : pct >= 50 ? 'bg-warning-500' : 'bg-danger-500'

  return (
    <div ref={ref}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-stone-500">{points}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          ref={fillRef}
          className={`h-full rounded-full ${tone}`}
          style={{
            width: `${pct}%`,
            transformOrigin: 'left center',
          }}
        />
      </div>
      {note && <p className="mt-1.5 text-xs leading-relaxed text-stone-500">{note}</p>}
    </div>
  )
}
