import { useRef, useState } from 'react'
import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import Button from '../../components/Button.jsx'
import EvidenceNetwork from '../../components/EvidenceNetwork.jsx'
import { Container } from '../../components/primitives.jsx'
import {
  ArrowRight,
  Check,
  Code,
  Compass,
  Eye,
  FileText,
  Flag,
  Grid,
  Lock,
  Play,
  ShieldCheck,
  Sparkle,
  User,
} from '../../components/icons.jsx'
import { useReducedMotion } from '../../hooks/useReducedMotion.js'

const WORK_EVENTS = [
  {
    time: '08:04',
    kind: 'AI prompt',
    title: 'Frames the failure before editing',
    detail: 'Trace the duplicate retry without changing the queue contract.',
    criterion: 0,
    tone: 'brand',
    icon: Sparkle,
  },
  {
    time: '08:09',
    kind: 'Code edit',
    title: 'Moves the guard into the transaction',
    detail: 'queue/retry.ts  +18  −7',
    criterion: 1,
    tone: 'brand',
    icon: Code,
  },
  {
    time: '08:12',
    kind: 'Test run',
    title: 'Finds one remaining race',
    detail: '17 passed  ·  1 failed',
    criterion: 2,
    tone: 'warning',
    icon: Play,
  },
  {
    time: '08:18',
    kind: 'Revision',
    title: 'Tests the state boundary directly',
    detail: 'Adds a concurrent retry case before revising the fix.',
    criterion: 1,
    tone: 'brand',
    icon: FileText,
  },
  {
    time: '08:24',
    kind: 'Test run',
    title: 'Closes with the regression covered',
    detail: '18 passed  ·  0 failed',
    criterion: 2,
    tone: 'success',
    icon: Check,
  },
]

const CRITERIA = [
  {
    label: 'Problem framing',
    score: 27,
    max: 30,
    note: 'Names the state boundary and preserves the queue contract.',
  },
  {
    label: 'Implementation quality',
    score: 35,
    max: 40,
    note: 'Makes a narrow change and adds coverage at the failure point.',
  },
  {
    label: 'Verification discipline',
    score: 25,
    max: 30,
    note: 'Uses the failed run to revise the approach, then reruns the suite.',
  },
]

const EVENT_TONES = {
  brand: {
    icon: 'border-brand-400/30 bg-brand-500/15 text-brand-200',
    tag: 'text-brand-200',
    dot: 'bg-brand-400',
  },
  warning: {
    icon: 'border-warning-500/30 bg-warning-500/15 text-warning-200',
    tag: 'text-warning-200',
    dot: 'bg-warning-500',
  },
  success: {
    icon: 'border-success-500/30 bg-success-500/15 text-success-200',
    tag: 'text-success-200',
    dot: 'bg-success-500',
  },
  danger: {
    icon: 'border-danger-500/30 bg-danger-500/15 text-danger-200',
    tag: 'text-danger-200',
    dot: 'bg-danger-500',
  },
}

