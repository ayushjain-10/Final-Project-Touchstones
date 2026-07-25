import { useEffect, useRef, useState } from 'react'
import { api } from '../../services/api.js'
import { useMediaCapture } from '../../hooks/useMediaCapture.js'
import {
  ShieldCheck,
  Fingerprint,
  Check,
  Camera,
  Mic,
  Play,
  Lock,
  ArrowRight,
  FileText,
} from '../../components/icons.jsx'

// Optional verified session — the REAL candidate flow (ADR-001, Phase 2).
//
// Phase-2 boundary (ADR §17): consent → device check → record → LOCAL self-review → discard.
// NO byte leaves the browser; upload/storage/transcription are Phases 3–4. The candidate is
// told plainly that nothing was saved. Consent-before-capture is enforced by flow order (the
// consent screen renders first; a device is never requested until "Continue"). Consent grant/
// withdraw hit be-build's server-mediated endpoints best-effort (fail-closed enforcement is the
// server's job in Phase 3, when capture actually uploads).
//
// Rendered only when VITE_ENABLE_VERIFIED_SESSION is on AND the screen is enabled AND there is a
// real signed-in submission (never in demo / signed-out) — see Candidate.jsx. Flag OFF ⇒ this
// component is never mounted, so today's flow is byte-identical.

const CONSENT_VERSION = 'vs-2026-07-01'

// Locales offered for the (future) transcript; drives ASR equity (ADR §7). Phase 2 stores nothing,
// but the choice is part of the green room so the copy and flow are real.
const LOCALES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'pt-BR', label: 'Português (BR)' },
  { value: 'hi-IN', label: 'हिन्दी' },
]

// Live mic level meter for the green room (ADR §5). Self-contained AnalyserNode + rAF with
// teardown; degrades to nothing if the AudioContext can't start.
function MicMeter({ stream }) {
  const [level, setLevel] = useState(0)
  const bars = 12
  useEffect(() => {
    if (!stream) return undefined
    let ctx, raf
    // B-22: cleanup ALWAYS closes the AudioContext (browsers cap live contexts) — even if setup
    // throws after `new AudioCtx()`, where the old `catch { return undefined }` leaked it.
    const cleanup = () => {
      if (raf) cancelAnimationFrame(raf)
      if (ctx) {
        try { ctx.close() } catch { /* already closed */ }
      }
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return undefined
      ctx = new AudioCtx()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let lastActive = -1 // only re-render when the quantized bar count changes, not every frame
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128))
        const active = Math.min(bars, Math.round(Math.min(1, peak / 96) * bars))
        if (active !== lastActive) { lastActive = active; setLevel(active / bars) }
        raf = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      cleanup()
      return undefined
    }
    return cleanup
  }, [stream])

  const active = Math.round(level * bars)
  return (
    <div className="flex items-center gap-3">
      <Mic size={18} className="text-clay-600 dark:text-[#9DA9EF]" />
      <div className="flex h-4 flex-1 items-end gap-1" aria-hidden="true">
        {Array.from({ length: bars }).map((_, i) => (
          <span
            key={i}
            className={`w-full rounded-sm ${i < active ? 'bg-clay-400' : 'bg-stone-200 dark:bg-[#25304D]'}`}
            style={{ height: `${6 + (i % 4) * 3}px` }}
          />
        ))}
      </div>
      <span className="text-xs text-stone-400 dark:text-[#8490AE]">Mic level</span>
    </div>
  )
}

