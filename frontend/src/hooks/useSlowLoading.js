import { useEffect, useState } from 'react'

// Returns true once `active` (a loading flag) has been continuously true for
// `delayMs`. The dev backend spins down when idle, so the first request after a
// cold start can take 30–50s; this lets a screen surface a "waking the server…"
// hint instead of a silent forever-skeleton. Resets the moment loading ends.
export function useSlowLoading(active, delayMs = 6000) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) {
      setSlow(false)
      return
    }
    const id = setTimeout(() => setSlow(true), delayMs)
    return () => clearTimeout(id)
  }, [active, delayMs])
  return slow
}
