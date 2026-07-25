import { useEffect, useRef } from 'react'
import { useReducedMotion } from './useReducedMotion.js'

// Subtle scroll parallax for a DECORATIVE layer (a background wash or glow — never text or
// interactive content). Returns a ref to attach; the element drifts by up to ±`strength` px as
// it crosses the viewport. rAF-throttled, passive listener, cleaned up on unmount, and a full
// no-op under prefers-reduced-motion (the transform is cleared so nothing is left offset).
export function useParallax(strength = 20) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return undefined
    let raf = 0
    const update = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      // -1 (element below viewport) → 0 (centered) → +1 (above); scaled to px.
      const progress = (rect.top + rect.height / 2 - vh / 2) / vh
      el.style.transform = `translate3d(0, ${(progress * strength).toFixed(1)}px, 0)`
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
      el.style.transform = ''
    }
  }, [reduced, strength])
  return ref
}
