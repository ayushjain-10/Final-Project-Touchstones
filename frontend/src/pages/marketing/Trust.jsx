import { Container, Kicker, SectionHeading } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'
import {
  Check,
  X,
  Lock,
  ShieldCheck,
  FileText,
  Eye,
  ArrowRight,
} from '../../components/icons.jsx'

const collect = [
  'The work a candidate submits for the screen',
  'Session activity needed to review continuity, including paste, focus, and timing summaries',
  'Basic environment metadata the server observes',
  'The score, reasoning and evidence we generate',
]
const never = [
  'Webcam, face, or any biometric data',
  'Keystroke-level surveillance after the screen ends',
  'Social media, browsing history, or off-platform activity',
  'Anything the candidate self-reports as identity proof',
]

const compliance = [
  {
    icon: FileText,
    title: 'Explainable and logged by default',
    body: 'Criterion evaluations include reasoning, linked evidence, and an exportable product record for internal review.',
  },
  {
    icon: ShieldCheck,
    title: 'Built for human review',
    body: 'AI evaluates criteria against evidence, while the weighted total is calculated in code and the hiring decision stays with your team.',
  },
  {
    icon: Eye,
    title: 'Session context, not identity proof',
    body: 'Limited integrity summaries can prompt human review without face scans, identity matching, or automated pass and fail decisions.',
  },
]

const practices = [
  'Encrypted in transit (TLS) and at rest',
  'Row-level security; least-privilege access',
  'Secrets managed outside the codebase; keys rotated',
  'Rate limiting and replay protection on sensitive endpoints',
  'Stored on Supabase Postgres as the application system of record',
  'Candidate data deletable on request',
]

