import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import Seo from '../../components/Seo.jsx'
import ScoreRing from '../../components/ScoreRing.jsx'
import CriterionBar from '../../components/CriterionBar.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import DecisionCard from '../../components/DecisionCard.jsx'
import ResultCard from '../../components/ResultCard.jsx'
import IntegrityActivityPanel from '../../components/IntegrityActivityPanel.jsx'
import Reveal from '../../components/Reveal.jsx'
import EvidenceNetwork from '../../components/EvidenceNetwork.jsx'
import { Pill } from '../../components/primitives.jsx'
import {
  Sparkle,
  ShieldCheck,
  Check,
  Clock,
  FileText,
  ArrowRight,
  ArrowUpRight,
} from '../../components/icons.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// PUBLIC, signed-out, shareable SAMPLE score report. Lives OUTSIDE the
// VITE_APP_ENABLED gate (like /verify and /passport) so every outreach email can
// link a real, touchable artifact with no signup. Everything here is STATIC,
// clearly-fictional seeded data — no backend, no API calls. It reuses the exact
// in-product result components (DecisionCard, ResultCard, IntegrityActivityPanel)
// so a prospect sees the real thing, not a mockup.
//
// The fetching panels (DirectionPanel / IntegrityActivityPanel) only fetch when
// given a submissionId; we pass their data prop and NO id, so they render fully
// static. The AI-replay + hash-chain sections are hand-authored static views of
// the same signals (a real transcript would require the API).

// ── Static seed: a senior-backend work sample, plausible but clearly fictional ──

const SAMPLE = {
  candidate: 'Sample Candidate',
  company: 'Northwind Robotics (fictional)',
  role: 'Senior Backend Engineer',
  reqId: 'ENG-204',
  task: 'Fix a double-charging payments service',
}

// ResultCard data — criteria sum to the score (88), matching the product convention.
const resultData = {
  role: SAMPLE.role,
  reqId: SAMPLE.reqId,
  task: SAMPLE.task,
  candidate: SAMPLE.candidate,
  score: 88,
  verdict: 'Strong evidence',
  verification: 'verified',
  durationMin: 41,
  aiNote: 'AI allowed: used it well and corrected it twice.',
  criteria: [
    {
      label: 'Problem decomposition',
      points: '22 / 25',
      pct: 88,
      note: 'Reproduced the double-charge before touching code; separated the retry trigger from the root cause.',
    },
    {
      label: 'Correctness under edge cases',
      points: '21 / 25',
      pct: 84,
      note: 'Handled concurrent retries and a partial-failure path; missed one gateway-timeout branch.',
    },
    {
      label: 'Code quality & tests',
      points: '23 / 25',
      pct: 92,
      note: 'Added 6 tests including a concurrent-charge case that reproduces the original bug.',
    },
    {
      label: 'Debugging & root cause',
      points: '22 / 25',
      pct: 88,
      note: 'Keyed idempotency on a unique DB constraint before the gateway call, fixing the cause rather than the symptom.',
    },
  ],
  reasoning:
    'Reproduced the double-charge under concurrent retries before changing anything, then made the gateway call idempotent by keying on the idempotency token behind a unique constraint. The AI evaluates each rubric criterion against this work evidence, and the weighted total is calculated in code and provenance-logged.',
  evidence: [
    'Reproduced the failure before editing',
    'Added 6 tests incl. a concurrent-charge case',
    'Idempotency keyed on a unique constraint',
  ],
}

// DecisionCard inputs (work score + AI-direction + integrity digest). Chosen so
// the fused recommendation reads "Strong — advance" at high confidence.
const decisionScore = { score: 88, criteria: resultData.criteria }
const decisionDirection = {
  direction_score: 82,
  prompt_quality: 78,
  error_catching: 88,
  verification_rigor: 80,
  interaction_count: 7,
}
const digest = {
  event_count: 128,
  verified_chain: true,
  head_hash: '9f2c41ab7de0c8b3a15e6042f7c9d18b',
  summary: {
    typed_fraction: 0.86,
    paste_count: 3,
    paste_chars: 214,
    tab_hidden_count: 2,
    window_blur_count: 1,
    tab_hidden_ms: 42000,
    bot_verdict: false,
  },
  ide_activity: {
    totalKeystrokes: 4120,
    totalActiveMs: 2460000,
    pasteCount: 3,
    largePasteCount: 0,
    fileSwitchCount: 9,
    filesTouched: 4,
    perFileEditCounts: {
      'payments/retry.js': 34,
      'payments/retry.test.js': 22,
      'payments/gateway.js': 11,
      'payments/idempotency.js': 8,
    },
  },
}