const WORKFLOW_STEPS = [
  {
    label: 'Author',
    title: 'Define the work that matters in the role.',
    description:
      'Start with one realistic task, then make the evaluation contract explicit. Your team controls the prompt, criterion weights, timebox, and trusted tests.',
    icon: FileText,
    panelTitle: 'Retry service screen',
    panelMeta: 'Draft · role specific',
    facts: [
      ['Role', 'Backend engineer'],
      ['Format', 'Code + explanation'],
      ['Timebox', '45 minutes'],
    ],
    rows: [
      ['Problem framing', '30 points', 'Names the state boundary'],
      ['Implementation quality', '40 points', 'Makes a narrow, maintainable change'],
      ['Verification discipline', '30 points', 'Tests the failure and the fix'],
    ],
    footer: 'Rubric version 03',
  },
  {
    label: 'Observe',
    title: 'Let candidates work the way the job works.',
    description:
      'The candidate can use AI, edit code, run tests, and revise. Touchstones records the sequence of work events so reviewers can inspect the process, not just the final file.',
    icon: Code,
    panelTitle: 'Candidate workspace',
    panelMeta: 'Session active · AI allowed',
    facts: [
      ['Workspace', 'Browser IDE'],
      ['Assist', 'Candidate directed'],
      ['Capture', 'Work events only'],
    ],
    rows: [
      ['08:04 · AI prompt', 'Framing', 'Traces the duplicate retry'],
      ['08:09 · Code edit', '+18 −7', 'Moves the guard into the transaction'],
      ['08:12 · Test run', '17 / 18', 'Finds one remaining race'],
    ],
    footer: 'No emotion inference, no biometrics',
  },
  {
    label: 'Map',
    title: 'Connect each claim to inspectable evidence.',
    description:
      'AI evaluates the work against each criterion. Code applies the weights. Reviewers can travel from a score to the exact prompt, edit, or test run that supports it.',
    icon: Grid,
    panelTitle: 'Criterion evidence',
    panelMeta: 'Rubric version 03',
    facts: [
      ['Evidence events', '18 linked'],
      ['Criteria', '3 weighted'],
      ['Calculation', 'Applied in code'],
    ],
    rows: [
      ['Problem framing', '27 / 30', 'Prompt 01 · explanation 02'],
      ['Implementation quality', '35 / 40', 'Edits 04–09 · diff summary'],
      ['Verification discipline', '25 / 30', 'Test runs 02–04'],
    ],
    footer: 'Every score remains traceable',
  },
  {
    label: 'Review',
    title: 'Give the interview panel a useful starting point.',
    description:
      'The decision packet compresses the work trail into criterion evidence, review flags, and a focused interview prompt. It informs a human decision without making one.',
    icon: Eye,
    panelTitle: 'Reviewer packet',
    panelMeta: 'Evidence ready · human review',
    facts: [
      ['Weighted score', '87 / 100'],
      ['Review state', 'Evidence ready'],
      ['Suggested follow-up', '1 topic'],
    ],
    rows: [
      ['Strongest evidence', 'Testing', 'Reproduced the race before revising'],
      ['Review context', 'AI use', 'Prompts show deliberate direction'],
      ['Interview prompt', 'Discuss', 'Why move the guard into the transaction?'],
    ],
    footer: 'The reviewer owns the outcome',
  },
]

const BUYER_USE_CASES = [
  {
    role: 'Head of engineering',
    icon: Code,
    question: 'Can this person reason through production-shaped ambiguity?',
    detail:
      'See how the candidate frames the problem, directs AI, reacts to a failed test, and defends the final tradeoff.',
    handoff: 'Use the evidence packet to shape the technical interview.',
  },
  {
    role: 'Talent leader',
    icon: User,
    question: 'Can every reviewer apply the same job-relevant standard?',
    detail:
      'Anchor the screen to a weighted rubric and give the panel the same criterion-level evidence instead of a black-box rank.',
    handoff: 'Keep the process consistent without automating the decision.',
  },
  {
    role: 'Technical interviewer',
    icon: Compass,
    question: 'What should I probe when the candidate reaches the onsite?',
    detail:
      'Start from a real decision, failed test, or revision in the work trail instead of repeating a generic coding exercise.',
    handoff: 'Spend interview time on judgment, ownership, and depth.',
  },
]

const COMPARISON_ROWS = [
  {
    label: 'Primary signal',
    touchstones: 'How the candidate frames, builds, tests, and revises',
    answer: 'The response that was submitted',
    proctoring: 'The response plus session-control signals',
  },
  {
    label: 'AI posture',
    touchstones: 'Allowed. Its use becomes part of the reviewable work context.',
    answer: 'Policy varies. The reviewer may not see how AI shaped the work.',
    proctoring: 'Often treated as behavior to restrict or flag.',
  },
  {
    label: 'Reviewer receives',
    touchstones: 'Criterion evidence, work trail, weighted score, and a follow-up prompt',
    answer: 'Submitted answer, score, and grader feedback',
    proctoring: 'Submitted answer, score, and integrity flags',
  },
  {
    label: 'Candidate experience',
    touchstones: 'A role-specific work sample with normal problem-solving tools',
    answer: 'A fixed task optimized around the final response',
    proctoring: 'A controlled session with monitoring requirements',
  },
  {
    label: 'Boundary',
    touchstones: 'Supports job-relevant review. It does not establish identity.',
    answer: 'Shows performance on the submitted task.',
    proctoring: 'Shows adherence to session rules. It does not prove job performance.',
  },
]