function LegacyTrust() {
  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20">
          <Reveal>
            <Kicker className="mb-5">Trust &amp; security</Kicker>
            <h1 className="max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              A trust product has to earn trust honestly.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              Here is exactly what we collect, what we refuse to, where it lives, and how we keep
              candidate experience respectful. No dark patterns, no surveillance theater.
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Collect vs never */}
      <section className="py-20">
        <Container>
          <div className="grid gap-5 md:grid-cols-2">
            <Reveal className="rounded-2xl border border-stone-200 bg-white p-7 shadow-card">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-clay-700">
                <Check size={18} /> What we collect
              </p>
              <ul className="mt-5 space-y-3.5">
                {collect.map((t) => (
                  <li key={t} className="flex gap-3 text-sm leading-relaxed text-stone-700">
                    <Check size={18} className="mt-0.5 shrink-0 text-clay-500" />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={100} className="rounded-2xl border border-stone-200 bg-white p-7 shadow-card">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-stone-500">
                <X size={18} className="text-flag-500" /> What we never collect
              </p>
              <ul className="mt-5 space-y-3.5">
                {never.map((t) => (
                  <li key={t} className="flex gap-3 text-sm leading-relaxed text-stone-600">
                    <X size={18} className="mt-0.5 shrink-0 text-stone-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Compliance */}
      <section className="border-y border-stone-200 bg-canvas/60 py-24">
        <Container>
          <SectionHeading
            align="center"
            kicker="Compliance posture"
            title="Defensible decisions, by design."
            lede="The product supplies reviewable records and controls. Your team remains responsible for policy, validation, and legal obligations."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {compliance.map((c, i) => (
              <Reveal key={c.title} delay={i * 100}>
                <div className="card h-full p-7">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                    <c.icon size={20} />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Practices + candidate */}
      <section className="py-24">
        <Container className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <Kicker className="mb-5">Security practices</Kicker>
            <h2 className="font-serif text-3xl font-semibold leading-tight">
              The basics, done properly.
            </h2>
            <ul className="mt-7 grid gap-3.5">
              {practices.map((p) => (
                <li key={p} className="flex items-start gap-3 text-sm leading-relaxed text-stone-700">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-clay-50 text-clay-600">
                    <Lock size={13} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={120}>
            <div className="card h-full p-8">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                <Eye size={20} />
              </span>
              <h3 className="mt-5 font-serif text-2xl font-semibold">For candidates</h3>
              <p className="mt-3 text-base leading-relaxed text-stone-600">
                You are told up front that AI is allowed. We measure your work, not your face. The
                signals we use are about the session, not surveillance, and you can ask us to delete
                your data at any time.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button to="/contact" variant="ghost">
                  Ask us anything <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="border-t border-stone-200 bg-sand py-16">
        <Container className="flex flex-col items-center gap-4 text-center">
          <ShieldCheck size={28} className="text-clay-600" />
          <h2 className="max-w-xl text-balance font-serif text-3xl font-semibold leading-tight">
            Questions about data or security?
          </h2>
          <p className="max-w-md text-stone-600">
            We answer plainly. Reach out and we will walk you through our posture.
          </p>
          <Button href="mailto:support@touchstones.ai" variant="primary" className="mt-2">
            support@touchstones.ai
          </Button>
        </Container>
      </section>
    </>
  )
}

function EditorialTrust() {
  const reviewSupports = [
    {
      icon: FileText,
      title: 'Criterion-level evidence',
      body: 'Reasoning stays attached to the work artifact and the rubric criterion it supports.',
    },
    {
      icon: ShieldCheck,
      title: 'Human review boundary',
      body: 'Integrity states add context for reviewers. They do not automatically pass, fail, or advance anyone.',
    },
    {
      icon: Lock,
      title: 'Deletable records',
      body: 'Candidate records can be removed through the product retention and deletion workflow.',
    },
  ]

  return (
    <>
      <EditorialHero
        eyebrow="Trust / product posture"
        title="Collect less. Explain more. Keep the decision human."
        lede="Touchstones is built to review an assessment session, not identify or surveil a person. This page separates what the product records, what it refuses to collect, and where reviewer judgment begins."
        noteLabel="Non-negotiable boundary"
        note="No facial recognition, identity matching, or emotion inference. Session integrity signals remain review flags for people, never automated hiring outcomes."
        primary={{ label: 'Ask a security question', to: '/contact' }}
        secondary={{ label: 'See the product flow', to: '/product' }}
      >
        <p className="mt-5 border-t border-white/15 pt-5 text-xs leading-relaxed text-stone-400">
          Product documentation supports your internal review. It is not a substitute for legal advice or an independent audit.
        </p>
      </EditorialHero>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container>
          <EditorialHeading
            eyebrow="Data manifest"
            title="The record is limited to the work and its review context."
            lede="The clearest trust model is a concrete inventory."
          />
          <div className="mt-10 grid border border-stone-200 bg-white shadow-card lg:grid-cols-2">
            <Reveal className="p-6 sm:p-8 lg:border-r lg:border-stone-200">
              <p className="flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                <Check size={16} /> Recorded for the assessment
              </p>
              <ul className="mt-6 divide-y divide-stone-200 border-t border-stone-200">
                {collect.map((item) => (
                  <li key={item} className="flex gap-3 py-4 text-sm leading-relaxed text-stone-700">
                    <Check size={17} className="mt-0.5 shrink-0 text-brand-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={100} className="border-t border-stone-200 bg-stone-50/70 p-6 sm:p-8 lg:border-t-0">
              <p className="flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-danger-700">
                <X size={16} /> Outside the product boundary
              </p>
              <ul className="mt-6 divide-y divide-stone-200 border-t border-stone-200">
                {never.map((item) => (
                  <li key={item} className="flex gap-3 py-4 text-sm leading-relaxed text-stone-600">
                    <X size={17} className="mt-0.5 shrink-0 text-stone-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="border-b border-stone-200 bg-evidence-light py-16 sm:py-24">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
            <Reveal>
              <EditorialHeading
                eyebrow="Decision boundary"
                title="A signal can start a review. It cannot finish one."
                lede="The system preserves the difference between observation, interpretation, and a hiring decision."
              />
            </Reveal>
            <div className="border-t border-brand-200">
              {[
                ['Captured', 'Work artifacts and limited session summaries are recorded during the assessment.'],
                ['Interpreted', 'The review packet explains which evidence connects to each criterion and where integrity context may need attention.'],
                ['Decided', 'A person evaluates the packet alongside the rest of the hiring process and records the outcome.'],
              ].map(([label, body], index) => (
                <Reveal key={label} delay={index * 80}>
                  <div className="grid gap-4 border-b border-brand-200 py-6 sm:grid-cols-[7rem_1fr]">
                    <p className="font-serif text-lg font-semibold text-brand-800">{label}</p>
                    <p className="text-sm leading-relaxed text-stone-700">{body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container>
          <EditorialHeading
            eyebrow="Security practices"
            title="The operating basics are part of the product."
            lede="Controls are described plainly so design partners can ask specific questions during review."
          />
          <div className="mt-10 grid border-y border-stone-200 md:grid-cols-2">
            {practices.map((practice, index) => (
              <Reveal
                key={practice}
                delay={(index % 2) * 70}
                className={`flex gap-4 py-5 ${
                  index % 2 === 0 ? 'md:border-r md:pr-8' : 'md:pl-8'
                } ${index < practices.length - 2 ? 'border-b border-stone-200' : ''}`}
              >
                <Lock size={17} className="mt-0.5 shrink-0 text-brand-600" />
                <p className="text-sm leading-relaxed text-stone-700">{practice}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <Reveal>
            <EditorialHeading
              eyebrow="Review support"
              title="Documentation should make scrutiny easier."
              lede="Touchstones provides evidence records and product controls that can support your hiring review process. Your team remains responsible for policy, validation, and legal obligations."
            />
          </Reveal>
          <div className="divide-y divide-stone-200 border-y border-stone-200">
            {reviewSupports.map((item, index) => (
              <Reveal key={item.title} delay={index * 70} className="grid gap-4 py-6 sm:grid-cols-[2.5rem_1fr]">
                <span className="grid h-9 w-9 place-items-center border border-brand-200 bg-brand-50 text-brand-700">
                  <item.icon size={17} />
                </span>
                <div>
                  <h3 className="font-sans text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <EditorialCta
        eyebrow="Security conversation"
        title="Bring the hard questions before you bring candidate data."
        body="We will walk through the current controls, data flow, and known gaps plainly."
        primary={{ label: 'Contact the team', to: '/contact' }}
        secondary={{ label: 'Email help@touchstones.ai', href: 'mailto:help@touchstones.ai' }}
      />
    </>
  )
}

export default function Trust() {
  return EDITORIAL_UI_ENABLED ? <EditorialTrust /> : <LegacyTrust />
}
