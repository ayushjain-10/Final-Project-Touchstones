import { useState } from 'react'
import { Container, Kicker } from '../../components/primitives.jsx'
import Reveal from '../../components/Reveal.jsx'
import Seo from '../../components/Seo.jsx'
import { HashLink } from '../../components/HashLink.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'

const HELP_EMAIL = 'help@touchstones.ai'

const groups = [
  {
    title: 'The basics',
    qas: [
      {
        q: 'What is Touchstones?',
        a: 'Evidence-backed, real-work screening for engineering hiring. A candidate completes a short, role-specific work sample with AI allowed. The hiring team receives criterion-level reasoning, linked work evidence, limited session integrity context, and a review packet for a human decision.',
      },
      {
        q: 'How long does a screen take?',
        a: 'Screens are designed to take about 30 minutes so candidates can complete realistic work without turning the process into a take-home project.',
      },
      {
        q: 'Can candidates use AI?',
        a: "Yes, by design. The task makes AI use explicit and preserves relevant work context so reviewers can see how the candidate used, challenged, and explained the output.",
      },
    ],
  },
  {
    title: 'Trust & privacy',
    qas: [
      {
        q: 'Is this surveillance? Do you use a webcam or biometrics?',
        a: 'No biometrics, ever: no face scans, no identity matching, no emotion inference, no raw keystroke logging. Most screens use no camera at all. An employer can mark a screen as camera-required, and on those the candidate is asked to turn on their camera and microphone as a live presence signal, with the choice explained before they start. Even then nothing is recorded or stored: no video, no audio, no snapshots ever leave the browser. Limited session activity can be shown as reviewer context, never as an automated hiring decision.',
      },
      {
        q: 'How is the score explained?',
        a: 'AI evaluates each criterion against the work evidence. The weighted total is calculated in code from your rubric, with criterion-level reasoning and evidence available for review.',
      },
      {
        q: 'What do you do with candidate data?',
        a: (
          <>
            Only what's needed to generate and share the result with the hiring team that ran the
            screen. We don't sell data or use it to train third-party models. See our{' '}
            <HashLink to="/privacy" className="font-medium text-clay-700 underline">
              Privacy Policy
            </HashLink>{' '}
            and{' '}
            <HashLink to="/subprocessors" className="font-medium text-clay-700 underline">
              sub-processors list
            </HashLink>
            .
          </>
        ),
      },
    ],
  },
  {
    title: 'Getting started',
    qas: [
      {
        q: 'How do I get access?',
        a: (
          <>
            We're onboarding teams gradually.{' '}
            <HashLink to="/#waitlist" className="font-medium text-clay-700 underline">
              Join the waitlist
            </HashLink>{' '}
            and we'll reach out as we open early access to design partners.
          </>
        ),
      },
      {
        q: 'How much does it cost?',
        a: 'Early access is hands-on while we build with design partners. Reach out and we’ll talk through what fits your team.',
      },
      {
        q: 'How do I reach a human?',
        a: (
          <>
            Email{' '}
            <a href={`mailto:${HELP_EMAIL}`} className="font-medium text-clay-700 underline">
              {HELP_EMAIL}
            </a>{' '}
            . A real person reads every message, usually within a day.
          </>
        ),
      },
    ],
  },
]