function fmt(totalS) {
  const m = Math.floor(totalS / 60)
  const s = totalS % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Card shell matching the candidate portal surfaces (light + dark-aware).
function Panel({ children }) {
  return (
    <div className="mt-8 rounded-2xl border border-stone-200 bg-canvas/60 p-6 dark:border-[#25304D] dark:bg-[#0D1426] sm:p-7">
      {children}
    </div>
  )
}

export default function VerifiedSession({ submissionId, task }) {
  // offer → consent → device → capture → typed → done → declined
  const [phase, setPhase] = useState('offer')
  const [collect, setCollect] = useState(false)
  const [share, setShare] = useState(false)
  const [locale, setLocale] = useState('en-US')
  const [reRecordUsed, setReRecordUsed] = useState(false)
  const [typed, setTyped] = useState('')
  const [consentError, setConsentError] = useState(false)

  const cap = useMediaCapture()
  const videoRef = useRef(null)
  // Evidence-grade rule: the consent screen renders ONLY the server's canonical copy (the server
  // stamps consent_copy_hash over exactly {consent_version, blocks}). No local fallback for grants —
  // if the copy can't be fetched, the recorded offer is unavailable (the typed tier needs no consent
  // and stays available).
  const [copy, setCopy] = useState(null) // { consent_version, blocks } | null
  const [copyState, setCopyState] = useState('loading') // 'loading' | 'ready' | 'unavailable'
  const consentVersion = copy?.consent_version || CONSENT_VERSION

  useEffect(() => {
    let active = true
    api
      .getVerifiedSessionConsentCopy()
      .then((res) => {
        if (!active) return
        if (res?.consent_version && Array.isArray(res.blocks) && res.blocks.length) {
          setCopy(res)
          setCopyState('ready')
        } else {
          setCopyState('unavailable')
        }
      })
      .catch(() => {
        if (active) setCopyState('unavailable')
      })
    return () => {
      active = false
    }
  }, [])

  // Attach the live/recorded stream to the <video> preview (av tier only).
  useEffect(() => {
    if (videoRef.current && cap.stream && cap.tier === 'av') {
      videoRef.current.srcObject = cap.stream
    }
  }, [cap.stream, cap.tier, phase])

  // Unified release (ADR §8): consent to every capture modality up front; the candidate then
  // chooses which tier actually uses the camera/mic. Per-modality per be-build's contract.
  // Best-effort in Phase 2 (nothing uploads) — a failure surfaces softly, never traps the candidate.
  async function goToRecord() {
    setConsentError(false)
    try {
      await Promise.all(
        ['walkthrough_recording', 'microphone', 'camera'].map((modality) =>
          api.recordVerifiedSessionConsent(submissionId, { modality, decision: 'granted', consentVersion }),
        ),
      )
    } catch {
      // Evidence-grade rule: no recorded server-side grant = no capture. The candidate can retry
      // or use the typed tier (which needs no consent) — they are never trapped or penalized.
      setConsentError(true)
      return
    }
    setPhase('device')
  }

  // Typed (Tier 3) needs no capture consent (be-build's contract).
  function goToTyped() {
    setPhase('typed')
  }

  // Declining AT the consent screen records a declined decision (rides the chain, never surfaced to
  // recruiters — ADR Principle 7). Declining the offer up front shows no consent screen, so there's
  // nothing to record.
  async function declineConsent() {
    try {
      await api.recordVerifiedSessionConsent(submissionId, {
        modality: 'walkthrough_recording',
        decision: 'declined',
        consentVersion,
      })
    } catch {
      /* best-effort */
    }
    cap.reset()
    setPhase('declined')
  }

  function decline() {
    cap.reset()
    setPhase('declined')
  }

  function finish() {
    cap.reset()
    setPhase('done')
  }

  async function chooseTier(tier) {
    const ok = await cap.requestDevices(tier)
    if (ok) setPhase('capture')
    // On failure the hook sets errorKind; we stay on 'device' and show recovery below.
  }

  function reRecord() {
    cap.discard()
    setReRecordUsed(true)
  }

  // ── Offer (ADR §8 verbatim) ──────────────────────────────────────────────
  if (phase === 'offer') {
    return (
      <Panel>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200 dark:bg-clay-500/10 dark:ring-clay-500/30">
            <Fingerprint size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="font-serif text-lg font-semibold text-ink dark:text-[#F4F6FF]">
              Optional: add a short walkthrough.
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-[#AEB7D0]">
              Explain your approach in your own words — about 90 seconds spoken, or type it instead.
              A human reviewer watches or reads it alongside your work.{' '}
              <span className="font-medium text-ink dark:text-[#F4F6FF]">
                Totally optional: skipping it never affects your result.
              </span>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {copyState === 'ready' ? (
                <button type="button" onClick={() => setPhase('consent')} className="btn-primary px-4 py-2.5 text-sm">
                  Add a walkthrough <ArrowRight size={15} />
                </button>
              ) : copyState === 'loading' ? (
                <span className="text-sm text-stone-400 dark:text-[#8490AE]">Checking availability…</span>
              ) : (
                <>
                  {/* Evidence-grade rule: no server copy = no recorded walkthrough offer. Typed needs no consent. */}
                  <span className="text-sm text-stone-500 dark:text-[#AEB7D0]">
                    Recording isn’t available right now — you can type your walkthrough instead.
                  </span>
                  <button type="button" onClick={goToTyped} className="btn-ghost px-4 py-2.5 text-sm">
                    Type it instead
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={decline}
                className="text-sm font-medium text-stone-500 hover:text-stone-700 dark:text-[#AEB7D0] dark:hover:text-[#F4F6FF]"
              >
                No thanks — I’m done
              </button>
            </div>
          </div>
        </div>
      </Panel>
    )
  }

  // ── Consent — rendered ONLY from the server's canonical blocks (the hash covers exactly this) ──
  if (phase === 'consent') {
    if (copyState !== 'ready') {
      // Shouldn't be reachable (the offer gates entry), but never render local consent copy.
      setPhase('offer')
      return null
    }
    const blocks = copy.blocks
    const ackState = { collect: { on: collect, set: setCollect }, share: { on: share, set: setShare } }
    return (
      <Panel>
        <p className="text-sm text-stone-500 dark:text-[#8490AE]">
          From{' '}
          <span className="font-medium text-ink dark:text-[#F4F6FF]">
            {task?.company || 'the hiring team'}
          </span>{' '}
          · completely optional
        </p>

        {blocks.map((b, i) => {
          if (b.type === 'heading') {
            return (
              <h2 key={i} className="mt-2 font-serif text-2xl font-semibold text-ink dark:text-[#F4F6FF]">
                {b.text}
              </h2>
            )
          }
          if (b.type === 'body') {
            return (
              <p key={i} className="mt-4 text-sm leading-relaxed text-stone-600 dark:text-[#AEB7D0]">
                {b.text}
              </p>
            )
          }
          if (b.type === 'list') {
            return (
              <div key={i} className="mt-5 flex gap-3 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3.5 dark:border-clay-500/30 dark:bg-clay-500/10">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-clay-600 dark:text-[#9DA9EF]" />
                <div className="min-w-0">
                  {b.title ? (
                    <p className="text-sm font-semibold text-clay-900 dark:text-[#C8CEFA]">{b.title}</p>
                  ) : null}
                  <ul className="mt-1 space-y-0.5 text-sm font-medium leading-relaxed text-clay-900 dark:text-[#C8CEFA]">
                    {(b.items || []).map((it, j) => (
                      <li key={j}>{it}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          }
          if (b.type === 'detail') {
            return (
              <dl key={i} className="mt-5 space-y-4 text-sm">
                {(b.items || []).map((it, j) => (
                  <div key={j}>
                    <dt className="font-medium text-ink dark:text-[#F4F6FF]">{it.title}</dt>
                    <dd className="mt-0.5 text-xs leading-relaxed text-stone-500 dark:text-[#AEB7D0]">{it.body}</dd>
                  </div>
                ))}
              </dl>
            )
          }
          if (b.type === 'ack') {
            const s = ackState[b.id]
            if (!s) return null
            return (
              <div key={i} className="mt-2.5 first-of-type:mt-5">
                <button
                  type="button"
                  aria-pressed={s.on}
                  onClick={() => s.set(!s.on)}
                  className="flex w-full items-start gap-2.5 rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-left text-sm text-stone-700 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
                >
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                      s.on ? 'border-clay-500 bg-clay-500 text-white' : 'border-stone-300 bg-white dark:border-[#4a4136] dark:bg-transparent'
                    }`}
                  >
                    {s.on && <Check size={13} />}
                  </span>
                  {b.label}
                </button>
              </div>
            )
          }
          return null
        })}

        {consentError && (
          <p className="mt-3 text-xs text-amber-700 dark:text-[#D9A441]" role="alert">
            We couldn’t record your consent, so recording can’t start. Try again — or type your
            walkthrough instead (no consent needed for typing).
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!collect || !share}
            onClick={goToRecord}
            className="btn-primary px-4 py-2.5 text-sm disabled:opacity-50"
          >
            Continue <ArrowRight size={15} />
          </button>
          <button type="button" onClick={goToTyped} className="btn-ghost px-4 py-2.5 text-sm">
            Type it instead
          </button>
          <button
            type="button"
            onClick={declineConsent}
            className="text-sm font-medium text-stone-500 hover:text-stone-700 dark:text-[#AEB7D0] dark:hover:text-[#F4F6FF]"
          >
            Not now
          </button>
        </div>
      </Panel>
    )
  }

  // ── Device check / green room (ADR §5) ───────────────────────────────────
  if (phase === 'device') {
    const err = cap.errorKind
    return (
      <Panel>
        <h2 className="font-serif text-xl font-semibold text-ink dark:text-[#F4F6FF]">Quick device check</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#8490AE]">
          Nothing is recorded yet. Choose how you’d like to give your walkthrough.
        </p>

        {!cap.supported && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-[#D9A441] dark:ring-amber-500/30">
            Your browser doesn’t support in-browser recording — no problem, you can type your
            walkthrough instead.
          </p>
        )}

        {err && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-[#D9A441] dark:ring-amber-500/30">
            {err === 'denied' && 'Camera/mic access was blocked. You can allow it in your browser, try microphone only, or type instead.'}
            {err === 'no_device' && 'We couldn’t find a camera/microphone. Try microphone only, or type your walkthrough instead.'}
            {err === 'busy' && 'Your camera or mic seems to be in use by another app. Close it and retry, or type instead.'}
            {err === 'other' && 'We couldn’t start recording. You can retry, or type your walkthrough instead.'}
          </p>
        )}

        {/* "Ensure you're alone" cue — verbatim (ADR §5). */}
        <p className="mt-4 rounded-xl bg-white/70 px-4 py-3 text-xs leading-relaxed text-stone-600 ring-1 ring-stone-200 dark:bg-[#090E1C] dark:text-[#AEB7D0] dark:ring-[#25304D]">
          Please make sure you’re alone, or that anyone with you is okay being recorded.
        </p>

        <div className="mt-4">
          <label className="text-xs text-stone-500 dark:text-[#8490AE]">
            Transcript language
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="ml-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF]"
            >
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!cap.supported || cap.state === 'requesting'}
            onClick={() => chooseTier('av')}
            className="btn-primary px-4 py-2.5 text-sm disabled:opacity-50"
          >
            <Camera size={15} /> Enable camera &amp; mic
          </button>
          <button
            type="button"
            disabled={!cap.supported || cap.state === 'requesting'}
            onClick={() => chooseTier('audio')}
            className="btn-ghost px-4 py-2.5 text-sm disabled:opacity-50"
          >
            <Mic size={15} /> Microphone only
          </button>
          <button
            type="button"
            onClick={() => setPhase('typed')}
            className="text-sm font-medium text-clay-700 hover:text-clay-800 dark:text-[#9DA9EF]"
          >
            Prefer to type instead?
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-stone-400 dark:text-[#8490AE]">
          Every option is equal weight — a typed walkthrough is reviewed the same way. Declining any
          of these never affects your result.
        </p>
      </Panel>
    )
  }

  // ── Capture: green-room preview → record → local self-review (ADR §5, §17) ─
  if (phase === 'capture') {
    const isAv = cap.tier === 'av'
    const recording = cap.state === 'recording'
    const recorded = cap.state === 'recorded'
    const interrupted = cap.state === 'interrupted'
    const liveMsg = recording ? `Recording — ${cap.remainingS} seconds left.` : ''

    return (
      <Panel>
        {/* Prompt (topic-safe; server-grounded prompt arrives in Phase 4). */}
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-[#8490AE]">
          Explain your approach
        </span>
        <p className="mt-1.5 font-serif text-base font-semibold leading-snug text-ink dark:text-[#F4F6FF]">
          In about 90 seconds, walk us through how you approached this — what you tried first, and
          how you knew it worked.
        </p>

        {/* Live preview (av) or an audio placard; polite live region for a11y. */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-stone-900/90 dark:border-[#25304D]">
          {isAv && !recorded ? (
            <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
          ) : recorded && cap.mediaUrl ? (
            isAv ? (
              <video src={cap.mediaUrl} controls className="aspect-video w-full bg-black" />
            ) : (
              <div className="p-5">
                <audio src={cap.mediaUrl} controls className="w-full" />
              </div>
            )
          ) : (
            <div className="grid aspect-video w-full place-items-center text-white/70">
              <Mic size={30} />
            </div>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {liveMsg}
        </p>

        {cap.state === 'ready' && (
          <>
            <div className="mt-4">
              <MicMeter stream={cap.stream} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={cap.start} className="btn-primary px-4 py-2.5 text-sm">
                <Play size={15} /> Start recording
              </button>
              <button
                type="button"
                onClick={() => {
                  cap.reset()
                  setPhase('device')
                }}
                className="btn-ghost px-4 py-2.5 text-sm"
              >
                Choose a different option
              </button>
            </div>
          </>
        )}

        {recording && (
          <>
            <div className="mt-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-flag-600 dark:text-[#F0846A]">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-flag-500" /> Recording
              </span>
              <span className="font-mono text-sm tabular-nums text-stone-600 dark:text-[#AEB7D0]">
                {fmt(cap.elapsedS)} / 1:30
              </span>
            </div>
            <div className="mt-4">
              <button type="button" onClick={cap.stop} className="btn-primary px-4 py-2.5 text-sm">
                Stop &amp; review
              </button>
            </div>
            <p className="mt-2 text-xs text-stone-400 dark:text-[#8490AE]">Auto-stops at 1:30.</p>
          </>
        )}

        {recorded && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={finish} className="btn-primary px-4 py-2.5 text-sm">
              Use this walkthrough <ArrowRight size={15} />
            </button>
            {!reRecordUsed && (
              <button type="button" onClick={reRecord} className="btn-ghost px-4 py-2.5 text-sm">
                Re-record (once)
              </button>
            )}
          </div>
        )}

        {interrupted && (
          <div className="mt-4">
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-[#D9A441] dark:ring-amber-500/30">
              Your recording was interrupted (a call, screen lock, or the device was needed
              elsewhere). You can try again or type your walkthrough instead.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  cap.reset()
                  setPhase('device')
                }}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  cap.reset()
                  setPhase('typed')
                }}
                className="btn-ghost px-4 py-2.5 text-sm"
              >
                Type instead
              </button>
            </div>
          </div>
        )}
      </Panel>
    )
  }

  // ── Typed alternative — equal weight, 5-minute window (ADR §5, Tier 3) ─────
  if (phase === 'typed') {
    return (
      <Panel>
        <h2 className="font-serif text-xl font-semibold text-ink dark:text-[#F4F6FF]">
          Type your walkthrough
        </h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#8490AE]">
          Reviewed exactly the same way as a recording. You have about 5 minutes.
        </p>
        <textarea
          rows={6}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="In your own words, how did you approach this — what you tried first, and how you knew it worked?"
          className="mt-3 w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-sm text-ink placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF]"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={finish} className="btn-primary px-4 py-2.5 text-sm">
            Done <ArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => setPhase('device')}
            className="text-sm font-medium text-stone-500 hover:text-stone-700 dark:text-[#AEB7D0] dark:hover:text-[#F4F6FF]"
          >
            Record instead
          </button>
        </div>
      </Panel>
    )
  }

  // ── Declined (ADR §8 verbatim) ───────────────────────────────────────────
  if (phase === 'declined') {
    return (
      <Panel>
        <div className="flex items-start gap-3">
          <Check size={18} className="mt-0.5 shrink-0 text-clay-500" />
          <p className="text-sm leading-relaxed text-stone-600 dark:text-[#AEB7D0]">
            No problem — your submission is complete. Nothing was recorded.
          </p>
        </div>
      </Panel>
    )
  }

  // ── Done — Phase-2 honesty: nothing was saved (ADR §17 seam) ──────────────
  return (
    <Panel>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200 dark:bg-clay-500/10 dark:ring-clay-500/30">
          <Check size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-semibold text-ink dark:text-[#F4F6FF]">
            Thanks — your walkthrough is complete.
          </h2>
          <p className="mt-1 inline-flex items-start gap-1.5 text-sm leading-relaxed text-stone-600 dark:text-[#AEB7D0]">
            <Lock size={15} className="mt-0.5 shrink-0 text-clay-500" />
            <span>
              This is an early preview: your walkthrough stayed on your device and was{' '}
              <span className="font-medium text-ink dark:text-[#F4F6FF]">not uploaded or saved</span>.
              Your submission and score are unaffected.
            </span>
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-stone-400 dark:text-[#8490AE]">
            <FileText size={13} /> You can request your data anytime.
          </p>
        </div>
      </div>
    </Panel>
  )
}
