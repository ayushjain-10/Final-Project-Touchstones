import { useState } from 'react'
import { Container, Kicker, Pill, SectionHeading } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import ResultCard from '../../components/ResultCard.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'
import {
  ArrowRight,
  FileText,
  Code,
  ShieldCheck,
  Sparkle,
  Slack,
  Link as LinkIcon,
  Check,
} from '../../components/icons.jsx'

function Hero() {
  return (
    <section className="border-b border-stone-200 bg-grain">
      <Container className="py-20">
        <Reveal>
          <Kicker className="mb-5">How it works</Kicker>
          <h1 className="max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
            One workflow: send an evidence-backed real-work screen, get back a reviewable result.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
            No feature grid. One narrative, end to end. Here's exactly what a screen looks like for
            the hiring manager, the candidate, and the score you act on.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button to="/app/author" variant="primary">
              Create a screen <ArrowRight size={16} />
            </Button>
            <Button to="/app/result" variant="ghost">
              Jump to the result card
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

// Alternating narrative step with a visual slot.
function Step({ index, icon: Icon, kicker, title, body, bullets, children, flip }) {
  return (
    <section className="border-b border-stone-200 py-20">
      <Container
        className={`grid items-center gap-12 lg:grid-cols-2 ${flip ? '' : ''}`}
      >
        <Reveal className={flip ? 'lg:order-2' : ''}>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
              <Icon size={20} />
            </span>
            <span className="font-serif text-3xl font-semibold text-stone-200">0{index}</span>
          </div>
          <Kicker className="mb-3 mt-6">{kicker}</Kicker>
          <h2 className="text-balance font-serif text-3xl font-semibold leading-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">{body}</p>
          {bullets && (
            <ul className="mt-6 space-y-3">
              {bullets.map((b) => (
                <li key={b} className="flex gap-3 text-sm leading-relaxed text-stone-700">
                  <Check size={18} className="mt-0.5 shrink-0 text-clay-500" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </Reveal>
        <Reveal delay={120} className={flip ? 'lg:order-1' : ''}>
          {children}
        </Reveal>
      </Container>
    </section>
  )
}

/* Visual mockups (lightweight, real-looking UI rather than stock imagery) */
function AuthorMock() {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-stone-200 bg-canvas/70 px-5 py-3 text-xs font-medium text-stone-500">
        New screen · Backend template
      </div>
      <div className="space-y-4 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Role</p>
          <div className="mt-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
            Senior Backend Engineer
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Task</p>
          <div className="mt-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600">
            Debug a failing payments service with a race condition under retries.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="clay">
            <Sparkle size={13} /> AI allowed
          </Pill>
          <Pill>~30 min</Pill>
          <Pill>Rubric · 4 criteria</Pill>
        </div>
      </div>
    </div>
  )
}

function CandidateMock() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-5 py-3 text-xs">
        <span className="font-medium text-stone-500">candidate.touchstone.dev</span>
        <span className="inline-flex items-center gap-1.5 text-clay-700">
          <Sparkle size={13} /> AI allowed
        </span>
      </div>
      <div className="p-6">
        <div className="rounded-lg bg-ink/90 p-4 font-mono text-xs leading-relaxed text-stone-100">
          <span className="text-amber-100">$</span> npm test{'\n'}
          <span className="text-flag-100"> FAIL</span> payments/retry.test.ts{'\n'}
          <span className="text-stone-400"> ↳ idempotency key reused on retry</span>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-clay-500" /> Reviewing session context…
          </span>
          <span>23:41 elapsed</span>
        </div>
      </div>
    </div>
  )
}

function SignalsMock() {
  const rows = [
    { k: 'Paste activity', v: 'Limited', ok: true },
    { k: 'Focus changes', v: 'None observed', ok: true },
    { k: 'Environment', v: 'Session continuous', ok: true },
    { k: 'Timing summary', v: 'Available', ok: true },
  ]
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Session integrity context</p>
        <VerifiedBadge state="verified" size="sm" />
      </div>
      <div className="mt-5 divide-y divide-stone-200">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between py-3 text-sm">
            <span className="text-stone-600">{r.k}</span>
            <span className="inline-flex items-center gap-2 font-medium text-ink">
              {r.v} <Check size={15} className="text-clay-500" />
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-stone-400">
        Limited session summaries for human review. No biometrics, face scans, identity matching, or emotion inference.
      </p>
    </div>
  )
}

function IntegrationsRow() {
  return (
    <section className="bg-sand py-20">
      <Container>
        <SectionHeading
          align="center"
          kicker="Where you already hire"
          title="A shareable link today. Your ATS tomorrow."
          lede="Start with a link and a Slack ping. Add Ashby or Greenhouse sync the moment your team asks."
        />
        <div className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-center gap-3">
          {[
            { icon: LinkIcon, label: 'Shareable link' },
            { icon: Slack, label: 'Slack notifications' },
            { icon: FileText, label: 'Ashby / Greenhouse' },
            { icon: ShieldCheck, label: 'Audit export' },
          ].map((i) => (
            <Pill key={i.label} tone="white" className="px-4 py-2 text-sm">
              <i.icon size={15} className="text-clay-600" /> {i.label}
            </Pill>
          ))}
        </div>
      </Container>
    </section>
  )
}

function LegacyProduct() {
  return (
    <>
      <Hero />
      <Step
        index={1}
        icon={FileText}
        kicker="Authoring · under 10 minutes"
        title="Spin up a real-work screen from a template."
        body="Pick a role, start from a template tuned for common engineering jobs, and tweak the rubric. The task is messy and role-specific on purpose, so judgment matters more than recall."
        bullets={[
          'Templates: backend, frontend, full-stack, data, ML, debug-a-service.',
          'Your rubric and weights define how the final total is calculated.',
          'AI is allowed and stated up front to candidates.',
        ]}
      >
        <AuthorMock />
      </Step>

      <Step
        index={2}
        icon={Code}
        kicker="Candidate · ~30 minutes"
        title="They do real work using AI, like on the job."
        body="A fast, respectful, mobile-tolerant flow. Candidates solve a realistic problem the way they actually would. How well they direct AI becomes part of the signal."
        bullets={[
          '“AI is allowed here” framing, with no gotchas or proctoring theater.',
          'A short task that respects candidate time.',
          'Works on the move; nothing to install.',
        ]}
        flip
      >
        <CandidateMock />
      </Step>

      <Step
        index={3}
        icon={ShieldCheck}
        kicker="Session integrity · reviewer context"
        title="Add assurance without identity matching."
        body="The product summarizes limited session activity, including paste, focus, timing, and environment context. Reviewers see a session record or a review flag, never an automated hiring outcome."
        bullets={[
          'No face scan, identity matching, or emotion inference. Camera-required screens use presence only; nothing is recorded.',
          'Session summaries are system-attributed rather than candidate claims.',
          'Review flags provide context for people and never pass or fail candidates.',
        ]}
      >
        <SignalsMock />
      </Step>

      <Step
        index={4}
        icon={ShieldCheck}
        kicker="The result · instant"
        title="One explainable result, ready for review."
        body="AI evaluates each criterion against the work evidence. The weighted total is calculated in code from your rubric, with reasoning, linked artifacts, session context, and an exportable trail."
        bullets={[
          'Criterion evaluations stay attached to their supporting evidence.',
          'Reasoning and evidence attached to every criterion.',
          'Exportable trail to support your LL-144 / disparate-impact review.',
        ]}
        flip
      >
        <ResultCard variant="full" className="shadow-lift" />
      </Step>

      <IntegrationsRow />

      <section className="py-20">
        <Container className="text-center">
          <h2 className="mx-auto max-w-2xl text-balance font-serif text-4xl font-semibold leading-tight">
            See it on one of your real roles.
          </h2>
          <div className="mt-8 flex justify-center gap-3">
            <Button to="/app" variant="primary" className="px-6 py-3 text-base">
              Try it free <ArrowRight size={18} />
            </Button>
            <Button to="/pricing" variant="ghost" className="px-6 py-3 text-base">
              See pricing
            </Button>
          </div>
        </Container>
      </section>
    </>
  )
}

const workTrail = [
  {
    id: 'brief',
    time: '00:41',
    label: 'Frames the problem',
    kind: 'WORK NOTE',
    artifact: 'Maps retries, idempotency, and the write boundary before changing code.',
    criterion: 'Problem framing',
    reviewer: 'The approach is visible before implementation begins.',
  },
  {
    id: 'test',
    time: '08:24',
    label: 'Reproduces the failure',
    kind: 'TEST RUN',
    artifact: 'Adds a regression case that fails when two retries reuse the same key.',
    criterion: 'Debugging method',
    reviewer: 'The candidate turns the symptom into a repeatable test.',
  },
  {
    id: 'assist',
    time: '13:06',
    label: 'Challenges AI output',
    kind: 'AI ASSIST',
    artifact: 'Rejects a broad lock and asks for a transaction-scoped alternative.',
    criterion: 'AI judgment',
    reviewer: 'AI use is reviewable context, not a hidden penalty.',
  },
  {
    id: 'patch',
    time: '21:18',
    label: 'Ships a narrow fix',
    kind: 'CODE CHANGE',
    artifact: 'Moves key creation inside the transaction and keeps the public API stable.',
    criterion: 'Implementation quality',
    reviewer: 'The final change can be traced back to the failing behavior.',
  },
]

function WorkTrailExplorer() {
  const [selectedId, setSelectedId] = useState(workTrail[1].id)
  const selected = workTrail.find((event) => event.id === selectedId) || workTrail[0]

  return (
    <div className="overflow-hidden border border-brand-200 bg-white shadow-lift">
      <div className="grid lg:grid-cols-[0.78fr_1.22fr]">
        <div className="border-b border-brand-100 bg-brand-50/60 p-4 lg:border-b-0 lg:border-r sm:p-6">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
            Illustrative work trail
          </p>
          <div className="mt-4 space-y-2" role="list" aria-label="Work trail events">
            {workTrail.map((event) => {
              const active = event.id === selected.id
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedId(event.id)}
                  className={`w-full border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    active
                      ? 'border-brand-300 bg-white shadow-card'
                      : 'border-transparent text-stone-600 hover:border-brand-100 hover:bg-white/70'
                  }`}
                  aria-pressed={active}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className={`text-sm font-semibold ${active ? 'text-ink' : ''}`}>
                      {event.label}
                    </span>
                    <span className="font-mono text-[0.68rem] text-stone-400">{event.time}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
              {selected.kind}
            </span>
            <span className="font-mono text-xs text-stone-400">{selected.time}</span>
          </div>
          <p className="mt-6 font-serif text-2xl font-semibold leading-snug text-ink">
            {selected.artifact}
          </p>
          <dl className="mt-8 grid gap-5 border-t border-stone-200 pt-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                Rubric connection
              </dt>
              <dd className="mt-2 text-sm font-semibold text-ink">{selected.criterion}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                Reviewer sees
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-stone-600">{selected.reviewer}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}

function EditorialProduct() {
  const rubric = [
    ['Problem framing', '25%', 'Reads the system before changing it'],
    ['Debugging method', '30%', 'Reproduces and isolates the failure'],
    ['Implementation quality', '30%', 'Ships a narrow, maintainable fix'],
    ['AI judgment', '15%', 'Uses assistance critically and transparently'],
  ]

  return (
    <>
      <EditorialHero
        eyebrow="Product / evidence-backed screens"
        title="See the work behind the hiring answer."
        lede="Touchstones turns a short, AI-allowed engineering task into a reviewable trail. Hiring teams see how the candidate framed, tested, changed, and explained the work before making a decision."
        noteLabel="The product contract"
        note="Your rubric sets the standard. The work trail supplies the evidence. A person makes the hiring decision."
        primary={{ label: 'Start a pilot', to: '/contact' }}
        secondary={{ label: 'Open a sample packet', to: '/app/result' }}
      >
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5 text-xs text-stone-300">
          <span>Role brief</span>
          <span>Work trail</span>
          <span>Review packet</span>
        </div>
      </EditorialHero>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <Reveal>
              <EditorialHeading
                eyebrow="01 / Set the standard"
                title="Begin with the decision your team needs to make."
                lede="Choose a realistic task, define what good work looks like, and state that AI is allowed before the candidate begins."
              />
              <div className="mt-8 border-l-2 border-brand-500 pl-5 text-sm leading-relaxed text-stone-600">
                The screen tests job-relevant judgment. It does not try to catch someone using the tools they use at work.
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="border border-stone-200 bg-white shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-brand-50/50 px-5 py-4">
                  <div>
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                      Role brief
                    </p>
                    <p className="mt-1 font-semibold text-ink">Senior backend engineer</p>
                  </div>
                  <Pill tone="brand">
                    <Sparkle size={13} /> AI allowed
                  </Pill>
                </div>
                <div className="grid sm:grid-cols-[1fr_0.78fr]">
                  <div className="border-b border-stone-200 p-6 sm:border-b-0 sm:border-r">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Task</p>
                    <p className="mt-3 font-serif text-2xl font-semibold leading-snug">
                      Debug a payments retry that creates duplicate writes under load.
                    </p>
                    <p className="mt-4 text-sm leading-relaxed text-stone-600">
                      The candidate can inspect the service, run tests, use AI, and explain the tradeoffs in the final walkthrough.
                    </p>
                  </div>
                  <div className="p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                      Assessment shape
                    </p>
                    <dl className="mt-4 space-y-4 text-sm">
                      <div className="flex justify-between gap-4 border-b border-stone-100 pb-3">
                        <dt className="text-stone-500">Expected time</dt>
                        <dd className="font-semibold">About 30 min</dd>
                      </div>
                      <div className="flex justify-between gap-4 border-b border-stone-100 pb-3">
                        <dt className="text-stone-500">Criteria</dt>
                        <dd className="font-semibold">4 weighted</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-stone-500">Final step</dt>
                        <dd className="font-semibold">Walkthrough</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="border-b border-stone-200 bg-evidence-light py-16 sm:py-24">
        <Container>
          <Reveal>
            <EditorialHeading
              eyebrow="02 / Follow the work"
              title="A final answer is useful. The path to it is the signal."
              lede="Select an event to see how the work artifact, rubric criterion, and reviewer context stay connected."
            />
          </Reveal>
          <Reveal delay={100} className="mt-10">
            <WorkTrailExplorer />
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <Reveal>
              <EditorialHeading
                eyebrow="03 / Apply the rubric"
                title="The criterion is scored. The evidence stays attached."
                lede="AI evaluates each criterion against the captured work evidence. The weighted total is calculated in code, then presented for human review."
              />
              <div className="mt-8 space-y-4">
                {rubric.map(([name, weight, evidence]) => (
                  <div key={name} className="grid grid-cols-[1fr_auto] gap-4 border-b border-stone-200 pb-4">
                    <div>
                      <p className="font-semibold text-ink">{name}</p>
                      <p className="mt-1 text-sm text-stone-500">{evidence}</p>
                    </div>
                    <span className="font-mono text-sm text-brand-700">{weight}</span>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="border border-brand-200 bg-brand-50/60 p-6 sm:p-8">
                <div className="flex items-center justify-between gap-4 border-b border-brand-200 pb-5">
                  <div>
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                      Review packet
                    </p>
                    <p className="mt-1 font-serif text-2xl font-semibold">Payments retry screen</p>
                  </div>
                  <Pill tone="success">Evidence ready</Pill>
                </div>
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                      Included
                    </p>
                    <ul className="mt-3 space-y-3 text-sm text-stone-700">
                      {['Criterion-level reasoning', 'Linked work artifacts', 'Session integrity context', 'Candidate walkthrough'].map((item) => (
                        <li key={item} className="flex gap-2.5">
                          <Check size={16} className="mt-0.5 shrink-0 text-brand-600" /> {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="border-t border-brand-200 pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                      Decision boundary
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-stone-700">
                      Integrity states are reviewer context. They do not identify a person and they never automatically pass, fail, or advance a candidate.
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <div className="grid divide-y divide-stone-200 border-y border-stone-200 md:grid-cols-3 md:divide-x md:divide-y-0">
            {[
              ['Candidate', 'A short task, clear AI policy, and a verbal walkthrough.'],
              ['Hiring team', 'One place to compare evidence against the same role rubric.'],
              ['Operations', 'Shareable links now, with integration needs shaped through pilots.'],
            ].map(([label, body]) => (
              <Reveal key={label} className="p-6 sm:p-8">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">{label}</p>
                <p className="mt-3 text-base leading-relaxed text-stone-700">{body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <EditorialCta
        title="Run one live role and inspect the evidence with us."
        body="Design partners get hands-on setup. Bring a role, a rubric, and a small candidate cohort. We will build the first screen together."
        secondary={{ label: 'Read the trust model', to: '/trust' }}
      />
    </>
  )
}

export default function Product() {
  return EDITORIAL_UI_ENABLED ? <EditorialProduct /> : <LegacyProduct />
}