function LegacyFAQ() {
  return (
    <>
      <Seo
        title="Help & FAQ"
        description="Answers to common questions about Touchstones, including real-work screening, AI use, privacy, session integrity, and access."
      />
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-16">
          <Reveal>
            <Kicker className="mb-5">Help &amp; FAQ</Kicker>
            <h1 className="max-w-2xl text-balance font-serif text-4xl font-semibold leading-[1.08] sm:text-5xl">
              Questions, answered plainly.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600">
              Can't find what you need? Email{' '}
              <a href={`mailto:${HELP_EMAIL}`} className="font-medium text-clay-700 underline">
                {HELP_EMAIL}
              </a>{' '}
              and we'll help.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-3xl space-y-12">
          {groups.map((g) => (
            <Reveal key={g.title}>
              <div>
                <h2 className="font-serif text-2xl font-semibold text-ink">{g.title}</h2>
                <dl className="mt-5 space-y-6">
                  {g.qas.map((qa) => (
                    <div key={qa.q} className="rounded-2xl border border-stone-200 bg-canvas p-6">
                      <dt className="font-semibold text-ink">{qa.q}</dt>
                      <dd className="mt-2 text-base leading-relaxed text-stone-700">{qa.a}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          ))}
        </Container>
      </section>
    </>
  )
}

function EditorialFAQItem({ qa, open, onToggle }) {
  return (
    <div className="border-b border-stone-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-5 py-6 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-4"
        aria-expanded={open}
      >
        <span className="font-sans text-base font-semibold leading-snug text-ink sm:text-lg">{qa.q}</span>
        <span
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm transition ${
            open
              ? 'rotate-45 border-brand-400 bg-brand-50 text-brand-700'
              : 'border-stone-300 text-stone-500'
          }`}
          aria-hidden="true"
        >
          +
        </span>
      </button>
      {open && <div className="max-w-2xl pb-6 text-base leading-relaxed text-stone-600">{qa.a}</div>}
    </div>
  )
}

function EditorialFAQ() {
  const [openQuestion, setOpenQuestion] = useState(groups[0].qas[0].q)

  return (
    <>
      <Seo
        title="Help & FAQ"
        description="Answers to common questions about Touchstones, including real-work screening, AI use, privacy, session integrity, and design-partner access."
      />
      <EditorialHero
        eyebrow="Help / questions answered plainly"
        title="Understand the product before you trust it with a hiring decision."
        lede="These answers cover the assessment model, candidate experience, data boundaries, and early access. If an answer is missing, ask a person."
        noteLabel="Direct support"
        note="Email help@touchstones.ai. A real person reads every message."
        primary={{ label: 'Ask a question', href: `mailto:${HELP_EMAIL}` }}
        secondary={{ label: 'Review trust and security', to: '/trust' }}
      />

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[0.45fr_1fr]">
            <Reveal>
              <div className="lg:sticky lg:top-28">
                <p className="font-serif text-sm italic text-brand-600">Question index</p>
                <div className="mt-5 border-t border-stone-200">
                  {groups.map((group, index) => (
                    <a
                      key={group.title}
                      href={`#faq-${index + 1}`}
                      className="grid grid-cols-[2.5rem_1fr] border-b border-stone-200 py-4 text-sm transition hover:text-brand-700"
                    >
                      <span className="font-mono text-xs text-brand-600">0{index + 1}</span>
                      <span className="font-semibold">{group.title}</span>
                    </a>
                  ))}
                </div>
                <p className="mt-6 max-w-xs text-sm leading-relaxed text-stone-500">
                  Product behavior can change during early access. We update these answers when the workflow changes materially.
                </p>
              </div>
            </Reveal>

            <div className="space-y-14">
              {groups.map((group, groupIndex) => (
                <Reveal key={group.title}>
                  <section id={`faq-${groupIndex + 1}`} className="scroll-mt-28">
                    <div className="flex items-baseline gap-4 border-b-2 border-brand-500 pb-4">
                      <span className="font-mono text-xs text-brand-600">0{groupIndex + 1}</span>
                      <h2 className="font-serif text-2xl font-semibold">{group.title}</h2>
                    </div>
                    <div>
                      {group.qas.map((qa) => (
                        <EditorialFAQItem
                          key={qa.q}
                          qa={qa}
                          open={openQuestion === qa.q}
                          onToggle={() => setOpenQuestion((current) => (current === qa.q ? null : qa.q))}
                        />
                      ))}
                    </div>
                  </section>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <EditorialCta
        eyebrow="Still unclear?"
        title="Send the question you would ask in a security or product review."
        body="We will answer from the current product, including what is not built yet."
        primary={{ label: HELP_EMAIL, href: `mailto:${HELP_EMAIL}` }}
        secondary={{ label: 'Start a pilot conversation', to: '/contact' }}
      />
    </>
  )
}

export default function FAQ() {
  return EDITORIAL_UI_ENABLED ? <EditorialFAQ /> : <LegacyFAQ />
}