// AI-direction sub-scores rendered as CriterionBars (mirrors DirectionPanel).
const directionSubs = [
  { label: 'Prompt quality', pct: 78, note: 'Described the failure and constraints, not just "fix this".' },
  { label: 'Error catching', pct: 88, note: "Caught the AI's first suggestion: retrying, not idempotency." },
  { label: 'Verification rigor', pct: 80, note: 'Asked the AI to prove the fix with a concurrency test.' },
]

// The ownable signal: what the candidate asked the AI, what they accepted, and
// what they corrected. Static transcript; highlight chips mirror the product's
// "caught it / verified / redirected" heuristic vocabulary.
const CHIP = {
  caught: 'bg-brand-100 text-brand-700 ring-brand-300',
  verified: 'bg-brand-100 text-brand-700 ring-brand-300',
  accepted: 'bg-stone-100 text-stone-600 ring-stone-200',
}
const replay = [
  {
    role: 'user',
    time: '02:14',
    text: 'The charge() call double-charges when a request is retried. Where should idempotency live?',
  },
  {
    role: 'ai',
    time: '02:20',
    text: 'Wrap the charge in a try/catch and retry it on failure so transient errors recover.',
  },
  {
    role: 'user',
    time: '03:02',
    chip: 'caught',
    text: "That's not it. Retrying is the trigger, not the fix. The gateway call isn't idempotent. I need to key on the idempotency token before calling the gateway.",
  },
  {
    role: 'ai',
    time: '03:09',
    text: 'Store the idempotency key in a charges table with a unique constraint; on conflict, return the existing charge id.',
  },
  {
    role: 'user',
    time: '05:41',
    chip: 'verified',
    text: 'Add a test that fires two concurrent charges with the same key and asserts the gateway is called once.',
  },
  {
    role: 'ai',
    time: '05:48',
    text: 'Here is a test using Promise.all with two charge() calls sharing the key and a mock gateway spy…',
  },
  {
    role: 'user',
    time: '06:30',
    chip: 'accepted',
    text: 'Good. I kept it and tightened the assertion to check the charges row count is exactly 1.',
  },
]

// Static audit / hash-chain summary — mirrors the Result page audit card.
const auditRows = [
  { t: 'system', e: '128 integrity events recorded', meta: 'Hash-chained, append-only' },
  { t: 'system', e: 'Chain verified', meta: `head ${digest.head_hash.slice(0, 12)}…` },
  { t: '14:41:02', e: 'Weighted total calculated from rubric', meta: 'weighted sum · 88 / 100' },
  { t: '14:41:02', e: 'Session integrity summarized', meta: 'review signals clear' },
]

function CtaButtons({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <Link to="/candidate" className="btn-primary px-4 py-2.5 text-sm">
        <Sparkle size={15} /> Try the candidate view
      </Link>
      <Link to="/contact" className="btn-ghost px-4 py-2.5 text-sm">
        Start a pilot <ArrowRight size={15} />
      </Link>
    </div>
  )
}

