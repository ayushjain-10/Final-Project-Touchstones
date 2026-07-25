import { useEffect, useRef } from 'react'

// Content stays visible by default. Motion is progressive enhancement, so a
// missed observer, print/PDF capture, or slow browser can never create a blank
// section. Use `delay` (ms) to stagger the entrance animation.
export default function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
  reduced = false,
  ...props
}) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reducedMotion = reduced || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || typeof IntersectionObserver === 'undefined' || !el.animate) return

    // Above-the-fold content stays settled on first paint. Below-the-fold content
    // animates only when it enters the real viewport.
    const vh = window.innerHeight || document.documentElement.clientHeight || 0
    const rect = el.getBoundingClientRect()
    if (rect.top < vh && rect.bottom > 0) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.animate(
            [
              { opacity: 0, transform: 'translateY(16px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            {
              duration: 700,
              delay,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
          )
          io.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px 12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [delay, reduced])

  return (
    <Tag ref={ref} className={`reveal ${className}`} {...props}>
      {children}
    </Tag>
  )
}
