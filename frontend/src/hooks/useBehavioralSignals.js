import { useCallback, useEffect, useMemo, useRef } from 'react'

// Captures lightweight, client-attested behavioral signals while a candidate
// works: paste-vs-typed, tab focus/blur, and elapsed time. These are HINTS only
// — they are sent to the integrity endpoint as `client_attested` events and the
// server independently decides which to trust. Nothing here blocks the candidate
// and we never capture content/keystrokes, only counts and coarse metadata.
//
// Returns:
//   onPaste(e)     — attach to the work textarea's onPaste
//   onTextChange(len) — call with the current text length on every change
//   collectAndReset() — returns the queued events and clears the queue
//   summary()      — current rolling counters (for the optional UI line)
export function useBehavioralSignals() {
  const queue = useRef([])
  const counters = useRef({
    startedAt: Date.now(),
    typedChars: 0,
    pasteChars: 0,
    pasteCount: 0,
    tabHiddenCount: 0,
    windowBlurCount: 0,
    lastLen: 0,
  })

  const push = useCallback((type, meta = {}, category = 'behavior') => {
    queue.current.push({
      type,
      category,
      meta,
      client_ts: new Date().toISOString(),
    })
  }, [])

  // Tab visibility + window focus. Server treats these as advisory.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        counters.current.tabHiddenCount += 1
        push('tab_hidden')
      } else {
        push('tab_visible')
      }
    }
    const onBlur = () => {
      counters.current.windowBlurCount += 1
      push('window_blur')
    }
    const onFocus = () => push('window_focus')

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [push])

  const onPaste = useCallback(
    (e) => {
      const chars = (e.clipboardData?.getData('text') || '').length
      counters.current.pasteChars += chars
      counters.current.pasteCount += 1
      push('paste', { chars })
    },
    [push],
  )

  // Estimate typed chars from positive length deltas that aren't pastes.
  const onTextChange = useCallback((len) => {
    const prev = counters.current.lastLen
    const delta = len - prev
    if (delta > 0 && delta < 8) counters.current.typedChars += delta
    counters.current.lastLen = len
  }, [])

  // Final per-session rollup the digest endpoint understands (typed_chars /
  // final_chars / paste_chars), plus a queued submit marker.
  const markSubmit = useCallback(
    (finalLen) => {
      const c = counters.current
      push('session_submit', {
        typed_chars: c.typedChars,
        paste_chars: c.pasteChars,
        final_chars: finalLen,
        elapsed_ms: Date.now() - c.startedAt,
      })
    },
    [push],
  )

  // Record a custom client-attested event (e.g. an IDE paste, or an activity
  // rollup at submit). Mirrors the internal push so callers don't touch the queue.
  const record = useCallback(
    (type, meta = {}) => {
      if (type === 'paste') {
        const chars = Number(meta?.chars) || 0
        counters.current.pasteChars += chars
        counters.current.pasteCount += 1
      }
      push(type, meta)
    },
    [push],
  )

  const collectAndReset = useCallback(() => {
    const events = queue.current
    queue.current = []
    return events
  }, [])

  const summary = useCallback(() => {
    const c = counters.current
    const finalLen = c.lastLen || 1
    const typedFraction = Math.max(0, Math.min(1, (finalLen - c.pasteChars) / finalLen))
    return {
      pasteCount: c.pasteCount,
      tabHiddenCount: c.tabHiddenCount,
      windowBlurCount: c.windowBlurCount,
      typedFraction,
      elapsedMs: Date.now() - c.startedAt,
    }
  }, [])

  // Memoize the returned object so its identity is STABLE across renders. Consumers
  // (Candidate.jsx) list this object in a flush effect's deps; without useMemo, the
  // ~1s elapsed-timer re-render produced a fresh object every second and tore down the
  // 5s periodic-flush interval before it could ever fire.
  return useMemo(
    () => ({ onPaste, onTextChange, markSubmit, record, collectAndReset, summary }),
    [onPaste, onTextChange, markSubmit, record, collectAndReset, summary],
  )
}

export default useBehavioralSignals
