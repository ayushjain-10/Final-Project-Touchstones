import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Container, Kicker, Pill, SectionHeading } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import TiltCard from '../../components/TiltCard.jsx'

// Same build-time gate as MarketingNav: the waitlist build keeps the form hero;
// app builds get self-serve CTAs.
const APP_ENABLED = import.meta.env.VITE_APP_ENABLED === 'true'
// Approved editorial redesign. It stays off until the preview is signed off.
const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'
// OFF by default; enable in dev/preview when demo assets are present.
const DEMO_TOUR = import.meta.env.VITE_DEMO_TOUR === 'true'
import Reveal from '../../components/Reveal.jsx'
import ResultCard from '../../components/ResultCard.jsx'
import DotField from '../../components/DotField.jsx'
import EvidenceNetwork from '../../components/EvidenceNetwork.jsx'
import HeroEvidencePreview from '../../components/HeroEvidencePreview.jsx'
import EditorialHome from './EditorialHome.jsx'
import { BrowserFrame } from '../../components/DemoShowcase.jsx'
import WaitlistForm from '../../components/WaitlistForm.jsx'
import DemoForm from '../../components/DemoForm.jsx'
import {
  ArrowRight,
  Check,
  X,
  FileText,
  Fingerprint,
  Sparkle,
  ShieldCheck,
  Code,
  Compass,
  Slack,
  Play,
} from '../../components/icons.jsx'
import { useParallax } from '../../hooks/useParallax.js'

