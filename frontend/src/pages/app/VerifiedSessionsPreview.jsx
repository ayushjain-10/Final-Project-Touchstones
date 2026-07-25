import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import Seo from '../../components/Seo.jsx'
import { Container, Pill } from '../../components/primitives.jsx'
import ResultCard from '../../components/ResultCard.jsx'
import Reveal from '../../components/Reveal.jsx'
import {
  Check,
  X,
  ShieldCheck,
  Fingerprint,
  Clock,
  FileText,
  Lock,
  Play,
  Sparkle,
  Flag,
  ArrowRight,
  ChevronRight,
  Eye,
} from '../../components/icons.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// VerifiedSessionsPreview — the P2-1 CLICKABLE STORYBOARD for the optional
// verified-session layer (ADR-001). This is a STATIC design storyboard: no
// getUserMedia, no MediaRecorder, no backend calls, no new tables. It exists to
// make the ADR'd "next phase" demo-able to design partners and to give the honest,
// visible answer to "how do you catch a proxy?" — a consented, recruiter-toggled,
// human-reviewed walkthrough, surveillance-free.
//
// Gated behind VITE_VERIFIED_SESSIONS_PREVIEW === 'true' (route only mounts when
// on — see App.jsx), no nav entry, direct URL only. A persistent "not yet
// functional" banner sits above every frame. Candidate-facing copy is verbatim
// from ADR §5/§8/§10/§7 where the ADR specifies it.
//
// Visual note (tasteful choices, flagged per the brief): icons the shared set
// lacks (camera / mic / waveform) are inlined locally rather than added to the
// shared icons.jsx, to keep this a single self-contained file. Frames render in
// the light recruiter theme; the real candidate components will add dark: hex
// variants per ADR §12. Toggles/attestation are local-state only (no capture).
// ─────────────────────────────────────────────────────────────────────────────

