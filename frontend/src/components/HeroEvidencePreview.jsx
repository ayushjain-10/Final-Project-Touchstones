import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, Clock, Code, FileText, Flag } from './icons.jsx'
import { useReducedMotion } from '../hooks/useReducedMotion.js'

const CANDIDATES = [
  {
    id: 'maya-chen',
    initials: 'MC',
    name: 'Maya Chen',
    screen: 'Payments API repair',
    task: 'Fix duplicate charge handling',
    duration: '7m 36s',
    prompts: '6 prompts',
    tests: '18 tests',
    score: 84,
    state: 'Evidence ready',
    stateDetail: 'Awaiting review',
    tone: 'brand',
    focus: [
      { icon: FileText, label: 'AI question', value: 'Idempotency strategy', meta: '10:09 AM' },
      { icon: Code, label: 'Code revision', value: 'Added ledger key', meta: 'Commit a1f3b7c' },
      { icon: CheckCircle, label: 'Test result', value: '12 of 12 passed', meta: 'Test run 12' },
    ],
  },
  {
    id: 'arjun-patel',
    initials: 'AP',
    name: 'Arjun Patel',
    screen: 'Checkout reliability',
    task: 'Stabilize a flaky test suite',
    duration: '5m 12s',
    prompts: '2 prompts',
    tests: '14 tests',
    score: 76,
    state: 'Review suggested',
    stateDetail: 'Test failure to inspect',
    tone: 'warning',
    focus: [
      { icon: FileText, label: 'AI question', value: 'Isolate race condition', meta: '9:22 AM' },
      { icon: Code, label: 'Code revision', value: 'Reworked test setup', meta: 'Commit 7d291fa' },
      { icon: Flag, label: 'Review cue', value: 'One retry remained', meta: 'Human review' },
    ],
  },
  {
    id: 'leila-hassan',
    initials: 'LH',
    name: 'Leila Hassan',
    screen: 'Webhook consumer',
    task: 'Implement retry-safe delivery',
    duration: '3h 46m',
    prompts: '8 prompts',
    tests: '10 tests',
    score: 91,
    state: 'Session complete',
    stateDetail: 'Packet being prepared',
    tone: 'success',
    focus: [
      { icon: FileText, label: 'AI question', value: 'Plan backoff policy', meta: '3:08 PM' },
      { icon: Code, label: 'Code revision', value: 'Added retry queue', meta: 'Commit 981be20' },
      { icon: CheckCircle, label: 'Test result', value: '10 of 10 passed', meta: 'Test run 8' },
    ],
  },
  {
    id: 'sofia-ramirez',
    initials: 'SR',
    name: 'Sofia Ramirez',
    screen: 'Background worker',
    task: 'Add a bounded retry budget',
    duration: '41m 08s',
    prompts: '4 prompts',
    tests: '9 tests',
    score: 82,
    state: 'Integrity flag',
    stateDetail: 'Signal needs review',
    tone: 'danger',
    focus: [
      { icon: Clock, label: 'Work event', value: 'Session resumed', meta: '11:42 AM' },
      { icon: Code, label: 'Code revision', value: 'Capped retry loop', meta: 'Commit 36bd91e' },
      { icon: Flag, label: 'Review cue', value: 'Timeline discontinuity', meta: 'Human review' },
    ],
  },
]

const TONES = {
  brand: {
    badge: 'border-brand-200 bg-brand-50 text-brand-700',
    dot: 'bg-brand-500',
  },
  success: {
    badge: 'border-success-200 bg-success-50 text-success-700',
    dot: 'bg-success-500',
  },
  warning: {
    badge: 'border-warning-200 bg-warning-50 text-warning-700',
    dot: 'bg-warning-500',
  },
  danger: {
    badge: 'border-danger-200 bg-danger-50 text-danger-700',
    dot: 'bg-danger-500',
  },
}

function StateBadge({ candidate }) {
  const tone = TONES[candidate.tone]

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold leading-none ${tone.badge}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
      {candidate.state}
    </span>
  )
}