function ReplayRow({ turn }) {
  const isUser = turn.role === 'user'
  const highlighted = Boolean(turn.chip)
  return (
    <li
      className={`rounded-lg text-sm ${
        highlighted ? 'border-l-2 border-brand-400 bg-brand-50/60 py-2 pl-3 pr-2' : 'py-1'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isUser ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-stone-100 text-stone-600'
          }`}
        >
          {isUser ? 'Candidate' : 'AI'}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-stone-400">
          <Clock size={11} className="text-stone-400" />
          {turn.time}
        </span>
        {turn.chip && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${CHIP[turn.chip]}`}
          >
            <Sparkle size={10} /> {turn.chip}
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-stone-700">{turn.text}</p>
    </li>
  )
}

export default function SampleReport() {
  if (EDITORIAL_UI_ENABLED) return <EditorialSampleReport />

  return (
    <div className="min-h-screen bg-paper">
      <Seo
        title="Sample score report"
        description="A Touchstones sample report from an AI-allowed real-work screen, with rubric-linked evidence, AI direction signals, and a tamper-evident session record. No signup."
      />

      {/* Header — logo + a clear "this is a sample" label + CTA */}
      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Logo />
          <span className="hidden items-center gap-1.5 text-xs text-stone-500 sm:inline-flex">
            <FileText size={14} className="text-clay-500" /> Sample score report
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
        {/* Fictional-sample banner — an example result is never mistaken for a real candidate. */}
        <Reveal className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-clay-200 bg-clay-50 px-4 py-3 text-sm text-clay-800">
          <span className="inline-flex items-center gap-2">
            <Sparkle size={15} className="text-clay-600" />
            <span>
              <span className="font-semibold">Example report:</span> fictional candidate and company,
              real product. This is exactly what a reviewer sees after a screen.
            </span>
          </span>
        </Reveal>

        {/* Title + intent */}
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="neutral" className="font-mono">
                  req #{SAMPLE.reqId}
                </Pill>
                <span className="text-xs text-stone-400">{SAMPLE.company}</span>
              </div>
              <h1 className="mt-2 text-balance font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl">
                {SAMPLE.task}
              </h1>
              <p className="mt-1 text-stone-600">
                {SAMPLE.role} · AI allowed · weighted total calculated from the rubric
              </p>
            </div>
            <VerifiedBadge state="verified" />
          </div>
        </Reveal>

        {/* Hero — the fused recommendation (reused DecisionCard) */}
        <Reveal className="mt-6">
          <DecisionCard score={decisionScore} direction={decisionDirection} digest={digest} />
        </Reveal>

        {/* "What a reviewer reads in 5 minutes" framing */}
        <Reveal className="mt-6">
          <div className="card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
                <Clock size={16} className="text-clay-500" /> What a reviewer reads in 5 minutes
              </h2>
              <span className="rounded-full bg-clay-50 px-2.5 py-1 text-[11px] font-semibold text-clay-700 ring-1 ring-clay-200">
                5-minute read
              </span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: FileText,
                  title: 'Rubric-linked weighted total',
                  body: 'AI evaluates each criterion from the evidence. Code applies the rubric weights.',
                },
                {
                  icon: Sparkle,
                  title: 'How they directed the AI',
                  body: 'Caught the AI’s wrong first answer, then verified the fix with a test.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Session integrity record',
                  body: 'Typed activity and session events are hash-chained and available for human review.',
                },
              ].map((c) => {
                const Icon = c.icon
                return (
                  <div key={c.title} className="flex gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{c.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{c.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Reveal>

        {/* Body — result card (left) + signal rail (right) */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            {/* The scored work sample (reused ResultCard) */}
            <Reveal>
              <ResultCard data={resultData} variant="full" />
            </Reveal>

            {/* AI usage as signal — asked / accepted / corrected */}
            <Reveal>
              <div className="card p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
                    <Sparkle size={16} className="text-clay-500" /> How they used the AI
                  </h2>
                  <span className="text-xs text-stone-400">7 interactions</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-stone-500">
                  AI was allowed. We measure how well they prompted it, caught its mistakes, and
                  verified its output. These direction signals add context for a human reviewer.
                </p>

                {/* Direction score + sub-dimensions (reused ScoreRing + CriterionBar) */}
                <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                  <ScoreRing value={82} size={104} stroke={9} />
                  <div className="min-w-0 flex-1 space-y-3.5 self-stretch">
                    {directionSubs.map((d, i) => (
                      <CriterionBar
                        key={d.label}
                        label={d.label}
                        points={`${d.pct} / 100`}
                        pct={d.pct}
                        note={d.note}
                        delay={i * 90}
                      />
                    ))}
                  </div>
                </div>

                {/* The replay — asked → accepted → corrected */}
                <div className="mt-5 rounded-xl border border-stone-200 bg-canvas/40 p-3">
                  <p className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-clay-50 px-2.5 py-1 text-[11px] text-clay-700 ring-1 ring-clay-200">
                    <Sparkle size={12} className="text-clay-500" />
                    2 error-catch / verify moments
                    <span className="text-clay-500">· evidence worth reviewing</span>
                  </p>
                  <ol className="space-y-2.5">
                    {replay.map((turn, i) => (
                      <ReplayRow key={i} turn={turn} />
                    ))}
                  </ol>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
                  Highlights are an honest heuristic. They mark moments where the candidate appears to catch
                  or verify the AI. They prompt a read of the replay; they are never a verdict.
                </p>
              </div>
            </Reveal>
          </div>

          {/* Signal rail */}
          <div className="space-y-6">
            {/* Integrity & activity (reused panel — static digest, no submissionId → no API) */}
            <Reveal>
              <IntegrityActivityPanel digest={digest} />
            </Reveal>

            {/* Session integrity */}
            <Reveal className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-base font-semibold text-ink">Session integrity record</h3>
                <VerifiedBadge state="verified" size="sm" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-stone-500">
                Behavioral signals only, observed by the server and never used for identity matching.
                No biometrics or emotion inference. The hash chain covers the server-observed integrity
                event log, and the AI interaction record is append-only. Reviewers use this context
                alongside the work evidence. It never makes the hiring decision.
              </p>
              <Link
                to="/threat-model"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
              >
                Read the exact threat model <ArrowUpRight size={13} />
              </Link>
            </Reveal>

            {/* Audit trail / hash chain (static mirror of the Result page card) */}
            <Reveal className="card p-5">
              <h3 className="font-serif text-base font-semibold text-ink">Audit trail</h3>
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
                <ShieldCheck size={14} className="text-clay-500" /> Explainable &amp; logged by default
              </p>
              <ol className="mt-4 space-y-3.5">
                {auditRows.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-clay-400" />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-stone-400">{a.t}</span>
                        <span className="text-sm text-ink">{a.e}</span>
                      </div>
                      <p className="text-xs text-stone-500">{a.meta}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-clay-700">
                <Check size={14} /> Immutable record, append-only and tamper-evident
              </p>
            </Reveal>
          </div>
        </div>

        {/* Closing CTA band */}
        <Reveal className="mt-10">
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-br from-clay-50/70 to-transparent px-6 py-8 text-center sm:px-10 sm:py-10">
              <h2 className="text-balance font-serif text-2xl font-semibold text-ink sm:text-3xl">
                See it from the candidate’s side
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-stone-600">
                Take the same real-work screen this report came from: AI allowed, five minutes, no
                signup. Then start screening your own req.
              </p>
              <CtaButtons className="mt-6 justify-center" />
              <p className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-stone-400">
                <Link to="/product" className="inline-flex items-center gap-1 hover:text-stone-600">
                  How evidence becomes a credential <ArrowUpRight size={12} />
                </Link>
                <Link to="/trust-center" className="inline-flex items-center gap-1 hover:text-stone-600">
                  Security &amp; data <ArrowUpRight size={12} />
                </Link>
              </p>
            </div>
          </div>
        </Reveal>
      </main>
    </div>
  )
}

const REPORT_LAYERS = [
  { id: 'summary', label: 'Summary', icon: FileText },
  { id: 'work-score', label: 'Work evidence', icon: Check },
  { id: 'direction-panel', label: 'AI direction', icon: Sparkle },
  { id: 'integrity-panel', label: 'Session record', icon: ShieldCheck },
  { id: 'audit-panel', label: 'Audit', icon: Clock },
]

function EditorialSampleReport() {
  const [activeLayer, setActiveLayer] = useState('summary')

  function openLayer(id) {
    setActiveLayer(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-paper bg-evidence-light">
      <Seo
        title="Sample evidence report"
        description="A fictional Touchstones report showing rubric-linked work evidence, AI direction signals, a session record, and a human-owned decision."
      />

      <header className="sticky top-0 z-40 border-b border-stone-200 bg-paper/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-stone-500 md:inline-flex">
              <FileText size={14} className="text-brand-500" /> Fictional sample, real interface
            </span>
            <Link to="/contact" className="btn-primary px-3.5 py-2 text-xs sm:text-sm">
              Start a pilot <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:py-12">
        <Reveal
          as="section"
          id="summary"
          className="relative scroll-mt-28 overflow-hidden border border-brand-400/20 bg-evidence-dark px-6 py-10 text-white sm:px-10 sm:py-14"
        >
          <EvidenceNetwork className="opacity-65" theme="dark" density="normal" />
          <div className="relative z-10 grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-brand-200">
                <Sparkle size={14} /> Example evidence packet
              </p>
              <h1 className="mt-5 max-w-3xl text-balance font-sans text-4xl font-semibold leading-[0.98] tracking-[-0.045em] !text-white sm:text-6xl">
                The answer is the last thing you review.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
                Start with the work, trace it to the rubric, inspect how the candidate directed AI,
                then use the session record as context. A person makes the decision.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-white/60">
                <span className="border border-white/15 bg-white/5 px-3 py-1.5 font-mono">REQ {SAMPLE.reqId}</span>
                <span className="border border-white/15 bg-white/5 px-3 py-1.5">{SAMPLE.role}</span>
                <span className="border border-white/15 bg-white/5 px-3 py-1.5">AI allowed</span>
              </div>
              <CtaButtons className="mt-8 [&_.btn-ghost]:border-white/20 [&_.btn-ghost]:text-white [&_.btn-ghost]:hover:bg-white/10" />
            </div>

            <div className="border border-white/15 bg-black/20 p-5 backdrop-blur-sm sm:p-6">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">Review packet</p>
                  <p className="mt-1 text-sm font-medium text-white">{SAMPLE.task}</p>
                </div>
                <span className="h-2.5 w-2.5 rounded-full bg-brand-300 shadow-[0_0_16px_rgba(116,132,227,0.9)]" />
              </div>
              <dl className="divide-y divide-white/10">
                {[
                  ['Work evidence', '88 / 100'],
                  ['AI direction', '82 / 100'],
                  ['Session context', 'Consistent'],
                  ['Decision owner', 'Human reviewer'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 py-3.5">
                    <dt className="text-sm text-white/55">{label}</dt>
                    <dd className="font-mono text-xs text-white">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-white/10 pt-4 text-xs leading-relaxed text-white/45">
                Fictional candidate and company. The components and review flow are the product interface.
              </p>
            </div>
          </div>
        </Reveal>

        <nav
          aria-label="Report sections"
          className="sticky top-16 z-30 mt-5 overflow-x-auto border-y border-stone-200 bg-paper/95 backdrop-blur-xl"
        >
          <div className="flex min-w-max">
            {REPORT_LAYERS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => openLayer(id)}
                aria-pressed={activeLayer === id}
                className={`inline-flex items-center gap-2 border-r border-stone-200 px-4 py-3 text-xs font-medium transition-colors sm:px-5 ${
                  activeLayer === id
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-stone-500 hover:bg-white hover:text-ink'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </nav>

        <Reveal className="mt-6">
          <DecisionCard
            score={decisionScore}
            direction={decisionDirection}
            digest={digest}
            onAnchor={openLayer}
          />
        </Reveal>

        <Reveal className="mt-6 border border-stone-200 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
              <Clock size={16} className="text-brand-500" /> A five-minute evidence read
            </h2>
            <span className="border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
              Three evidence layers
            </span>
          </div>
          <div className="mt-5 grid border-y border-stone-200 sm:grid-cols-3 sm:divide-x sm:divide-stone-200">
            {[
              {
                icon: FileText,
                target: 'work-score',
                title: 'Rubric-linked work',
                body: 'Each score points back to an observable part of the submitted work.',
              },
              {
                icon: Sparkle,
                target: 'direction-panel',
                title: 'AI direction',
                body: 'Prompting, correction, and verification remain available for reviewer inspection.',
              },
              {
                icon: ShieldCheck,
                target: 'integrity-panel',
                title: 'Session context',
                body: 'Integrity events provide context. They never identify the candidate or decide the outcome.',
              },
            ].map(({ icon: Icon, target, title, body }) => (
              <button
                key={title}
                type="button"
                onClick={() => openLayer(target)}
                className="group flex gap-3 px-1 py-5 text-left first:pl-0 last:pr-0 sm:px-5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center border border-brand-200 bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-stone-500">{body}</span>
                </span>
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Reveal as="section" id="work-score" className="scroll-mt-28">
              <ResultCard data={resultData} variant="full" />
            </Reveal>

            <Reveal
              as="section"
              id="direction-panel"
              className="scroll-mt-28 border border-stone-200 bg-white p-5 sm:p-6"
            >
              <div className="flex items-center justify-between gap-4 border-b border-stone-200 pb-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-600">Evidence layer 02</p>
                  <h2 className="mt-1 inline-flex items-center gap-2 font-serif text-lg font-semibold text-ink">
                    <Sparkle size={17} className="text-brand-500" /> How they directed AI
                  </h2>
                </div>
                <span className="font-mono text-xs text-stone-400">7 interactions</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-stone-500">
                AI was allowed for this example. Prompting, corrections, and verification add
                context for a human reviewer. They do not replace the work score.
              </p>
              <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row">
                <ScoreRing value={82} size={104} stroke={9} />
                <div className="min-w-0 flex-1 space-y-3.5 self-stretch">
                  {directionSubs.map((item, index) => (
                    <CriterionBar
                      key={item.label}
                      label={item.label}
                      points={`${item.pct} / 100`}
                      pct={item.pct}
                      note={item.note}
                      delay={index * 90}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-6 border border-stone-200 bg-canvas/40 p-4">
                <p className="mb-3 inline-flex items-center gap-1.5 border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] text-brand-700">
                  <Sparkle size={12} /> Two correction or verification moments
                </p>
                <ol className="space-y-2.5">
                  {replay.map((turn, index) => <ReplayRow key={index} turn={turn} />)}
                </ol>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
                Highlights are review cues, not verdicts. A reviewer can inspect the source exchange before drawing a conclusion.
              </p>
            </Reveal>
          </div>

          <div className="space-y-6">
            <Reveal as="section" id="integrity-panel" className="scroll-mt-28">
              <IntegrityActivityPanel digest={digest} />
            </Reveal>

            <Reveal className="border border-stone-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-serif text-base font-semibold text-ink">Session record boundary</h3>
                <VerifiedBadge state="verified" size="sm" />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                Server-observed events and edit activity are reviewer context only. Touchstones does
                not perform face matching, emotion inference, or identity scoring. The session record
                never makes the hiring decision.
              </p>
              <Link
                to="/threat-model"
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
              >
                Read the threat model <ArrowUpRight size={13} />
              </Link>
            </Reveal>

            <Reveal
              as="section"
              id="audit-panel"
              className="scroll-mt-28 border border-stone-200 bg-white p-5"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-600">Evidence layer 04</p>
              <h3 className="mt-1 font-serif text-base font-semibold text-ink">Audit trail</h3>
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
                <ShieldCheck size={14} className="text-brand-500" /> Explainable and logged by default
              </p>
              <ol className="mt-4 space-y-3.5">
                {auditRows.map((row, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-stone-400">{row.t}</span>
                        <span className="text-sm text-ink">{row.e}</span>
                      </div>
                      <p className="text-xs text-stone-500">{row.meta}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-brand-700">
                <Check size={14} /> Append-only and tamper-evident
              </p>
            </Reveal>
          </div>
        </div>

        <Reveal
          as="section"
          className="relative mt-10 overflow-hidden bg-evidence-dark px-6 py-10 text-center text-white sm:px-10 sm:py-14"
        >
          <EvidenceNetwork className="opacity-45" theme="dark" density="sparse" interactive={false} />
          <div className="relative z-10">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand-200">From example to live role</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-balance font-sans text-3xl font-semibold tracking-[-0.035em] !text-white sm:text-4xl">
              Run one role. Review the evidence with your team.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
              Bring a real role and rubric. Touchstones helps you build the screen, invite candidates,
              and inspect the work trail together.
            </p>
            <CtaButtons className="mt-7 justify-center [&_.btn-ghost]:border-white/20 [&_.btn-ghost]:text-white [&_.btn-ghost]:hover:bg-white/10" />
            <p className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/45">
              <Link to="/product" className="inline-flex items-center gap-1 hover:text-white">
                How the evidence model works <ArrowUpRight size={12} />
              </Link>
              <Link to="/trust-center" className="inline-flex items-center gap-1 hover:text-white">
                Security and data boundaries <ArrowUpRight size={12} />
              </Link>
            </p>
          </div>
        </Reveal>
      </main>
    </div>
  )
}