// ── Local inline icons (self-contained; not added to the shared set) ──────────
const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}
function CameraIcon({ size = 18, className = '' }) {
  return (
    <svg {...svgBase} width={size} height={size} className={className}>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}
function MicIcon({ size = 18, className = '' }) {
  return (
    <svg {...svgBase} width={size} height={size} className={className}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  )
}

// ── A calm on/off switch (visual state only — never requests a device) ────────
function Switch({ on, onChange, disabled, label, id }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-clay-300 ${
        on ? 'bg-clay-500' : 'bg-stone-300'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// ── The verbatim candidate-impact copy shown to the recruiter (ADR §10) ───────
const RECRUITER_IMPACT_COPY =
  'This is optional for the candidate. Candidates see a consent screen first, can choose ' +
  'audio-only or a typed walkthrough instead, and declining never affects their score or ' +
  'standing — you will not see whether a candidate declined, and no declined signal exists ' +
  'anywhere. Recordings auto-delete when you finish your review (or after 90 days at the ' +
  'latest); your written review note and the transcript are kept as the hiring record for your ' +
  'configured retention period (default 1 year, per US record-keeping rules). No facial ' +
  'recognition, no emotion analysis, no automated decisions — a human (you) reviews it, for ' +
  'session integrity only.'

// ── Frame 1 — Recruiter per-screen toggles (ADR §10) ──────────────────────────
function FrameRecruiterToggles() {
  // Dependency (ADR §10): video requires audio+walkthrough; audio requires walkthrough.
  const [walkthrough, setWalkthrough] = useState(false)
  const [audio, setAudio] = useState(false)
  const [video, setVideo] = useState(false)

  const setWalkthroughSafe = (v) => {
    setWalkthrough(v)
    if (!v) {
      setAudio(false)
      setVideo(false)
    }
  }
  const setAudioSafe = (v) => {
    setAudio(v)
    if (!v) setVideo(false)
    if (v) setWalkthrough(true)
  }
  const setVideoSafe = (v) => {
    setVideo(v)
    if (v) {
      setAudio(true)
      setWalkthrough(true)
    }
  }

  const rows = [
    {
      id: 'walkthrough',
      label: 'Walkthrough step',
      desc: 'Offer candidates a short “explain your approach” step after they submit.',
      on: walkthrough,
      set: setWalkthroughSafe,
    },
    {
      id: 'audio',
      label: 'Audio walkthrough',
      desc: 'Spoken walkthrough (audio only). Requires the walkthrough step.',
      on: audio,
      set: setAudioSafe,
    },
    {
      id: 'video',
      label: 'Video presence',
      desc: 'Camera presence during the walkthrough. Requires audio + walkthrough.',
      on: video,
      set: setVideoSafe,
    },
  ]

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-5 py-4">
          <div>
            <h3 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
              <ShieldCheck size={16} className="text-clay-500" /> Verified session
            </h3>
            <p className="text-xs text-stone-500">Optional per-screen assurance · all off by default</p>
          </div>
          <Pill tone="neutral">Screen authoring</Pill>
        </div>

        <div className="divide-y divide-stone-200 px-5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-4 py-4">
              <label htmlFor={r.id} className="min-w-0 cursor-pointer">
                <span className="text-sm font-medium text-ink">{r.label}</span>
                <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{r.desc}</p>
              </label>
              <Switch id={r.id} on={r.on} onChange={r.set} label={r.label} />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-stone-200 bg-canvas/70 px-5 py-3 text-xs text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} className="text-stone-400" /> Combined candidate time
          </span>
          <span className="font-medium text-ink">
            {walkthrough ? '+ about 90 seconds' : 'No added time'}
          </span>
        </div>
      </div>

      {/* Verbatim candidate-impact copy (ADR §10) — always shown at the toggle. */}
      <div className="mt-4 rounded-2xl border border-clay-200 bg-clay-50 px-4 py-3.5 text-xs leading-relaxed text-clay-800">
        <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-clay-900">
          <Eye size={13} /> What the candidate experiences
        </p>
        <p>{RECRUITER_IMPACT_COPY}</p>
      </div>
    </div>
  )
}

// ── Frame 2 — Candidate consent screen (ADR §8) ───────────────────────────────
function FrameConsent() {
  const [collect, setCollect] = useState(false)
  const [share, setShare] = useState(false)
  const sections = [
    {
      icon: MicIcon,
      title: 'What’s recorded',
      body: 'Your spoken (or typed) walkthrough — about 90 seconds. The camera and mic are used only during this step, never the whole session.',
    },
    {
      icon: Eye,
      title: 'Why',
      body: 'A named human recruiter reviews it solely to confirm you completed the session and can explain your approach.',
    },
    {
      icon: Clock,
      title: 'How long it’s kept',
      body: 'The recording auto-deletes when the reviewer finishes (or within 90 days). Your transcript and their review note are kept as the hiring record. Removal from backups completes within 30 days.',
    },
    {
      icon: Lock,
      title: 'Storage & your rights',
      body: 'Encrypted in transit and at rest. You can access, download, or delete your recording at any time. The employer is the controller of this recording.',
    },
  ]
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-6 sm:p-7">
        <h3 className="font-serif text-2xl font-semibold text-ink">Before anything is recorded</h3>
        <p className="mt-1 text-sm text-stone-500">
          From <span className="font-medium text-ink">Northwind Robotics</span> · completely optional
        </p>

        {/* Negative list — visually prominent (ADR §8). */}
        <div className="mt-5 flex gap-3 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3.5">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-clay-600" />
          <p className="text-sm font-medium leading-relaxed text-clay-900">
            No facial recognition, no identity matching, no voiceprint, no emotion or attention
            analysis, and no automated decision is ever made from this recording.
          </p>
        </div>

        <dl className="mt-5 space-y-4">
          {sections.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.title} className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-canvas text-clay-600 ring-1 ring-stone-200">
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <dt className="text-sm font-medium text-ink">{s.title}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-stone-500">{s.body}</dd>
                </div>
              </div>
            )
          })}
        </dl>

        {/* Optional + no-penalty alternative (verbatim, ADR §8). */}
        <p className="mt-5 rounded-xl bg-canvas/70 px-4 py-3 text-sm leading-relaxed text-stone-600 ring-1 ring-stone-200">
          It’s optional: <span className="font-medium text-ink">declining does not affect your score
          or consideration — you can type your walkthrough instead.</span>
        </p>

        {/* Two distinct affirmative acts: collection + sharing (ADR §8). */}
        <div className="mt-5 space-y-2.5">
          {[
            { on: collect, set: setCollect, text: 'I agree to record this optional walkthrough.' },
            {
              on: share,
              set: setShare,
              text: 'I agree it may be shared with the employer’s hiring team for this role.',
            },
          ].map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => c.set(!c.on)}
              className="flex w-full items-start gap-2.5 rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-left text-sm text-stone-700 transition-colors hover:border-clay-300"
            >
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                  c.on ? 'border-clay-500 bg-clay-500 text-white' : 'border-stone-300 bg-white'
                }`}
              >
                {c.on && <Check size={13} />}
              </span>
              {c.text}
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!collect || !share} className="btn-primary px-4 py-2.5 text-sm disabled:opacity-50">
            Record my walkthrough <ArrowRight size={15} />
          </button>
          <button type="button" className="btn-ghost px-4 py-2.5 text-sm">
            Type it instead
          </button>
          <button type="button" className="text-sm font-medium text-stone-500 hover:text-stone-700">
            No thanks — I’m done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Frame 3 — Capture / green-room device check (ADR §5) ──────────────────────
function FrameDeviceCheck() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-6 sm:p-7">
        <h3 className="font-serif text-xl font-semibold text-ink">Quick device check</h3>
        <p className="mt-1 text-sm text-stone-500">
          A short green room before you record — nothing is saved here.
        </p>

        {/* Camera preview placeholder (no real getUserMedia). */}
        <div className="mt-5 grid aspect-video w-full place-items-center rounded-2xl border border-stone-200 bg-stone-100 text-stone-400">
          <div className="flex flex-col items-center gap-2">
            <CameraIcon size={30} />
            <span className="text-xs font-medium">Camera preview</span>
          </div>
        </div>

        {/* Mic level meter (static bars). */}
        <div className="mt-4 flex items-center gap-3">
          <MicIcon size={18} className="text-clay-600" />
          <div className="flex h-4 flex-1 items-end gap-1">
            {[6, 10, 14, 9, 16, 12, 7, 13, 8, 5].map((h, i) => (
              <span key={i} className="w-full rounded-sm bg-clay-400/70" style={{ height: `${h}px` }} />
            ))}
          </div>
          <span className="text-xs text-stone-400">Mic level</span>
        </div>

        {/* "Ensure you're alone" cue — verbatim (ADR §5). */}
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100">
          Please make sure you’re alone, or that anyone with you is okay being recorded.
        </p>

        {/* Locale + tier choices (equal-weight framing, ADR §5). */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-stone-500">
            Transcript language
            <span className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink">
              English (US) ▾
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary px-4 py-2.5 text-sm">
            <CameraIcon size={15} /> Enable camera &amp; mic
          </button>
          <button type="button" className="btn-ghost px-4 py-2.5 text-sm">
            <MicIcon size={15} /> Microphone only
          </button>
          <button type="button" className="text-sm font-medium text-clay-700 hover:text-clay-800">
            Prefer to type instead?
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Every option is equal weight — a typed walkthrough is reviewed the same way. Declining any
          of these never affects your result.
        </p>
      </div>
    </div>
  )
}

// ── Frame 4 — Walkthrough recorder (ADR §5) ───────────────────────────────────
function FrameRecorder() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-6 sm:p-7">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          <Sparkle size={13} className="text-clay-500" /> Explain your approach
        </span>
        {/* Submission-grounded prompt (topic-label-safe per ADR §7). */}
        <p className="mt-2 font-serif text-lg font-semibold leading-snug text-ink">
          In about 90 seconds, walk us through how you approached the double-charge fix — what you
          tried first, and how you knew it worked.
        </p>

        {/* Recorder surface: mock waveform + timer + recording indicator (no green). */}
        <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-flag-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-flag-500" /> Recording
            </span>
            <span className="font-mono text-sm tabular-nums text-stone-600">0:47 / 1:30</span>
          </div>
          <div className="mt-4 flex h-14 items-center gap-1">
            {Array.from({ length: 48 }).map((_, i) => {
              const h = 10 + Math.abs(Math.sin(i * 0.7)) * 40
              const done = i < 25
              return (
                <span
                  key={i}
                  className={`w-full rounded-full ${done ? 'bg-clay-400' : 'bg-stone-300'}`}
                  style={{ height: `${h}px` }}
                />
              )
            })}
          </div>
        </div>
        {/* aria-live-style countdown note (ADR §5: announced at 60/30/10s). */}
        <p className="mt-2 text-xs text-stone-400">Auto-stops at 1:30 · you can re-record once.</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary px-4 py-2.5 text-sm">
            <Play size={15} /> Stop &amp; review
          </button>
          <button type="button" className="btn-ghost px-4 py-2.5 text-sm">
            Re-record
          </button>
        </div>

        {/* Equal-weight typed alternative — 5-minute window (ADR §5, Tier 3). */}
        <div className="mt-6 border-t border-stone-200 pt-5">
          <p className="text-sm font-medium text-ink">Prefer to type? You’ll get 5 minutes.</p>
          <textarea
            rows={3}
            readOnly
            placeholder="Type your walkthrough here — reviewed exactly the same way as a recording."
            className="mt-2 w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100"
          />
        </div>
      </div>
    </div>
  )
}

// ── Frame 5 — Recruiter review: WalkthroughPanel next to the work (ADR §12) ───
function FrameReview() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The work — reusing the real ResultCard so the walkthrough sits next to it. */}
        <div>
          <ResultCard variant="compact" />
        </div>

        {/* The WalkthroughPanel (the ADR §12 review surface). */}
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
                <Play size={16} className="text-clay-500" /> Walkthrough
              </h3>
              {/* Only "completed" — never a tier/declined label (ADR §12). */}
              <Pill tone="clay">
                <Check size={12} /> Completed
              </Pill>
            </div>

            {/* Player placeholder. */}
            <div className="mt-3 grid aspect-video w-full place-items-center rounded-xl border border-stone-200 bg-stone-900/90 text-white/80">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
                <Play size={18} />
              </span>
            </div>

            {/* Transcript + permanent accuracy note (verbatim, ADR §7). */}
            <div className="mt-3 rounded-xl bg-canvas/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                Transcript
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
                “First I reproduced the double-charge under concurrent retries, then I keyed
                idempotency on a unique constraint before the gateway call, and I proved it with a
                test that fires two charges with the same key…”
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
                Automated transcript — may contain errors, especially for accented speech. The
                recording is the source of truth.
              </p>
            </div>

            {/* Advisory review-flag chip — NEVER pass/fail (ADR §7/§12). */}
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-clay-50 px-3 py-1 text-xs font-medium text-clay-700 ring-1 ring-clay-200">
              <Fingerprint size={13} /> Consistent with continuous human work
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
              Advisory only — a prompt for your judgment, never a pass/fail or an automated decision.
            </p>
          </div>

          {/* Review note + integrity-only attestation (load-bearing, ADR §10). */}
          <div className="card p-5">
            <h3 className="font-serif text-base font-semibold text-ink">Your review</h3>
            <textarea
              rows={3}
              readOnly
              placeholder="Short note on what you observed…"
              className="mt-2 w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100"
            />
            <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-stone-600">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-stone-300 bg-white" />
              I am assessing session integrity only — not appearance, accent, or background.
            </label>
            <div className="mt-3 flex items-center justify-between">
              <button type="button" className="btn-primary px-4 py-2 text-xs">
                Save review
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-clay-700 hover:text-clay-800">
                <FileText size={13} /> Playback access log
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── The storyboard shell: stepper + persistent preview banner ─────────────────
const FRAMES = [
  { key: 'toggles', label: 'Recruiter settings', audience: 'Recruiter', el: <FrameRecruiterToggles /> },
  { key: 'consent', label: 'Candidate consent', audience: 'Candidate', el: <FrameConsent /> },
  { key: 'device', label: 'Device check', audience: 'Candidate', el: <FrameDeviceCheck /> },
  { key: 'record', label: 'Walkthrough', audience: 'Candidate', el: <FrameRecorder /> },
  { key: 'review', label: 'Recruiter review', audience: 'Recruiter', el: <FrameReview /> },
]

export default function VerifiedSessionsPreview() {
  const [step, setStep] = useState(0)
  const frame = FRAMES[step]
  const atStart = step === 0
  const atEnd = step === FRAMES.length - 1

  return (
    <div className="min-h-screen bg-paper">
      <Seo title="Verified sessions — storyboard" />

      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur-md">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          <span className="hidden items-center gap-1.5 text-xs text-stone-500 sm:inline-flex">
            <ShieldCheck size={14} className="text-clay-500" /> Verified sessions · storyboard
          </span>
        </Container>
      </header>

      <Container className="py-8 sm:py-10">
        {/* Persistent, on-every-frame preview banner. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="inline-flex items-center gap-2">
            <Flag size={15} className="text-amber-600" />
            <span>
              <span className="font-semibold">Preview — design storyboard, not yet functional.</span>{' '}
              A clickable walkthrough of the optional, consent-based verified-session layer (ADR-001).
            </span>
          </span>
          <Link to="/threat-model" className="inline-flex items-center gap-1 font-semibold text-amber-800 hover:text-amber-900">
            The threat model <ChevronRight size={14} />
          </Link>
        </div>

        {/* Stepper header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={frame.audience === 'Recruiter' ? 'clay' : 'neutral'}>{frame.audience} view</Pill>
            <span className="text-xs text-stone-400">
              Step {step + 1} of {FRAMES.length}
            </span>
          </div>
          <h1 className="mt-2 font-serif text-2xl font-semibold text-ink">{frame.label}</h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FRAMES.map((f, i) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Go to ${f.label}`}
                aria-current={i === step}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-8 bg-clay-500' : 'w-4 bg-stone-300 hover:bg-stone-400'
                }`}
              />
            ))}
          </div>
        </div>

        {/* The active frame */}
        <Reveal key={frame.key}>{frame.el}</Reveal>

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={atStart}
            className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
          >
            <ChevronRight size={15} className="rotate-180" /> Back
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(FRAMES.length - 1, s + 1))}
            disabled={atEnd}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </Container>
    </div>
  )
}
