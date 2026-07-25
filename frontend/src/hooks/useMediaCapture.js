import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Optional verified-session capture (ADR-001, Phase 2 — CLIENT-SIDE ONLY).
//
// Hard Phase-2 boundary: nothing is uploaded. The recorded Blob lives in memory,
// is offered back to the candidate as a local self-review via an object URL, and
// is DISCARDED (URL revoked, tracks stopped) at the end of the flow or on unmount.
// Upload / storage / transcription are Phases 3–4 and are NOT wired here.
//
// Consent-before-capture is enforced by the FLOW ORDER (VerifiedSession renders
// the consent screen first and only then calls requestDevices) — this hook never
// touches a device until requestDevices() is called explicitly (never on mount).
//
// Return identity is useMemo-stabilized (the documented interval-teardown bug in
// useBehavioralSignals): a new object every render would re-fire consumers' effects.

const MAX_MS = 90_000 // 90s spoken cap (ADR §5)

// Codec preference ladders — feature-detected with isTypeSupported (ADR §5).
const AV_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

function pickMimeType(tier) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  const ladder = tier === 'av' ? AV_TYPES : AUDIO_TYPES
  return ladder.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

// Map a getUserMedia rejection to a coarse recovery kind (ADR §5 permission UX).
function classifyGetUserMediaError(err) {
  const name = err && err.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'other'
}

export function useMediaCapture() {
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const urlRef = useRef(null)

  const [state, setState] = useState('idle') // idle | requesting | ready | recording | recorded | interrupted
  const [errorKind, setErrorKind] = useState(null) // denied | no_device | busy | unsupported | interrupted | other
  const [tier, setTier] = useState(null) // 'av' | 'audio'
  const [stream, setStream] = useState(null) // for the live preview
  const [mediaUrl, setMediaUrl] = useState(null) // local object URL for self-review
  const [elapsedS, setElapsedS] = useState(0)

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    !!navigator.mediaDevices.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const stopTracks = useCallback(() => {
    const s = streamRef.current
    if (s) s.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      try {
        URL.revokeObjectURL(urlRef.current)
      } catch {
        /* ignore */
      }
      urlRef.current = null
    }
    setMediaUrl(null)
  }, [])

  // Request a device for the given tier ('av' | 'audio'). Never called on mount —
  // only after the candidate has passed the consent screen and pressed a button.
  const requestDevices = useCallback(
    async (nextTier) => {
      if (!supported) {
        setErrorKind('unsupported')
        setState('idle')
        return false
      }
      setErrorKind(null)
      setState('requesting')
      const constraints =
        nextTier === 'av'
          ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } }
          : { audio: true }
      try {
        const s = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = s
        setStream(s)
        setTier(nextTier)
        setState('ready')
        // If a track ends unexpectedly (iOS lock, app switch, unplug) surface it.
        s.getTracks().forEach((t) => {
          t.onended = () => {
            if (recorderRef.current && recorderRef.current.state === 'recording') {
              try {
                recorderRef.current.stop()
              } catch {
                /* ignore */
              }
            }
            setErrorKind('interrupted')
            setState('interrupted')
          }
        })
        return true
      } catch (err) {
        setErrorKind(classifyGetUserMediaError(err))
        setState('idle')
        return false
      }
    },
    [supported],
  )

  const stop = useCallback(() => {
    clearTimer()
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      try {
        r.stop()
      } catch {
        /* ignore */
      }
    }
  }, [clearTimer])

  const start = useCallback(() => {
    const s = streamRef.current
    if (!s || !supported) return
    const mimeType = pickMimeType(tier)
    let recorder
    try {
      recorder = new MediaRecorder(
        s,
        mimeType ? { mimeType, ...(tier === 'av' ? { videoBitsPerSecond: 1_000_000 } : {}) } : undefined,
      )
    } catch {
      setErrorKind('unsupported')
      return
    }
    chunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      clearTimer()
      const type = recorder.mimeType || (tier === 'av' ? 'video/webm' : 'audio/webm')
      const blob = new Blob(chunksRef.current, { type })
      revokeUrl()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      setMediaUrl(url)
      setState((cur) => (cur === 'interrupted' ? 'interrupted' : 'recorded'))
    }
    recorderRef.current = recorder
    setElapsedS(0)
    recorder.start()
    setState('recording')
    // Elapsed counter + 90s hard cap with a graceful auto-stop.
    timerRef.current = setInterval(() => {
      setElapsedS((prev) => {
        const next = prev + 1
        if (next * 1000 >= MAX_MS) stop()
        return next
      })
    }, 1000)
  }, [tier, supported, clearTimer, revokeUrl, stop])

  // Discard the current take but keep the live stream so the candidate can
  // immediately re-record (exactly one re-record is allowed by the UI). The
  // discarded take's buffer is released right away (ADR §5).
  const discard = useCallback(() => {
    revokeUrl()
    chunksRef.current = []
    setElapsedS(0)
    setState(streamRef.current ? 'ready' : 'idle')
  }, [revokeUrl])

  // Full teardown: stop recording, stop tracks, revoke the local URL. Called when
  // the candidate finishes/declines and on unmount — nothing survives.
  const reset = useCallback(() => {
    clearTimer()
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      try {
        // B-13: detach handlers BEFORE stop() so the late ondataavailable/onstop can't rebuild the
        // full blob into an unrevoked object URL (which would survive teardown — contradicting the
        // hook's "nothing survives" guarantee).
        r.ondataavailable = null
        r.onstop = null
        r.stop()
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null
    chunksRef.current = []
    revokeUrl()
    stopTracks()
    setElapsedS(0)
    setTier(null)
    setErrorKind(null)
    setState('idle')
  }, [clearTimer, revokeUrl, stopTracks])

  // Teardown on unmount — no stranded stream, no leaked object URL.
  useEffect(() => reset, [reset])

  return useMemo(
    () => ({
      supported,
      state,
      errorKind,
      tier,
      stream,
      mediaUrl,
      elapsedS,
      remainingS: Math.max(0, Math.round(MAX_MS / 1000) - elapsedS),
      requestDevices,
      start,
      stop,
      discard,
      reset,
    }),
    [supported, state, errorKind, tier, stream, mediaUrl, elapsedS, requestDevices, start, stop, discard, reset],
  )
}
