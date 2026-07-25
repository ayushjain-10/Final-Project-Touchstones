import { useCallback, useMemo, useRef, useState } from 'react'

// useActivityTracker — dependency-light behavioral/integrity tracker for the
// in-browser code editor. It consumes the small, serializable events emitted by
// <CodeEditor onActivity={...} /> and rolls them up into a compact `signals`
// summary suitable for POSTing alongside a submission (it gets MERGED into the
// existing behavioral-signals payload — see useBehavioralSignals — so it makes
// no assumption about a specific backend schema; it just produces a clean object).
//
// We never capture content or individual keystrokes — only counts, lengths, and
// coarse timestamps. Pastes record their LENGTH (a key integrity signal) but not
// the pasted text.
//
// Returns:
//   signals    — JSON-serializable rollup (see `emptySignals` for shape)
//   onActivity — pass straight to <CodeEditor onActivity={onActivity} />
//   reset      — clears all counters back to an empty session
//
// onActivity event shapes (the `type` field discriminates):
//   { type: 'keystroke', path, count }        count = chars changed since last event (>=1)
//   { type: 'paste',     path, length }       length = number of chars pasted
//   { type: 'file_switch', from, to }         from may be null on the first focus
//   { type: 'focus',     path }
//   { type: 'blur',      path }

// Gaps longer than this (ms) between edits count as "idle" rather than active
// time — keeps total-active-time honest when a candidate steps away.
const IDLE_THRESHOLD_MS = 15000

// A paste larger than this is flagged as a "large paste" — a coarse integrity
// hint (e.g. dropping in a big AI/code block) the server can weigh as it likes.
const LARGE_PASTE_THRESHOLD = 120

function emptySignals() {
  return {
    totalKeystrokes: 0,
    pasteEvents: [], // [{ at: <ms since session start>, length }]
    pasteCount: 0,
    pastedChars: 0,
    largePasteCount: 0, // pastes with length > 120
    perFileEditCounts: {}, // { [path]: editEventCount }
    fileSwitchCount: 0,
    filesTouched: 0,
    firstEditAt: null, // ms since session start, or null
    lastEditAt: null, // ms since session start, or null
    totalActiveMs: 0, // summed edit-to-edit gaps, excluding idle gaps
    idleGapCount: 0, // number of gaps longer than IDLE_THRESHOLD_MS
    longestIdleMs: 0,
    sessionMs: 0, // wall-clock since the tracker mounted
  }
}

export function useActivityTracker() {
  // Fixed origin so every timestamp in `signals` is a small relative offset
  // (ms since the tracker mounted) rather than an absolute epoch — keeps the
  // payload compact and avoids leaking wall-clock specifics.
  const startedAtRef = useRef(Date.now())

  // Mutable accumulator. We keep the heavy counting off React state and only
  // publish an immutable snapshot to `signals` so consumers re-render with a
  // stable, serializable object.
  const accRef = useRef({
    totalKeystrokes: 0,
    pasteEvents: [],
    largePasteCount: 0,
    perFileEditCounts: {},
    fileSwitchCount: 0,
    filesTouched: new Set(),
    firstEditAt: null,
    lastEditAt: null, // absolute ms (epoch) — converted to relative on publish
    lastEditEpoch: null,
    totalActiveMs: 0,
    idleGapCount: 0,
    longestIdleMs: 0,
  })

  const [signals, setSignals] = useState(emptySignals)

  // Build the public, JSON-serializable snapshot from the accumulator.
  const snapshot = useCallback(() => {
    const a = accRef.current
    const origin = startedAtRef.current
    const pastedChars = a.pasteEvents.reduce((sum, p) => sum + p.length, 0)
    return {
      totalKeystrokes: a.totalKeystrokes,
      pasteEvents: a.pasteEvents.map((p) => ({ at: p.at, length: p.length })),
      pasteCount: a.pasteEvents.length,
      pastedChars,
      largePasteCount: a.largePasteCount,
      perFileEditCounts: { ...a.perFileEditCounts },
      fileSwitchCount: a.fileSwitchCount,
      filesTouched: a.filesTouched.size,
      firstEditAt: a.firstEditAt == null ? null : a.firstEditAt - origin,
      lastEditAt: a.lastEditEpoch == null ? null : a.lastEditEpoch - origin,
      totalActiveMs: a.totalActiveMs,
      idleGapCount: a.idleGapCount,
      longestIdleMs: a.longestIdleMs,
      sessionMs: Date.now() - origin,
    }
  }, [])

  // Record an "edit" moment (keystroke or paste): advances first/last-edit and
  // accumulates active vs. idle time from the gap since the previous edit.
  const noteEdit = useCallback((now) => {
    const a = accRef.current
    if (a.firstEditAt == null) a.firstEditAt = now
    if (a.lastEditEpoch != null) {
      const gap = now - a.lastEditEpoch
      if (gap > 0) {
        if (gap > IDLE_THRESHOLD_MS) {
          a.idleGapCount += 1
          if (gap > a.longestIdleMs) a.longestIdleMs = gap
        } else {
          a.totalActiveMs += gap
        }
      }
    }
    a.lastEditEpoch = now
  }, [])

  const onActivity = useCallback(
    (event) => {
      if (!event || typeof event.type !== 'string') return
      const a = accRef.current
      const now = Date.now()

      switch (event.type) {
        case 'keystroke': {
          const count = Number.isFinite(event.count) ? Math.max(1, event.count) : 1
          a.totalKeystrokes += count
          if (event.path) {
            a.perFileEditCounts[event.path] = (a.perFileEditCounts[event.path] || 0) + 1
            a.filesTouched.add(event.path)
          }
          noteEdit(now)
          break
        }
        case 'paste': {
          const length = Number.isFinite(event.length) ? Math.max(0, event.length) : 0
          a.pasteEvents.push({ at: now - startedAtRef.current, length })
          if (length > LARGE_PASTE_THRESHOLD) a.largePasteCount += 1
          if (event.path) {
            a.perFileEditCounts[event.path] = (a.perFileEditCounts[event.path] || 0) + 1
            a.filesTouched.add(event.path)
          }
          noteEdit(now)
          break
        }
        case 'file_switch': {
          a.fileSwitchCount += 1
          if (event.to) a.filesTouched.add(event.to)
          break
        }
        case 'focus':
        case 'blur': {
          // Focus/blur don't count as edits; they're available to the server via
          // the live snapshot but intentionally don't move active-time counters.
          if (event.path) a.filesTouched.add(event.path)
          break
        }
        default:
          return
      }

      setSignals(snapshot())
    },
    [noteEdit, snapshot],
  )

  const reset = useCallback(() => {
    startedAtRef.current = Date.now()
    accRef.current = {
      totalKeystrokes: 0,
      pasteEvents: [],
      largePasteCount: 0,
      perFileEditCounts: {},
      fileSwitchCount: 0,
      filesTouched: new Set(),
      firstEditAt: null,
      lastEditAt: null,
      lastEditEpoch: null,
      totalActiveMs: 0,
      idleGapCount: 0,
      longestIdleMs: 0,
    }
    setSignals(emptySignals())
  }, [])

  return useMemo(() => ({ signals, onActivity, reset }), [signals, onActivity, reset])
}

export default useActivityTracker