const EVIDENCE_LAYERS = [
  {
    label: 'Role schema',
    icon: FileText,
    title: 'A versioned definition of good work.',
    detail:
      'Prompt, rubric, weights, trusted tests, and role context stay together. Reviewers can see which standard produced the result.',
    artifact: 'Role-specific evaluation contract',
    boundary: 'The employer defines the standard.',
  },
  {
    label: 'Evidence graph',
    icon: Grid,
    title: 'A map from work events to criteria.',
    detail:
      'Prompts, edits, tests, and revisions become linked evidence. A score is the summary, not the only artifact left behind.',
    artifact: 'Event-to-criterion relationships',
    boundary: 'Only job-relevant work context belongs here.',
  },
  {
    label: 'Integrity trail',
    icon: Lock,
    title: 'A tamper-evident record of the session.',
    detail:
      'Append-only, hash-linked events make missing or changed records reviewable while keeping integrity separate from identity.',
    artifact: 'Verifiable event-chain reference',
    boundary: 'It does not prove which person completed the work.',
  },
  {
    label: 'Outcome calibration',
    icon: Flag,
    title: 'Role-level signal grounded in later outcomes.',
    detail:
      'Employer-recorded advance, offer, hire, and retention outcomes can be read against score bands to improve interpretation over time.',
    artifact: 'Employer-scoped calibration history',
    boundary: 'Outcome data informs reviewers. It does not auto-select candidates.',
  },
]

