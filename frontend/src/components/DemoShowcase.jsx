import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Kicker } from './primitives.jsx'
import { Lock } from './icons.jsx'
import { useReducedMotion } from '../hooks/useReducedMotion.js'

export function BrowserFrame({ label, children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-canvas ${className}`}>
      <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50/70 px-3.5 py-2.5">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
        </span>
        {label && (
          <span className="mx-auto inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-stone-400 ring-1 ring-stone-200">
            <Lock size={11} /> {label}
          </span>
        )}
        <span className="w-[42px]" aria-hidden />
      </div>
      {children}
    </div>
  )
}

/* ---------------------------------------------------------- DemoChapters ---- */
// Real, full-product screenshots. Displayed big in a browser frame that auto-cycles with a slow
// Ken Burns move (alternating zoom-in / zoom-out) and a smooth crossfade between screens.
const CHAPTERS = [
  {
    key: 'author',
    kicker: 'Step 01 · Author',
    title: 'Author a real-work screen',
    body: 'Pick a role template, set the rubric, and send one candidate link.',
    img: '/demos/shots/author.png',
    label: 'author a screen',
    alt: 'Authoring a role-specific, AI-allowed screen from a template',
  },
  {
    key: 'ide',
    kicker: 'Step 02 · Candidate',
    title: 'Candidates work, AI allowed',
    body: 'A browser IDE with an AI assistant. The submitted work is scored against your rubric, with the session record kept as review context.',
    img: '/demos/shots/ide.png',
    label: 'candidate ide',
    alt: 'The candidate IDE: problem, code editor, and AI assistant',
  },
  {
    key: 'report',
    kicker: 'Step 03 · Report',
    title: 'One explainable report',
    body: 'A score computed in code from your rubric, with the reasoning, work evidence, and session context attached.',
    img: '/demos/shots/report.png',
    label: 'candidate report',
    alt: 'The scored report with reasoning, work evidence, and session context',
  },
  {
    key: 'dashboard',
    kicker: 'Step 04 · Overview',
    title: 'Every result in one place',
    body: 'Track screens, submissions, scores, session records, and outcomes across your whole pipeline.',
    img: '/demos/shots/dashboard.png',
    label: 'workspace overview',
    alt: 'The recruiter dashboard: screens, submissions and outcomes',
  },
]

const DWELL_MS = 5200

// Non-interactive, auto-advancing product tour. Big browser-framed screenshot with a slow Ken Burns
// (alternating zoom-in / zoom-out) and a crossfade between screens, a stories-style progress bar,
// and a caption + dots below. Clicks do nothing. No-ops under prefers-reduced-motion.
export function DemoChapters({ className = '' }) {
  const reduced = useReducedMotion()
  const [active, setActive] = useState(0)
  const fillRef = useRef(null)
  const current = CHAPTERS[active]
  const zoomIn = active % 2 === 0

  useEffect(() => {
    if (reduced) return undefined
    const id = setInterval(() => setActive((n) => (n + 1) % CHAPTERS.length), DWELL_MS)
    return () => clearInterval(id)
  }, [reduced])

  // Refill the stories bar each time the active chapter changes (no keyframes needed).
  useEffect(() => {
    const el = fillRef.current
    if (!el || reduced) return
    el.style.transition = 'none'
    el.style.width = '0%'
    const raf = requestAnimationFrame(() => {
      el.style.transition = `width ${DWELL_MS}ms linear`
      el.style.width = '100%'
    })
    return () => cancelAnimationFrame(raf)
  }, [active, reduced])

  return (
    <div className={className}>
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <Kicker className="justify-center">See it work</Kicker>
        <h3 className="mt-3 text-balance font-serif text-2xl font-semibold sm:text-3xl">
          The whole product, end to end.
        </h3>
      </div>

      <BrowserFrame label={current.label} className="mx-auto max-w-5xl shadow-lift">
        {/* Stories-style progress bar — the cue that this is auto-playing. */}
        <div aria-hidden className="h-0.5 w-full bg-stone-200">
          <span
            ref={fillRef}
            className="block h-full bg-clay-500"
            style={{ width: reduced ? '100%' : '0%' }}
          />
        </div>
        <div className="relative aspect-[16/10] overflow-hidden bg-stone-100">
          <AnimatePresence>
            <motion.img
              key={current.key}
              src={current.img}
              alt={current.alt}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover object-top"
              initial={{ opacity: 0, scale: zoomIn ? 1.0 : 1.12 }}
              animate={{ opacity: 1, scale: zoomIn ? 1.12 : 1.0 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 1, ease: [0.22, 1, 0.36, 1] },
                scale: { duration: (DWELL_MS + 1400) / 1000, ease: 'linear' },
              }}
            />
          </AnimatePresence>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink/15 to-transparent"
          />
        </div>
      </BrowserFrame>

      <div className="mx-auto mt-6 flex max-w-5xl flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-center sm:text-left">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-clay-700">
            {current.kicker}
          </span>
          <p className="mt-1 font-serif text-xl font-semibold text-ink">{current.title}</p>
          <p className="mt-1 max-w-lg text-sm leading-relaxed text-stone-600">{current.body}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1" aria-hidden>
          {CHAPTERS.map((c, i) => (
            <span
              key={c.key}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? 'w-7 bg-clay-500' : 'w-2.5 bg-stone-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
