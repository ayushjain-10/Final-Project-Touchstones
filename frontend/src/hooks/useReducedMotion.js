import { useEffect, useState } from 'react'

// Reactive `prefers-reduced-motion: reduce`. CSS animations/transitions are already
// neutralized globally by the media query in index.css; this hook is for the JS-driven
// motion (scroll parallax, the auto-advancing product tour) that CSS can't reach — those
// callers must no-op when this returns true. (a11y hard rule.)
const QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(QUERY)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}