function Reveal({ children, reduced, className = '', delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { y: 24 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: reduced ? 0 : 0.6, delay: reduced ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function EventStream({ activeEvent, onSelect, reduced }) {
  return (
    <div className="relative z-10 space-y-2.5">
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
        Candidate work trail
      </p>
      {WORK_EVENTS.map((event, index) => {
        const selected = index === activeEvent
        const tone = EVENT_TONES[event.tone]
        const Icon = event.icon
        return (
          <motion.button
            key={`${event.kind}-${event.time}`}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(index)}
            className={`group relative w-full overflow-hidden border px-3.5 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
              selected
                ? 'border-brand-400/55 bg-brand-500/15'
                : 'border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]'
            }`}
            initial={false}
            animate={{ x: selected && !reduced ? 5 : 0 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 w-px ${selected ? tone.dot : 'bg-white/10'}`}
            />
            <span className="flex items-start gap-3">
              <span className={`grid h-8 w-8 shrink-0 place-items-center border ${tone.icon}`}>
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className={`font-mono text-[10px] uppercase tracking-[0.15em] ${tone.tag}`}>
                    {event.kind}
                  </span>
                  <span className="font-mono text-[10px] text-white/35">{event.time}</span>
                </span>
                <span className="mt-1 block text-sm font-medium leading-snug text-white">
                  {event.title}
                </span>
                <span
                  className={`mt-1 block font-mono text-[11px] leading-relaxed ${
                    selected ? 'text-white/70' : 'text-white/45'
                  }`}
                >
                  {event.detail}
                </span>
              </span>
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

function RubricMap({ activeEvent, reduced }) {
  const selectedCriterion = WORK_EVENTS[activeEvent].criterion
  return (
    <div className="relative z-10 space-y-3 lg:self-center">
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
        Rubric mapping
      </p>
      {CRITERIA.map((criterion, index) => {
        const selected = index === selectedCriterion
        const percent = Math.round((criterion.score / criterion.max) * 100)
        return (
          <div
            key={criterion.label}
            className={`border p-3.5 transition-colors ${
              selected ? 'border-brand-400/50 bg-brand-500/15' : 'border-white/10 bg-[#11131b]/75'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-white">{criterion.label}</p>
              <p className="font-mono text-xs text-white/55">
                {criterion.score}/{criterion.max}
              </p>
            </div>
            <div className="mt-2 h-1 overflow-hidden bg-white/10">
              <motion.div
                className="h-full origin-left bg-brand-400"
                initial={false}
                animate={{ width: `${percent}%` }}
                transition={{ duration: reduced ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <motion.p
              initial={false}
              animate={{ opacity: selected ? 0.85 : 0.45 }}
              transition={{ duration: reduced ? 0 : 0.25 }}
              className="mt-2 text-[11px] leading-relaxed text-white"
            >
              {criterion.note}
            </motion.p>
          </div>
        )
      })}
    </div>
  )
}

function DecisionPacket({ activeEvent, reduced }) {
  const current = WORK_EVENTS[activeEvent]
  return (
    <motion.article
      className="relative z-10 overflow-hidden border border-white/15 bg-[#f7f8fc] text-ink shadow-2xl"
      initial={false}
      animate={{ y: reduced ? 0 : [0, -3, 0] }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="h-1 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700" />
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-5 border-b border-stone-200 pb-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-700">
              Example decision packet
            </p>
            <h3 className="mt-2 font-sans text-lg font-semibold tracking-tight text-ink">
              Backend engineer · Retry service
            </h3>
            <p className="mt-1 text-xs text-stone-500">Illustrative candidate · 24 minute session</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-semibold tracking-tight text-brand-700">87</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-500">
              out of 100
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 border-b border-stone-200 py-4">
          {[
            ['Prompts', '03'],
            ['Code events', '11'],
            ['Test runs', '04'],
          ].map(([label, value]) => (
            <div key={label} className="border-l border-stone-200 px-3 first:border-l-0 first:pl-0">
              <p className="font-mono text-lg font-semibold text-ink">{value}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-stone-700">Evidence in focus</p>
            <span className="font-mono text-[10px] text-stone-400">{current.time}</span>
          </div>
          <motion.div
            key={current.time}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.3 }}
            className="mt-2 border-l-2 border-brand-500 bg-brand-50 px-3 py-2.5"
          >
            <p className="text-xs font-semibold text-brand-800">{current.title}</p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-brand-900/70">
              {current.detail}
            </p>
          </motion.div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-stone-200 pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Reviewer next step</p>
            <p className="mt-1 text-sm font-semibold text-ink">Discuss in technical interview</p>
          </div>
          <span className="inline-flex items-center gap-1.5 border border-success-200 bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700">
            <Check size={13} /> Evidence ready
          </span>
        </div>
      </div>
    </motion.article>
  )
}

function ProductStory() {
  const reduced = useReducedMotion()
  const sectionRef = useRef(null)
  const [activeEvent, setActiveEvent] = useState(0)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  })

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    if (reduced) return
    const next = Math.min(WORK_EVENTS.length - 1, Math.floor(progress * WORK_EVENTS.length))
    setActiveEvent((current) => (current === next ? current : next))
  })

  return (
    <section
      ref={sectionRef}
      id="product"
      className="scroll-mt-20 overflow-hidden bg-brand-950 text-white"
    >
      <div className="relative">
        <EvidenceNetwork
          className="z-0 opacity-55"
          theme="dark"
          density="normal"
          interactive={!reduced}
        />
        <div className="relative z-10">
          <Container className="py-16 sm:py-20">
            <div className="grid gap-6 border-b border-white/10 pb-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-300">
                  The work behind the answer
                </p>
                <h2 className="mt-4 max-w-2xl text-balance font-sans text-4xl font-semibold leading-[0.98] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
                  The final answer is only the last frame.
                </h2>
              </div>
              <div className="lg:pb-1">
                <p className="max-w-xl text-base leading-relaxed text-white/65 sm:text-lg">
                  Touchstones connects AI prompts, code edits, and test runs to the rubric your team
                  chose. Select an event to see how the evidence changes the review packet.
                </p>
                <p className="mt-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
                  <span className="h-1.5 w-1.5 bg-brand-400" /> Scroll or choose an event
                </p>
              </div>
            </div>

            <div className="relative mt-8 grid gap-7 lg:grid-cols-[1.02fr_0.82fr_1fr] lg:items-center lg:gap-16">
              <EventStream activeEvent={activeEvent} onSelect={setActiveEvent} reduced={reduced} />
              <RubricMap activeEvent={activeEvent} reduced={reduced} />
              <DecisionPacket activeEvent={activeEvent} reduced={reduced} />
            </div>
          </Container>
        </div>
      </div>
    </section>
  )
}

function ProductDemoSection() {
  const reduced = useReducedMotion()

  return (
    <section id="product-demo" className="scroll-mt-20 border-b border-stone-200 bg-paper py-20 sm:py-24">
      <Container>
        <Reveal reduced={reduced} className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-700">
              18-second product tour
            </p>
            <h2 className="mt-4 max-w-3xl text-balance font-sans text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-5xl">
              Watch the evidence move from work to review.
            </h2>
          </div>
          <div className="lg:justify-self-end">
            <p className="max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
              Follow a candidate from the live evidence ledger through the work trail and into a
              decision-ready sample packet. The reviewer remains in control throughout.
            </p>
            <a
              href="/sample-report"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4"
            >
              Inspect the full sample packet <ArrowRight size={15} />
            </a>
          </div>
        </Reveal>

        <Reveal reduced={reduced} className="mt-10">
          <div className="relative overflow-hidden border border-brand-200 bg-brand-950 p-2 shadow-lift sm:p-3">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-brand-300 via-brand-500 to-brand-300" />
            <video
              className="block aspect-video w-full bg-brand-950 object-cover"
              autoPlay={!reduced}
              muted
              loop={!reduced}
              playsInline
              controls
              preload="metadata"
              poster="/media/touchstones-product-demo-poster.png"
              aria-label="18-second Touchstones product walkthrough"
            >
              <source src="/media/touchstones-product-demo.mp4" type="video/mp4" />
              Your browser cannot play this video.{' '}
              <a href="/media/touchstones-product-demo.mp4">Open the product demo directly.</a>
            </video>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
            <span className="inline-flex items-center gap-2">
              <Play size={14} className="text-brand-600" /> 18 seconds · muted by default
            </span>
            <span>Real product surfaces · fictional sample data</span>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

function TrustStrip() {
  const items = [
    {
      icon: Sparkle,
      title: 'Explicit AI policy',
      detail: 'Each task states the allowed tools before work begins.',
    },
    { icon: Eye, title: 'No identity matching', detail: 'No face matching or emotion inference.' },
    { icon: ShieldCheck, title: 'Your rubric leads', detail: 'Evidence stays tied to criteria you set.' },
    { icon: Check, title: 'Humans decide', detail: 'Reviewers make every hiring decision.' },
  ]

  return (
    <section aria-label="Product principles" className="border-y border-stone-200 bg-paper">
      <Container className="grid divide-y divide-stone-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.title} className="flex gap-3 px-1 py-7 sm:px-5 lg:py-8">
            <item.icon size={18} className="mt-0.5 shrink-0 text-brand-600" />
            <div>
              <p className="text-sm font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500">{item.detail}</p>
            </div>
          </div>
        ))}
      </Container>
    </section>
  )
}

function WorkflowSection() {
  const reduced = useReducedMotion()
  const [activeStep, setActiveStep] = useState(0)
  const step = WORKFLOW_STEPS[activeStep]
  const StepIcon = step.icon

  return (
    <section id="workflow" className="scroll-mt-20 border-b border-stone-200 bg-paper py-20 sm:py-24">
      <Container>
        <Reveal reduced={reduced} className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-700">
              From role to review
            </p>
            <h2 className="mt-4 max-w-3xl text-balance font-sans text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-5xl">
              One continuous evidence workflow.
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg lg:justify-self-end">
            Touchstones keeps the task, work trail, rubric, and reviewer packet in one chain. Choose a
            stage to see what the hiring team creates, what the candidate experiences, and what the
            reviewer receives.
          </p>
        </Reveal>

        <div className="mt-10 grid border border-stone-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
          {WORKFLOW_STEPS.map((item, index) => {
            const Icon = item.icon
            const selected = index === activeStep
            return (
              <button
                key={item.label}
                type="button"
                aria-pressed={selected}
                onClick={() => setActiveStep(index)}
                className={`group flex items-center gap-3 border-b border-stone-200 px-4 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0 ${
                  selected ? 'bg-brand-50 text-brand-800' : 'bg-white text-stone-500 hover:bg-stone-50'
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center border ${
                    selected
                      ? 'border-brand-300 bg-brand-600 text-white'
                      : 'border-stone-200 bg-paper text-stone-500 group-hover:text-brand-700'
                  }`}
                >
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">
                    0{index + 1}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold">{item.label}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="grid border-x border-b border-stone-200 bg-white lg:grid-cols-[0.78fr_1.22fr]">
          <motion.div
            key={`copy-${activeStep}`}
            initial={reduced ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduced ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col justify-between border-b border-stone-200 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10"
          >
            <div>
              <div className="grid h-11 w-11 place-items-center border border-brand-200 bg-brand-50 text-brand-700">
                <StepIcon size={19} />
              </div>
              <h3 className="mt-6 max-w-lg text-balance text-2xl font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-3xl">
                {step.title}
              </h3>
              <p className="mt-4 max-w-xl text-sm leading-7 text-stone-600 sm:text-base">
                {step.description}
              </p>
            </div>
            <p className="mt-8 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-brand-700">
              <Check size={14} /> Stage {activeStep + 1} of {WORKFLOW_STEPS.length}
            </p>
          </motion.div>

          <div className="bg-canvas p-4 sm:p-6 lg:p-8">
            <motion.article
              key={`panel-${activeStep}`}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="border border-stone-200 bg-white shadow-card"
            >
              <div className="h-1 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700" />
              <div className="flex flex-col gap-3 border-b border-stone-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">{step.panelTitle}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-stone-400">
                    {step.panelMeta}
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-1.5 border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  <Check size={13} /> Active stage
                </span>
              </div>

              <div className="grid border-b border-stone-200 sm:grid-cols-3">
                {step.facts.map(([label, value]) => (
                  <div
                    key={label}
                    className="border-b border-stone-200 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-stone-400">
                      {label}
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>

              <div className="divide-y divide-stone-200 px-5 sm:px-6">
                {step.rows.map(([label, value, detail]) => (
                  <div key={label} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-5">
                    <div>
                      <p className="text-sm font-semibold text-ink">{label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-stone-500">{detail}</p>
                    </div>
                    <span className="font-mono text-[11px] font-medium text-brand-700">{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-stone-200 bg-paper px-5 py-3 sm:px-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-stone-500">
                  {step.footer}
                </span>
                <span className="font-mono text-[10px] text-stone-400">Touchstones</span>
              </div>
            </motion.article>
          </div>
        </div>
      </Container>
    </section>
  )
}

function BuyerUseCases() {
  const reduced = useReducedMotion()

  return (
    <section id="use-cases" className="scroll-mt-20 overflow-hidden bg-[#f3f1ec] py-20 sm:py-24">
      <Container>
        <Reveal reduced={reduced} className="max-w-4xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-700">
            Built for the review team
          </p>
          <h2 className="mt-4 text-balance font-sans text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-5xl">
            Better signal for the people asking different questions.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
            The strongest fit is a software team hiring for judgment under ambiguity, where AI will
            be part of the job and a technical reviewer still owns the decision.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {BUYER_USE_CASES.map((item, index) => {
            const Icon = item.icon
            return (
              <Reveal key={item.role} reduced={reduced} delay={index * 0.08}>
                <article className="flex h-full flex-col border border-stone-200 bg-white p-6 shadow-card transition-transform duration-300 hover:-translate-y-1 sm:p-7">
                  <div className="flex items-center justify-between gap-4">
                    <span className="grid h-10 w-10 place-items-center border border-brand-200 bg-brand-50 text-brand-700">
                      <Icon size={18} />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-400">
                      Buyer view 0{index + 1}
                    </span>
                  </div>
                  <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-brand-700">
                    {item.role}
                  </p>
                  <h3 className="mt-3 text-balance text-xl font-semibold leading-snug tracking-[-0.02em] text-ink">
                    {item.question}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-stone-600">{item.detail}</p>
                  <div className="mt-7 border-t border-stone-200 pt-4">
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-stone-600">
                      <ArrowRight size={14} className="mt-0.5 shrink-0 text-brand-600" />
                      {item.handoff}
                    </p>
                  </div>
                </article>
              </Reveal>
            )
          })}
        </div>

        <Reveal reduced={reduced} className="mt-4 grid border border-stone-200 bg-ink text-white lg:grid-cols-[0.75fr_1.25fr]">
          <div className="border-b border-white/10 p-6 sm:p-8 lg:border-b-0 lg:border-r">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-300">
              Design-partner fit
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
              Bring the role where the final answer tells you the least.
            </h3>
          </div>
          <div className="grid gap-px bg-white/10 sm:grid-cols-3">
            {[
              'The job requires debugging and tradeoff judgment.',
              'Candidates will use AI after they join.',
              'The onsite needs specific evidence to probe.',
            ].map((item) => (
              <div key={item} className="flex gap-3 bg-ink p-6 sm:p-7">
                <Check size={16} className="mt-0.5 shrink-0 text-brand-300" />
                <p className="text-sm leading-relaxed text-white/70">{item}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

function ComparisonSection() {
  const reduced = useReducedMotion()

  return (
    <section id="difference" className="scroll-mt-20 border-y border-stone-200 bg-paper py-20 sm:py-24">
      <Container>
        <Reveal reduced={reduced} className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-700">
              Different by design
            </p>
            <h2 className="mt-4 max-w-3xl text-balance font-sans text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-5xl">
              Replace the answer-versus-surveillance tradeoff.
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-stone-600 sm:text-base lg:justify-self-end">
            Touchstones focuses on the job-relevant work between the prompt and the submission. It
            makes AI use visible without turning assurance into identity matching or automated
            pass/fail.
          </p>
        </Reveal>

        <Reveal reduced={reduced} className="mt-10 hidden border border-stone-200 bg-white lg:block">
          <div className="grid grid-cols-[0.62fr_1fr_1fr_1fr] border-b border-stone-200">
            <div className="p-5" />
            <div className="border-l border-brand-200 bg-brand-50 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-brand-700">
                Touchstones
              </p>
              <p className="mt-2 text-sm font-semibold text-brand-900">Work-evidence screen</p>
            </div>
            <div className="border-l border-stone-200 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-stone-500">
                Answer-only screen
              </p>
              <p className="mt-2 text-sm font-semibold text-ink">Submission centered</p>
            </div>
            <div className="border-l border-stone-200 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-stone-500">
                Surveillance-led screen
              </p>
              <p className="mt-2 text-sm font-semibold text-ink">Session-control centered</p>
            </div>
          </div>
          {COMPARISON_ROWS.map((row) => (
            <div key={row.label} className="grid grid-cols-[0.62fr_1fr_1fr_1fr] border-b border-stone-200 last:border-b-0">
              <div className="p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">
                  {row.label}
                </p>
              </div>
              <div className="border-l border-brand-200 bg-brand-50/70 p-5 text-sm leading-6 text-brand-950">
                {row.touchstones}
              </div>
              <div className="border-l border-stone-200 p-5 text-sm leading-6 text-stone-600">
                {row.answer}
              </div>
              <div className="border-l border-stone-200 p-5 text-sm leading-6 text-stone-600">
                {row.proctoring}
              </div>
            </div>
          ))}
        </Reveal>

        <div className="mt-10 grid gap-4 lg:hidden">
          {[
            ['Touchstones', 'Work-evidence screen', 'touchstones'],
            ['Answer-only screen', 'Submission centered', 'answer'],
            ['Surveillance-led screen', 'Session-control centered', 'proctoring'],
          ].map(([title, subtitle, key], index) => (
            <Reveal key={title} reduced={reduced} delay={index * 0.05}>
              <article className={`border p-5 sm:p-6 ${key === 'touchstones' ? 'border-brand-200 bg-brand-50' : 'border-stone-200 bg-white'}`}>
                <p className={`font-mono text-[10px] uppercase tracking-[0.15em] ${key === 'touchstones' ? 'text-brand-700' : 'text-stone-500'}`}>
                  {title}
                </p>
                <p className="mt-2 text-base font-semibold text-ink">{subtitle}</p>
                <div className="mt-5 divide-y divide-stone-200 border-t border-stone-200">
                  {COMPARISON_ROWS.map((row) => (
                    <div key={row.label} className="py-4">
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400">
                        {row.label}
                      </p>
                      <p className="mt-1.5 text-sm leading-6 text-stone-600">{row[key]}</p>
                    </div>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-stone-400">
          This compares product models, not every implementation or vendor in each category.
        </p>
      </Container>
    </section>
  )
}

function EvidenceMoatSection() {
  const reduced = useReducedMotion()
  const [activeLayer, setActiveLayer] = useState(0)
  const layer = EVIDENCE_LAYERS[activeLayer]
  const LayerIcon = layer.icon

  return (
    <section id="evidence-layer" className="scroll-mt-20 relative overflow-hidden bg-brand-950 py-20 text-white sm:py-24">
      <EvidenceNetwork className="z-0 opacity-40" theme="dark" density="normal" interactive={!reduced} />
      <Container className="relative z-10">
        <Reveal reduced={reduced} className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-300">
              The evidence layer
            </p>
            <h2 className="mt-4 max-w-3xl text-balance font-sans text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-5xl">
              Build a role-specific evidence system, not a pile of isolated scores.
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg lg:justify-self-end">
            Each screen can preserve the standard, the work that met it, the integrity of the event
            trail, and the later outcome. Those layers make reviews more traceable while keeping the
            human decision explicit.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {EVIDENCE_LAYERS.map((item, index) => {
              const Icon = item.icon
              const selected = index === activeLayer
              return (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveLayer(index)}
                  className={`group flex items-center justify-between gap-4 border px-4 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
                    selected
                      ? 'border-brand-400/60 bg-brand-500/20 text-white'
                      : 'border-white/10 bg-white/[0.035] text-white/55 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center border ${selected ? 'border-brand-300/50 bg-brand-400/20 text-brand-200' : 'border-white/10 text-white/45'}`}>
                      <Icon size={16} />
                    </span>
                    <span>
                      <span className="block font-mono text-[9px] uppercase tracking-[0.14em] opacity-50">
                        Layer 0{index + 1}
                      </span>
                      <span className="mt-0.5 block text-sm font-semibold">{item.label}</span>
                    </span>
                  </span>
                  <ArrowRight size={15} className={selected ? 'text-brand-200' : 'text-white/25'} />
                </button>
              )
            })}
          </div>

          <motion.article
            key={layer.label}
            initial={reduced ? false : { opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduced ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="border border-white/15 bg-[#11152f]/90 shadow-2xl"
          >
            <div className="h-1 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700" />
            <div className="p-6 sm:p-8 lg:p-10">
              <div className="flex flex-col gap-5 border-b border-white/10 pb-7 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-2xl">
                  <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-brand-300">
                    {layer.label}
                  </p>
                  <h3 className="mt-3 text-balance text-2xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-3xl">
                    {layer.title}
                  </h3>
                </div>
                <span className="grid h-11 w-11 shrink-0 place-items-center border border-brand-300/40 bg-brand-400/15 text-brand-200">
                  <LayerIcon size={19} />
                </span>
              </div>

              <p className="max-w-3xl py-7 text-base leading-8 text-white/65 sm:text-lg">
                {layer.detail}
              </p>

              <div className="grid gap-px bg-white/10 sm:grid-cols-2">
                <div className="bg-[#11152f] p-5 sm:p-6">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                    Durable artifact
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-white">
                    {layer.artifact}
                  </p>
                </div>
                <div className="bg-[#11152f] p-5 sm:p-6">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                    Explicit boundary
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-white">
                    {layer.boundary}
                  </p>
                </div>
              </div>

              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/55">
                {['Employer scoped', 'Human reviewed', 'Provenance linked'].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <Check size={14} className="text-brand-300" /> {item}
                  </span>
                ))}
              </div>
            </div>
          </motion.article>
        </div>

        <Reveal reduced={reduced} className="mt-5 grid gap-px bg-white/10 sm:grid-cols-3">
          {[
            ['Clearer interviews', 'Reviewers start from specific candidate decisions.'],
            ['Defensible reasoning', 'Criteria, evidence, and weights remain connected.'],
            ['Role-level learning', 'Downstream outcomes can calibrate how score bands are interpreted.'],
          ].map(([title, detail]) => (
            <div key={title} className="bg-brand-950/90 p-5 sm:p-6">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/50">{detail}</p>
            </div>
          ))}
        </Reveal>
      </Container>
    </section>
  )
}

function PilotCTA({ appEnabled }) {
  return (
    <section id="pilot" className="scroll-mt-20 relative overflow-hidden bg-paper py-20 sm:py-28">
      <EvidenceNetwork className="z-0 opacity-45" theme="light" density="sparse" interactive />
      <Container className="relative z-10">
        <div className="relative overflow-hidden border border-brand-200 bg-white/90 px-6 py-14 shadow-lift sm:px-12 sm:py-16 lg:px-16">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700"
          />
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-3xl">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand-700">
                Design-partner cohort
              </p>
              <h2 className="mt-4 text-balance font-sans text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-ink sm:text-5xl">
                Run one role. Learn from five candidates.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
                Bring one real engineering role. We will help shape the screen, onboard the first
                candidates, and learn what your team needs from the evidence packet.
              </p>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-600">
                {['One live role', 'Five candidate runs', 'Direct founder support'].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <Check size={15} className="text-brand-600" /> {item}
                  </span>
                ))}
              </div>
            </div>
            <Button to={appEnabled ? '/app/author' : '/contact'} className="shrink-0">
              {appEnabled ? 'Create a pilot screen' : 'Apply for the pilot'}
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </Container>
    </section>
  )
}

export default function EditorialHome({ appEnabled = false }) {
  return (
    <>
      <ProductStory />
      <ProductDemoSection />
      <TrustStrip />
      <WorkflowSection />
      <BuyerUseCases />
      <ComparisonSection />
      <EvidenceMoatSection />
      <PilotCTA appEnabled={appEnabled} />
    </>
  )
}
