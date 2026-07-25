import { useEffect, useRef, useState } from 'react'

// Lazy iframe wrapper for standalone demo pages in public/demos. The embed is deliberately
// NON-INTERACTIVE — the inner page auto-plays and clicks pass straight through (pointer-events:none),
// so it reads like an embedded product video, not a widget you poke at.
export default function ProductTour({
  src = '/demos/walkthrough.html',
  aspect = '660 / 512',
  maxWidth = '1040px',
  title = 'Touchstones product walkthrough',
  className = '',
}) {
  const ref = useRef(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setLoaded(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={`mx-auto w-full ${className}`} style={{ maxWidth }}>
      {/* Aspect box matches the inner page's design so the iframe height always equals the page's
          self-computed height (no scrollbars, no letterboxing). */}
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-stone-200 bg-canvas shadow-lift"
        style={{ aspectRatio: aspect }}
      >
        {loaded ? (
          <iframe
            src={src}
            title={title}
            loading="lazy"
            scrolling="no"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
            style={{ border: 0, background: 'transparent', pointerEvents: 'none' }}
          />
        ) : null}
      </div>
    </div>
  )
}