/* ---------------------------------------------------------------- Hero ---- */
// Back to the two-column split (text left, report right) per feedback — the
// makeover lives in the background (dot grain + drawn line curves + parallax
// blobs) and in the report card being appropriately sized, not filling the
// section.
function Hero() {
  const washRef = useParallax(18)
  const blobARef = useParallax(-42)
  const blobBRef = useParallax(30)
  const linesRef = useParallax(-10)
  const glowRef = useParallax(-16)
  const cardRef = useParallax(-24)

  const proof = [
    { icon: Code, label: 'Rubric-linked evidence' },
    { icon: ShieldCheck, label: 'Session integrity record' },
    { icon: FileText, label: 'Decision-ready packet' },
  ]

  return (
    <section className={`relative overflow-hidden ${EDITORIAL_UI_ENABLED ? 'bg-evidence-light' : ''}`}>
      {/* Interactive dot field — dots repel and "pop" toward the cursor. Replaces
          the static bg-grain speckle. Behind the wash/blobs and all content. */}
      {EDITORIAL_UI_ENABLED ? (
        <EvidenceNetwork className="z-0 opacity-80" theme="light" density="normal" />
      ) : (
        <DotField className="z-0" />
      )}
      {/* warm radial wash, kept light */}
      <div
        ref={washRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 will-change-transform"
        style={{
          background: EDITORIAL_UI_ENABLED
            ? 'radial-gradient(58% 48% at 82% -5%, rgba(67,88,208,0.16), transparent 60%), radial-gradient(48% 40% at -5% 15%, rgba(157,169,239,0.16), transparent 55%)'
            : 'radial-gradient(58% 48% at 82% -5%, rgba(111,78,55,0.12), transparent 60%), radial-gradient(48% 40% at -5% 15%, rgba(194,138,46,0.07), transparent 55%)',
        }}
      />
      {/* Large soft color blobs, each parallaxing at a different speed/direction. */}
      <div
        ref={blobARef}
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 z-0 h-[520px] w-[520px] rounded-full bg-brand-300/25 blur-3xl will-change-transform"
      />
      <div
        ref={blobBRef}
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/3 z-0 h-[420px] w-[420px] rounded-full bg-brand-100/40 blur-3xl will-change-transform"
      />
      {/* Thin drawn lines over the dot grain — the Mintlify/Round-style
          texture, in the existing warm palette (no new blue). Plain rotated
          hairlines rather than an SVG viewBox, so they render predictably at
          any section height. */}
      {!EDITORIAL_UI_ENABLED && (
        <div ref={linesRef} aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden will-change-transform">
          <div className="absolute left-[-10%] top-[18%] h-px w-[130%] origin-left rotate-[-4deg] bg-clay-400/40" />
          <div className="absolute left-[-10%] top-[46%] h-px w-[130%] origin-left rotate-[3deg] bg-stone-300/70" />
          <div className="absolute left-[-10%] top-[74%] h-px w-[130%] origin-left rotate-[-2deg] bg-clay-500/30" />
        </div>
      )}

      <Container className="relative z-10 grid min-h-[calc(100vh-5rem)] items-center gap-12 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:py-20">
        <div className="animate-fade-up">
          <h1 className="text-balance font-serif text-[2.35rem] font-semibold leading-[1.04] sm:text-5xl md:text-[3.85rem]">
            {EDITORIAL_UI_ENABLED ? 'See the work behind the answer.' : 'Screen engineers with work you can verify.'}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">
            {EDITORIAL_UI_ENABLED
              ? 'Touchstones gives engineers a role-specific task where AI is allowed, captures the work trail, and turns rubric-linked evidence into a decision packet.'
              : 'Touchstones gives each candidate a role-specific task, lets them use AI, records one continuous work session, and returns a report linked to your rubric.'}
          </p>

          {EDITORIAL_UI_ENABLED ? (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button to="/sample-report">
                See the evidence packet <ArrowRight size={16} />
              </Button>
              <a href="#pilot" className="btn-ghost">
                Start a pilot
              </a>
            </div>
          ) : APP_ENABLED ? (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button to="/sample-report">
                See a sample score report <ArrowRight size={16} />
              </Button>
              <Button to="/login" variant="ghost">
                Get started free
              </Button>
            </div>
          ) : (
            <WaitlistForm className="mt-8 max-w-xl" />
          )}

          <p className="mt-6 inline-flex items-center gap-2 text-sm text-stone-500">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-clay-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-clay-500" />
            </span>
            {EDITORIAL_UI_ENABLED ? 'Design partners open · five-candidate pilots' : 'Design partners open · onboarding a small first cohort'}
          </p>

          <div className="mt-6 flex max-w-xl flex-wrap items-center gap-x-6 gap-y-2 text-sm text-stone-600">
            {proof.map((p, i) => (
              <span key={p.label} className="inline-flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden className="hidden h-1 w-1 rounded-full bg-stone-300 sm:inline-block" />
                )}
                <p.icon size={15} className="text-brand-600" />
                {p.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative animate-fade-up [animation-delay:120ms]">
          <div
            ref={glowRef}
            aria-hidden
            className="absolute -inset-6 -z-10 rounded-[1.75rem] bg-white/45 ring-1 ring-stone-200/60 will-change-transform"
          />
          {EDITORIAL_UI_ENABLED ? (
            <>
              <div ref={cardRef} className="will-change-transform">
                <TiltCard strength={4} className="rounded-[1.4rem]">
                  <HeroEvidencePreview />
                </TiltCard>
              </div>
              <p className="mt-3 text-center text-xs text-stone-500">
                Select a candidate to change the evidence focus.
              </p>
            </>
          ) : DEMO_TOUR ? (
            <>
              <BrowserFrame label="candidate report" className="shadow-lift">
                <ResultCard variant="compact" className="rounded-none border-0 shadow-none" />
              </BrowserFrame>
              <div className="mt-4 flex justify-center">
                <a
                  href="#see-it-work"
                  className="group inline-flex items-center gap-2 text-sm font-medium text-clay-700 transition-colors hover:text-clay-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay-400 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200 transition-transform duration-200 group-hover:translate-x-px">
                    <Play size={11} />
                  </span>
                  Open product walkthrough
                </a>
              </div>
            </>
          ) : (
            <>
              <div ref={cardRef} className="will-change-transform">
                <TiltCard strength={6} className="rounded-[1.4rem]">
                  <ResultCard variant="compact" className="shadow-lift" />
                </TiltCard>
              </div>
              <p className="mt-3 text-center text-xs text-stone-400">
                A preview of the result every screen returns.
              </p>
            </>
          )}
        </div>
      </Container>
    </section>
  )
}

/* ----------------------------------------------------- The problem / shift - */
function ProblemShift() {
  // Opposite-direction parallax on the two cards — a small but constant
  // depth cue as this section scrolls past, not just a fade-in.
  const cardAParallax = useParallax(16)
  const cardBParallax = useParallax(-16)
  const broke = [
    'Take-homes are now solved in seconds by an LLM — the signal is gone.',
    'You can’t tell who is actually on the other end of the screen.',
    'Detection and proctoring is an arms race you can’t win.',
    'So real talent slips through, and onsites fill up with noise.',
  ]
  const shift = [
    'Change the format: messy, role-specific real work with no memorizable answer.',
    'Every screen states its AI policy, and authored AI use becomes reviewable evidence.',
    'A tamper-evident session record gives reviewers limited integrity context.',
    'One explainable score, scored in code from your rubric — not asserted by a model.',
  ]
  return (
    <section className="border-y border-stone-200 bg-sand bg-grain py-24">
      <Container>
        <SectionHeading
          size="lg"
          kicker="Why now"
          title="AI broke the take-home. So we changed what the test measures."
          lede="The honest answer to AI-assisted and fake candidates isn't to police AI harder. It's to give people real work, let them use AI like they would on the job, and prove it was one continuous human session."
        />
        <div className="mt-14 grid items-stretch gap-5 md:grid-cols-2">
          {/* The problem — muted, recedes */}
          <div ref={cardAParallax} className="will-change-transform">
            <TiltCard strength={5}>
              <Reveal className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white/50 p-7">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-stone-100 text-stone-500 ring-1 ring-stone-200">
                    <X size={18} />
                  </span>
                  <p className="font-serif text-sm italic text-stone-500">Where screening broke</p>
                </div>
                <ul className="mt-6 space-y-4">
                  {broke.map((t) => (
                    <li key={t} className="flex gap-3 text-sm leading-relaxed text-stone-600">
                      <X size={17} className="mt-0.5 shrink-0 text-stone-400" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </TiltCard>
          </div>

          {/* The shift — accented, the resolution the eye should land on */}
          <div ref={cardBParallax} className="will-change-transform">
            <TiltCard strength={5}>
              <Reveal
                delay={100}
                className="flex h-full flex-col rounded-2xl border border-clay-200 bg-clay-50 p-7 shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-clay-500 text-white shadow-card">
                    <Sparkle size={18} />
                  </span>
                  <p className="font-serif text-sm italic text-clay-700">What we changed</p>
                </div>
                <ul className="mt-6 space-y-4">
                  {shift.map((t) => (
                    <li key={t} className="flex gap-3 text-sm leading-relaxed text-ink">
                      <Check size={17} className="mt-0.5 shrink-0 text-clay-600" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </TiltCard>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------ How it works - */
// Static content lives at module scope (not recreated per render) so the
// mount-only effect below doesn't need an exhaustive-deps escape hatch.
const HOW_IT_WORKS_STEPS = [
  {
    title: 'Author a real-work screen',
    body: 'Spin up a role-specific, AI-allowed task from a template — backend, frontend, data, ML, or debug-a-real-service. Each candidate gets a slightly different variant.',
    tag: 'Hiring manager · minutes',
  },
  {
    title: 'Candidate does real work',
    body: 'A fast, respectful flow. They work the way they would on the job — AI allowed — while the server quietly attributes the human.',
    tag: 'Candidate · ~30 min',
  },
  {
    title: 'Get one trustworthy score',
    body: 'A 0–100 score computed in code from your rubric, with reasoning, evidence, the verified-human state, and an exportable audit trail.',
    tag: 'You · instant',
  },
]

// Three steps, three cards — a real grid, not a pinned scroll-jack (a 170vh
// track didn't earn its keep for only three items). The "cool" interaction
// now lives in each card: a staggered 3D pop-in as the row enters view, then
// a cursor-tracked tilt on hover (see TiltCard) — the same technique behind
// Aceternity's 3D Card Effect and Apple's product-tile hovers, reimplemented
// with the project's own Framer Motion primitives.
function HowItWorksGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {HOW_IT_WORKS_STEPS.map((s, i) => (
        <motion.div
          key={s.title}
          initial={{ opacity: 0, y: 26, rotateX: 10, scale: 0.94 }}
          whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 0.65, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformPerspective: 1000 }}
        >
          <TiltCard
            strength={7}
            className="h-full rounded-[2rem] border border-stone-200 bg-white p-7 shadow-lift sm:p-8"
          >
            <span className="font-serif text-5xl font-semibold leading-none text-clay-100">
              0{i + 1}
            </span>
            <h3 className="mt-4 text-xl font-semibold sm:text-2xl">{s.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-stone-600 sm:text-base">{s.body}</p>
            <Pill className="mt-5">{s.tag}</Pill>
          </TiltCard>
        </motion.div>
      ))}
    </div>
  )
}

function HowItWorks() {
  const washRef = useParallax(14)
  return (
    <section id="how" className="scroll-mt-20 relative overflow-hidden border-t border-stone-200 py-24">
      {/* A quiet echo of the hero wash, anchored bottom-left instead of top-right,
          so this section reads distinctly from the hero and the flat sand bands. */}
      <div
        ref={washRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 will-change-transform"
        style={{
          background:
            'radial-gradient(46% 42% at 8% 105%, rgba(194,138,46,0.08), transparent 60%), radial-gradient(40% 36% at 96% 10%, rgba(111,78,55,0.06), transparent 55%)',
        }}
      />
      <Container className="relative z-[1]">
        <SectionHeading
          align="center"
          kicker="How it works"
          title="Send a screen. Get back proof."
          lede="One workflow, done well — author the task, the candidate does real work, and you get a single score you can defend."
          className="mx-auto"
        />
      </Container>

      <Container className="relative z-[1] mt-14">
        <HowItWorksGrid />
      </Container>

      <Container className="relative z-[1] mt-24 sm:mt-32">
        {/* The result card, as the proof. Was a sticky-text-beside-a-tall-card split —
            the card variant is a lot taller than three lines of checklist, so that
            layout just looked lopsided. Centered narrative above, one proof card
            below, reads cleanly at any height. */}
        <div className="mx-auto max-w-2xl text-center">
          <Kicker className="mb-5">The result</Kicker>
          <h3 className="text-balance font-serif text-3xl font-semibold leading-tight sm:text-4xl">
            One card tells you everything.
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">
            The score, reasoning, work evidence, AI direction, and session record on a single,
            exportable card. The rubric leads, and every hiring decision stays with a person.
          </p>
        </div>
        <ul className="mx-auto mt-6 max-w-md space-y-3 text-left">
          {[
            'Scored in code against the role owner’s rubric.',
            'Limited session context, with no identity or emotion inference.',
            'Explainable and logged by default, with an exportable audit trail.',
          ].map((t) => (
            <li key={t} className="flex gap-3 text-sm leading-relaxed text-stone-700">
              <Check size={18} className="mt-0.5 shrink-0 text-clay-500" />
              {t}
            </li>
          ))}
        </ul>
        <motion.div
          initial={{ opacity: 0, scale: 0.93 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-12 max-w-2xl"
        >
          <div
            aria-hidden
            className="absolute -inset-4 z-0 rounded-[2rem] bg-gradient-to-br from-clay-100/50 to-clay-50/30 blur-xl"
          />
          <TiltCard strength={4} className="relative z-[1]">
            <ResultCard variant="full" className="shadow-lift" />
          </TiltCard>
        </motion.div>
      </Container>
    </section>
  )
}

/* ----------------------------------------------------------- What's coming - */
function WhatsComing() {
  const features = [
    {
      icon: Compass,
      title: 'AI direction signal',
      body: 'Capture the prompts, edits, and checks a candidate uses while AI is allowed.',
      why: 'Separates strong operators from people who accept the first plausible answer.',
    },
    {
      icon: ShieldCheck,
      title: 'Outcome calibration',
      body: 'Track offer and retention labels so screens can be compared against hiring outcomes.',
      why: 'Keeps the score tied to what later proved useful, not just reviewer preference.',
    },
    {
      icon: FileText,
      title: 'Reusable credentials',
      body: 'Candidates can keep a verified, explainable result and reuse it with other teams.',
      why: 'Cuts repeat take-home work for people who already proved the skill.',
    },
    {
      icon: Sparkle,
      title: 'Task variants',
      body: 'Create different task versions from the same rubric and difficulty target.',
      why: 'Makes leaked answers less useful without changing what the screen measures.',
    },
    {
      icon: Slack,
      title: 'Hiring-system delivery',
      body: 'Send the score to Ashby, Greenhouse, and Slack when the screen is complete.',
      why: 'Keeps review in the workflow recruiters and hiring managers already use.',
    },
  ]
  return (
    <section id="whats-coming" className="scroll-mt-20 border-y border-stone-200 bg-sand bg-grain py-24">
      <Container>
        <SectionHeading
          size="lg"
          kicker="Roadmap"
          title="What we're building next."
          lede="The next layer is about making work-sample signal easier to compare, reuse, and deliver back into the hiring systems teams already run."
        />
        <TiltCard strength={3} className="mt-12 overflow-hidden rounded-2xl border border-stone-200 bg-white/60 shadow-card">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i * 70}>
              <div className="grid gap-x-10 gap-y-3 border-t border-stone-200 p-6 first:border-t-0 sm:p-7 md:grid-cols-[1.5fr_1fr] md:items-center">
                <div className="flex gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                    <f.icon size={20} />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{f.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{f.body}</p>
                  </div>
                </div>
                <div className="md:border-l md:border-stone-200 md:pl-10">
                  <p className="font-serif text-sm italic text-clay-600">Why it matters</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{f.why}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </TiltCard>
      </Container>
    </section>
  )
}

/* -------------------------------------------------- What we refuse to build - */
function RefuseToBuild() {
  const refuse = [
    {
      title: 'No detection arms race',
      body: 'We won’t build anti-cheat surveillance that punishes honest candidates and never wins.',
    },
    {
      title: 'No biometrics',
      body: 'No face scans, identity matching, or emotion inference. Session activity remains reviewer context.',
    },
    {
      title: 'No auto-apply',
      body: 'We don’t flood your pipeline with bot applications. We make the ones you have legible.',
    },
    {
      title: 'No canonical leetcode',
      body: 'No memorizable puzzles an LLM solves in seconds. Real work, with no lookup-able answer.',
    },
    {
      title: 'No enterprise-only pricing',
      body: 'No demo wall, no procurement gauntlet. Built to be self-serve for the teams who feel this most.',
    },
  ]
  return (
    <section className="relative overflow-hidden py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: 'radial-gradient(38% 46% at 90% 8%, rgba(158,53,40,0.05), transparent 60%)',
        }}
      />
      <Container className="relative z-[1]">
        {/* Asymmetric manifesto — statement on the left, the lines we hold on the right */}
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <Reveal>
            <Kicker className="mb-5">Conviction</Kicker>
            <h2 className="text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              What we refuse to build.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-stone-600">
              A trust product is defined as much by what it won't do. These are the lines we won't
              cross — on purpose.
            </p>
          </Reveal>

          <Reveal delay={100}>
            <TiltCard strength={3} className="overflow-hidden rounded-2xl border border-stone-200 bg-white/60 shadow-card">
              {refuse.map((r) => (
                <div
                  key={r.title}
                  className="flex gap-4 border-t border-stone-200 p-6 first:border-t-0"
                >
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-flag-50 text-flag-500 ring-1 ring-flag-100">
                    <X size={18} />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-ink">{r.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-stone-600">{r.body}</p>
                  </div>
                </div>
              ))}
            </TiltCard>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------------- Who it's for */
function WhoFor() {
  return (
    <section className="border-y border-stone-200 bg-sand bg-grain py-24">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <Kicker className="mb-5">Who it's for</Kicker>
            <h2 className="text-balance font-serif text-4xl font-semibold leading-tight sm:text-[2.85rem]">
              Made for startups hiring engineers.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-stone-600">
              Seed to Series B teams feel the cheating and fake-candidate pain most — and
              senior-engineer time is the scarcest thing you have. "Stop wasting onsites" is a
              painkiller, not a vitamin.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Built to be self-serve and transparent — no demo wall.',
                'Lands in Ashby / Greenhouse + Slack where you already hire.',
                'Respectful, AI-allowed candidate experience your applicants thank you for.',
              ].map((t) => (
                <li key={t} className="flex gap-3 text-sm leading-relaxed text-stone-700">
                  <Check size={18} className="mt-0.5 shrink-0 text-clay-500" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={120}>
            <TiltCard strength={3} className="overflow-hidden rounded-2xl border border-stone-200 bg-white/60 shadow-card">
              {[
                { k: 'Backend', d: 'Debug a failing service' },
                { k: 'Frontend', d: 'Ship a real component' },
                { k: 'Data / ML', d: 'Clean & model messy data' },
                { k: 'Full-stack', d: 'Wire a feature end-to-end' },
              ].map((c) => (
                <div
                  key={c.k}
                  className="flex items-baseline justify-between gap-4 border-t border-stone-200 px-5 py-4 first:border-t-0"
                >
                  <p className="font-serif text-lg text-ink">{c.k}</p>
                  <p className="text-sm text-stone-500">{c.d}</p>
                </div>
              ))}
            </TiltCard>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

/* -------------------------------------------------------- Request a demo --- */
function RequestDemo() {
  return (
    <section className="py-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <Kicker className="mb-5">For hiring teams</Kicker>
            <h2 className="text-balance font-serif text-4xl font-semibold leading-tight sm:text-[2.85rem]">
              Want a closer look? Request a demo.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-stone-600">
              We're onboarding a small group of design partners — free and white-glove while we're
              early, in exchange for running a real role and telling us the truth about it. Tell us a
              little about your team and we'll set up a walkthrough.
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-relaxed text-stone-700">
              {[
                'A live walkthrough of authoring, the candidate flow, and the result card.',
                'Help wiring it into your Ashby / Greenhouse + Slack setup.',
                'Direct line to the founder — your feedback shapes the roadmap.',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Check size={18} className="mt-0.5 shrink-0 text-clay-500" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <DemoForm
              heading="Request a demo"
              subhead="We'll reply personally — usually within a day."
            />
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

/* ------------------------------------------------------- Final CTA panel --- */
function FinalCTA() {
  return (
    <section className="py-20">
      <Container>
        <div className="relative overflow-hidden rounded-[1.75rem] bg-clay-600 bg-grain-light px-6 py-16 text-center shadow-lift ring-1 ring-clay-700/40 sm:px-10 sm:py-20">
          <Reveal>
            <p className="inline-flex items-center gap-2 font-serif text-base italic text-clay-50/90">
              <Fingerprint size={14} /> Launching soon
            </p>
            <h2 className="mx-auto mt-5 max-w-xl text-balance font-serif text-4xl font-semibold leading-tight text-white sm:text-5xl">
              {APP_ENABLED ? 'See it before you ask a candidate to.' : 'Be first in line.'}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-clay-50/85">
              {APP_ENABLED
                ? 'Open a real sample score report, or run a five-minute screen yourself — no signup, no call.'
                : "Join the waitlist and we'll reach out as we open up early access. Real work, real people, provable — before anyone wastes an onsite."}
            </p>
            {APP_ENABLED ? (
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/sample-report"
                  className="inline-flex items-center gap-2 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-clay-700 shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-white hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-clay-600"
                >
                  See a sample score report <ArrowRight size={16} />
                </Link>
                <Link
                  to="/candidate"
                  className="inline-flex items-center gap-2 rounded-full border border-white/35 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-clay-600"
                >
                  Try a screen yourself
                </Link>
              </div>
            ) : (
              <WaitlistForm id="waitlist-bottom" className="mx-auto mt-8 max-w-xl text-left" />
            )}
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-clay-50/80">
              Prefer to talk?{' '}
              <a href="/contact" className="font-medium text-white underline underline-offset-2">
                Contact us
              </a>
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

/* --------------------------------------------------------- Integrations --- */
// Clean ATS integration strip — swap /logos/*.svg with official brand SVGs anytime.
function Integrations() {
  return (
    <section className="border-t border-stone-200 py-16 sm:py-20">
      <Container>
        <div className="flex flex-col items-center gap-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-400">
            Integrated with your ATS
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-16 gap-y-8">
            <img src="/logos/ashby.svg" alt="Ashby" className="h-12 w-auto" />
            <span aria-hidden className="hidden h-10 w-px bg-stone-200 sm:block" />
            <img src="/logos/greenhouse.svg" alt="Greenhouse" className="h-12 w-auto" />
          </div>
          <p className="max-w-lg text-base leading-relaxed text-stone-500">
            The verified score and evidence land right on the candidate card you already review in
            Ashby and Greenhouse — no new tab, no copy-paste.
          </p>
        </div>
      </Container>
    </section>
  )
}

export default function Home() {
  return (
    <>
      <Hero />
      {EDITORIAL_UI_ENABLED ? (
        <EditorialHome appEnabled={APP_ENABLED} />
      ) : (
        <>
          <Integrations />
          <ProblemShift />
          <HowItWorks />
          <WhatsComing />
          <RefuseToBuild />
          <WhoFor />
          <RequestDemo />
          <FinalCTA />
        </>
      )}
    </>
  )
}
