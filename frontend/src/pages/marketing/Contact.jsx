import { Container, Kicker } from '../../components/primitives.jsx'
import Reveal from '../../components/Reveal.jsx'
import DemoForm from '../../components/DemoForm.jsx'
import { Check, Link as LinkIcon, ShieldCheck } from '../../components/icons.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'

const LINKEDIN_URL = 'https://www.linkedin.com/company/trytouchstones/'
const HELP_EMAIL = 'help@touchstones.ai'

function LegacyContact() {
  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20">
          <Reveal>
            <Kicker className="mb-5">Contact</Kicker>
            <h1 className="max-w-2xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              Let's talk.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">
              Hiring engineers and tired of cheaters and ghosts? Whether you want a demo, want to be
              a design partner, or just have a question. We read every message.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="py-20">
        <Container className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Direct contact */}
          <Reveal>
            <div className="space-y-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  Email
                </p>
                <a
                  href={`mailto:${HELP_EMAIL}`}
                  className="mt-2 inline-block font-serif text-2xl font-semibold text-ink transition-colors hover:text-clay-700"
                >
                  {HELP_EMAIL}
                </a>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">
                  The fastest way to reach us. We usually reply within a day.
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  LinkedIn
                </p>
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-2 text-base font-medium text-clay-700 hover:underline"
                >
                  <LinkIcon size={16} /> linkedin.com/company/trytouchstones
                </a>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">
                  Follow along as we build in the open.
                </p>
              </div>

              <div className="rounded-2xl border border-stone-200 bg-sand p-6">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-clay-700">
                  <ShieldCheck size={18} /> Building in the open
                </p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  Touchstones is early and we'd rather earn your trust honestly than fake it. If your
                  team is hiring engineers, come shape what this becomes.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Message form */}
          <Reveal delay={120}>
            <DemoForm
              heading="Send us a message"
              subhead="Tell us what you're hoping to solve and we'll get back to you."
              cta="Send message"
            />
          </Reveal>
        </Container>
      </section>
    </>
  )
}

function EditorialContact() {
  return (
    <>
      <EditorialHero
        eyebrow="Contact / design partners"
        title="Bring one role. We will build the first screen with you."
        lede="Touchstones is looking for engineering teams willing to run a real pilot and give direct feedback on the task, evidence packet, and reviewer workflow."
        noteLabel="A useful first conversation"
        note="Tell us the role, where your current screen loses signal, and what your hiring team needs to trust before scheduling an interview."
        primary={{ label: 'Write to us', href: '#message' }}
        secondary={{ label: 'Read the product flow', to: '/product' }}
      >
        <div className="mt-5 space-y-2 border-t border-white/15 pt-5 text-xs text-stone-300">
          <p>Early-stage or scaling engineering team</p>
          <p>One active role is enough to begin</p>
        </div>
      </EditorialHero>

      <section id="message" className="border-b border-stone-200 py-16 sm:py-24">
        <Container className="grid items-start gap-12 lg:grid-cols-[0.72fr_1.28fr]">
          <Reveal>
            <EditorialHeading
              eyebrow="Direct line"
              title="A founder reads every message."
              lede="Use the form for context, or email directly if that is faster."
            />

            <div className="mt-8 divide-y divide-stone-200 border-y border-stone-200">
              <div className="py-5">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-400">Email</p>
                <a
                  href={`mailto:${HELP_EMAIL}`}
                  className="mt-2 inline-block font-serif text-2xl font-semibold text-ink transition-colors hover:text-brand-700"
                >
                  {HELP_EMAIL}
                </a>
              </div>
              <div className="py-5">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-400">LinkedIn</p>
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
                >
                  <LinkIcon size={15} /> Touchstones company page
                </a>
              </div>
            </div>

            <div className="mt-8 border-l-2 border-brand-500 pl-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ShieldCheck size={17} className="text-brand-600" /> Honest early-stage conversation
              </p>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                We will separate what works today from what is still being built, and tell you when the product is not a fit.
              </p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="border border-brand-200 bg-brand-50/45 p-3 sm:p-4">
              <DemoForm
                heading="Tell us about the role"
                subhead="A few concrete details help us make the first reply useful."
                cta="Send the note"
                className="rounded-none border-brand-100 shadow-lift"
              />
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-stone-200 bg-evidence-light py-16 sm:py-20">
        <Container>
          <EditorialHeading
            eyebrow="Pilot fit"
            title="The best design partners have a real decision to improve."
            lede="A polished hiring stack is not required. A specific role and honest feedback are."
          />
          <div className="mt-10 grid divide-y divide-stone-200 border-y border-stone-200 md:grid-cols-3 md:divide-x md:divide-y-0">
            {[
              ['Active role', 'You expect to screen candidates for an engineering role soon.'],
              ['Named reviewer', 'Someone on the hiring team can inspect evidence and compare it with the current process.'],
              ['Feedback loop', 'You can share what helped the decision and what created friction.'],
            ].map(([title, body]) => (
              <Reveal key={title} className="p-6 sm:p-8">
                <Check size={18} className="text-brand-600" />
                <h3 className="mt-4 font-sans text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.65fr_1fr]">
          <EditorialHeading
            eyebrow="After you write"
            title="The first reply should move the work forward."
          />
          <ol className="border-t border-stone-200">
            {[
              ['Clarify the role', 'We ask only for the context needed to judge pilot fit.'],
              ['Shape the screen', 'We outline a realistic task and the evidence the rubric should require.'],
              ['Agree on a cohort', 'We set a small first run and decide how feedback will be collected.'],
            ].map(([title, body], index) => (
              <Reveal key={title} delay={index * 70}>
                <li className="grid gap-3 border-b border-stone-200 py-5 sm:grid-cols-[3rem_1fr]">
                  <span className="font-mono text-sm text-brand-700">0{index + 1}</span>
                  <div>
                    <p className="font-semibold text-ink">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-600">{body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      <EditorialCta
        eyebrow="Prefer email?"
        title="Send the role and the current screening problem."
        body="Short is fine. We can fill in the details together."
        primary={{ label: HELP_EMAIL, href: `mailto:${HELP_EMAIL}` }}
        secondary={{ label: 'Review trust and security', to: '/trust' }}
      />
    </>
  )
}

export default function Contact() {
  return EDITORIAL_UI_ENABLED ? <EditorialContact /> : <LegacyContact />
}