export default function HeroEvidencePreview({ className = '' }) {
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [screen, setScreen] = useState('all')
  const [state, setState] = useState('all')
  const [selectedId, setSelectedId] = useState(CANDIDATES[0].id)

  const visibleCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return CANDIDATES.filter((candidate) => {
      const matchesQuery =
        !normalizedQuery ||
        `${candidate.name} ${candidate.screen} ${candidate.task}`.toLowerCase().includes(normalizedQuery)
      const matchesScreen = screen === 'all' || candidate.screen === screen
      const matchesState = state === 'all' || candidate.tone === state
      return matchesQuery && matchesScreen && matchesState
    })
  }, [query, screen, state])

  const selectedCandidate =
    visibleCandidates.find((candidate) => candidate.id === selectedId) || visibleCandidates[0]

  const motionProps = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 5 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: { duration: 0.18, ease: 'easeOut' },
      }

  return (
    <section
      aria-label="Interactive evidence ledger preview"
      className={`overflow-hidden rounded-[1.15rem] border border-brand-200/80 bg-canvas shadow-lift ${className}`}
    >
      <div className="border-b border-stone-200 bg-gradient-to-br from-white via-canvas to-brand-50/70 px-4 pb-3 pt-4 sm:px-5 sm:pb-4 sm:pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700">
                <FileText size={14} />
              </span>
              <h2 className="font-serif text-xl font-semibold leading-none text-ink sm:text-[1.35rem]">
                Evidence ledger
              </h2>
            </div>
            <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">
              {visibleCandidates.length} candidates · rubric-linked trails
            </p>
          </div>
          <span className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-medium text-stone-500">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden />
            Live sample
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="col-span-2 sm:col-span-1">
            <span className="sr-only">Search candidates</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search candidates"
              className="h-9 w-full rounded-lg border border-stone-200 bg-white/80 px-3 text-xs text-ink outline-none transition placeholder:text-stone-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label>
            <span className="sr-only">Filter by screen</span>
            <select
              value={screen}
              onChange={(event) => setScreen(event.target.value)}
              className="h-9 w-full rounded-lg border border-stone-200 bg-white/80 px-2.5 text-[11px] font-medium text-stone-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-[7.3rem]"
            >
              <option value="all">All screens</option>
              {CANDIDATES.map((candidate) => (
                <option key={candidate.screen} value={candidate.screen}>
                  {candidate.screen}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by review state</span>
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="h-9 w-full rounded-lg border border-stone-200 bg-white/80 px-2.5 text-[11px] font-medium text-stone-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-[6.8rem]"
            >
              <option value="all">All states</option>
              <option value="brand">Evidence ready</option>
              <option value="success">Complete</option>
              <option value="warning">Review suggested</option>
              <option value="danger">Integrity flag</option>
            </select>
          </label>
        </div>
      </div>

      <div className="px-2 py-2 sm:px-3">
        <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,1fr)_2.4rem_minmax(0,1.15fr)] gap-2 px-2 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-400 sm:grid">
          <span>Candidate</span>
          <span>Screen</span>
          <span>Work trail</span>
          <span className="text-center">Score</span>
          <span>Review state</span>
        </div>

        <div className="space-y-1" aria-label="Candidate evidence rows">
          {visibleCandidates.map((candidate) => {
            const selected = candidate.id === selectedCandidate?.id

            return (
              <motion.button
                layout={!reduceMotion}
                type="button"
                key={candidate.id}
                aria-pressed={selected}
                onClick={() => setSelectedId(candidate.id)}
                className={`relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,1fr)_2.4rem_minmax(0,1.15fr)] sm:gap-2 sm:px-2 sm:py-2 ${
                  selected
                    ? 'border-brand-200 bg-brand-50/75'
                    : 'border-transparent bg-white/55 hover:border-stone-200 hover:bg-white'
                }`}
                whileHover={reduceMotion ? undefined : { x: 2 }}
                transition={{ duration: reduceMotion ? 0 : 0.14 }}
              >
                {selected && (
                  <motion.span
                    layoutId="hero-ledger-selection"
                    className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r-full bg-brand-500"
                    transition={{ duration: reduceMotion ? 0 : 0.2 }}
                    aria-hidden
                  />
                )}

                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-brand-200 bg-white text-[9px] font-bold text-brand-700 shadow-sm">
                    {candidate.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-ink">{candidate.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-stone-500 sm:hidden">
                      {candidate.task}
                    </span>
                  </span>
                </span>

                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-[10px] font-medium text-ink">{candidate.task}</span>
                  <span className="mt-0.5 block truncate text-[9px] text-stone-500">{candidate.screen}</span>
                </span>

                <span className="hidden min-w-0 text-[9px] leading-4 text-stone-500 sm:block">
                  <span className="block text-stone-700">{candidate.duration}</span>
                  <span className="block truncate">{candidate.prompts} · {candidate.tests}</span>
                </span>

                <span className="hidden text-center font-serif text-lg font-semibold tabular-nums text-ink sm:block">
                  {candidate.score}
                </span>

                <span className="flex min-w-0 items-center gap-2 justify-self-end sm:block sm:justify-self-start">
                  <span className="font-serif text-lg font-semibold tabular-nums text-ink sm:hidden">
                    {candidate.score}
                  </span>
                  <span className="min-w-0">
                    <StateBadge candidate={candidate} />
                    <span className="mt-1 hidden truncate text-[9px] text-stone-400 sm:block">
                      {candidate.stateDetail}
                    </span>
                  </span>
                </span>
              </motion.button>
            )
          })}
        </div>

        {visibleCandidates.length === 0 && (
          <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-stone-200 bg-white/50 px-4 text-center">
            <div>
              <p className="text-sm font-semibold text-ink">No matching evidence</p>
              <p className="mt-1 text-xs text-stone-500">Try another candidate, screen, or state.</p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-brand-200/70 bg-gradient-to-r from-brand-950 via-brand-900 to-brand-800 px-4 py-3.5 text-white sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-brand-200">Evidence focus</p>
            <p className="mt-0.5 text-xs font-medium text-white">
              {selectedCandidate ? `${selectedCandidate.name} · ${selectedCandidate.task}` : 'Choose a candidate row'}
            </p>
          </div>
          {selectedCandidate && (
            <span className="shrink-0 rounded-md border border-brand-400/40 bg-white/10 px-2 py-1 font-serif text-sm font-semibold tabular-nums text-white">
              {selectedCandidate.score}/100
            </span>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {selectedCandidate && (
            <motion.div
              key={selectedCandidate.id}
              {...motionProps}
              className="mt-3 grid grid-cols-3 gap-1.5"
            >
              {selectedCandidate.focus.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.label} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] p-2">
                    <div className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-brand-200">
                      <Icon size={10} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>
                    <p className="mt-1 truncate text-[10px] font-medium text-white">{item.value}</p>
                    <p className="mt-0.5 truncate text-[8px] text-brand-200/80">{item.meta}</p>
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
