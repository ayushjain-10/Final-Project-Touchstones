import { Container, Kicker, SectionHeading } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import { ArrowRight, Linkedin, Code, ShieldCheck, FileText } from '../../components/icons.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'

const principles = [
  {
    icon: Code,
    title: 'Real work over trivia',
    body: 'Measure how someone thinks and solves a real problem, not whether they memorized a puzzle an LLM solves in seconds.',
  },
  {
    icon: ShieldCheck,
    title: 'Assurance without surveillance',
    body: 'Give reviewers limited session context without facial recognition, identity matching, or automated hiring decisions.',
  },
  {
    icon: FileText,
    title: 'Honest by default',
    body: 'Explainable scores, real pricing, no fake testimonials. For a trust company, authenticity is the whole product.',
  },
]

function LegacyAbout() {
  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto]">
            <Reveal>
              <Kicker className="mb-5">About</Kicker>
              <h1 className="max-w-2xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
                Hiring should be based on real work by real people.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">
                Touchstones is an evidence-backed real-work screening layer for engineering teams,
                preserving how a candidate approaches job-relevant work before the onsite.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <div className="card w-full max-w-xs p-6 text-center lg:w-72">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-clay-500 font-serif text-2xl font-semibold text-white">
                  AJ
                </div>
                <p className="mt-4 font-serif text-lg font-semibold">Ayush Jain</p>
                <p className="text-sm text-stone-500">Founder &amp; engineer</p>
                <div className="mt-4 flex justify-center gap-2">
                  <a
                    href="https://www.linkedin.com/in/ayush-jain-19191a1a6/"
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-stone-500 transition-colors hover:border-clay-300 hover:text-clay-700"
                    aria-label="Ayush Jain on LinkedIn"
                  >
                    <Linkedin size={16} />
                  </a>
                  <a
                    href="https://www.linkedin.com/company/trytouchstones/"
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-stone-500 transition-colors hover:border-clay-300 hover:text-clay-700"
                    aria-label="Touchstones on LinkedIn"
                  >
                    <Linkedin size={16} />
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Story */}
      <section className="py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Kicker className="mb-6">The story</Kicker>
            <div className="space-y-5 text-lg leading-relaxed text-stone-700">
              <p>
                I kept watching the same thing happen: strong-looking candidates who fell apart the
                moment the work got real, and teams burning their scarcest resource, senior-engineer
                hours, on onsites that should never have been scheduled.
              </p>
              <p>
                Then AI made it worse. Detection tools turned hiring into an arms race nobody can
                win, and fake candidates started showing up at scale. The honest answer was not to
                police AI harder. It was to change what the test measures: give people real work, let
                them use AI like they would on the job, and preserve enough evidence for a useful
                human review.
              </p>
              <p>
                Touchstones is that idea, built. It is early, and I am building it in the open. I would
                rather earn your trust with a working product and honest numbers than manufacture
                social proof. That is why you will not find fake logos or invented
                testimonials on this site.
              </p>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Principles */}
      <section className="border-y border-stone-200 bg-canvas/60 py-24">
        <Container>
          <SectionHeading align="center" kicker="What we believe" title="Three principles." />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {principles.map((p, i) => (
              <Reveal key={p.title} delay={i * 100}>
                <div className="card h-full p-7">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                    <p.icon size={20} />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Contact / design partner */}
      <section className="py-24">
        <Container className="max-w-3xl text-center">
          <Reveal>
            <h2 className="mx-auto max-w-xl text-balance font-serif text-4xl font-semibold leading-tight">
              Hiring engineers? Come be a design partner.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-stone-600">
              Free and white-glove while we are early, in exchange for running a real role and
              telling us the truth about it.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button to="/contact" variant="primary" className="px-6 py-3 text-base">
                Become a design partner <ArrowRight size={18} />
              </Button>
              <Button href="mailto:help@touchstones.ai" variant="ghost" className="px-6 py-3 text-base">
                help@touchstones.ai
              </Button>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  )
}

function EditorialAbout() {
  return (
    <>
      <EditorialHero
        eyebrow="About / founder-built"
        title="Technical hiring should reveal judgment, not reward performance theater."
        lede="Touchstones is building an evidence layer for engineering screens: realistic work, explicit AI use, criterion-level reasoning, and a human decision at the end."
        noteLabel="Why now"
        note="AI made answer policing less useful. The better response is to change the assessment format and make the work itself reviewable."
        primary={{ label: 'Become a design partner', to: '/contact' }}
        secondary={{ label: 'See the product', to: '/product' }}
      >
        <div className="mt-5 flex items-center gap-3 border-t border-white/15 pt-5">
          <span className="grid h-9 w-9 place-items-center bg-brand-500 font-serif font-semibold text-white">AJ</span>
          <div>
            <p className="text-sm font-semibold text-white">Ayush Jain</p>
            <p className="text-xs text-stone-400">Founder and engineer</p>
          </div>
        </div>
      </EditorialHero>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.62fr_1fr]">
          <Reveal>
            <EditorialHeading
              eyebrow="The thesis"
              title="Do not ask whether someone used AI. Ask what their work proves."
            />
          </Reveal>
          <Reveal delay={100}>
            <div className="space-y-6 text-lg leading-relaxed text-stone-700">
              <p>
                Technical screens were already drifting away from the work engineers actually do. Then AI made rehearsed questions and lookup-friendly tasks even easier to shortcut.
              </p>
              <p>
                Trying to detect every tool only creates a new arms race. Touchstones takes the opposite position: allow AI, make the task realistic, preserve the candidate's reasoning and artifacts, and let a reviewer judge that evidence against a role-specific rubric.
              </p>
              <p>
                The product is early. That is why the site does not manufacture customer logos, testimonials, or certainty. The next stage is to build alongside teams with an active role and learn where the evidence changes a real decision.
              </p>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-stone-200 bg-evidence-light py-16 sm:py-24">
        <Container>
          <EditorialHeading
            eyebrow="Operating principles"
            title="Three constraints shape the product."
            lede="They are product decisions, not positioning garnish."
          />
          <div className="mt-10 grid divide-y divide-stone-200 border-y border-stone-200 md:grid-cols-3 md:divide-x md:divide-y-0">
            {principles.map((principle, index) => (
              <Reveal key={principle.title} delay={index * 80} className="p-6 sm:p-8">
                <principle.icon size={21} className="text-brand-600" />
                <h3 className="mt-5 font-sans text-lg font-semibold">{principle.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">{principle.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
          <Reveal>
            <EditorialHeading
              eyebrow="What is being built"
              title="One reviewable path from role brief to hiring conversation."
              lede="The product is being shaped around a small number of connected artifacts instead of an expanding feature checklist."
            />
          </Reveal>
          <div className="border-t border-stone-200">
            {[
              ['Role brief', 'A real task, an explicit AI policy, and a weighted rubric.'],
              ['Work trail', 'The candidate’s approach, tests, changes, and AI interactions as reviewable context.'],
              ['Review packet', 'Criterion-level reasoning, linked artifacts, session context, and the final walkthrough.'],
              ['Team learning', 'Feedback from real hiring decisions that improves the next version of the workflow.'],
            ].map(([title, body], index) => (
              <Reveal key={title} delay={index * 70}>
                <div className="grid gap-4 border-b border-stone-200 py-6 sm:grid-cols-[9rem_1fr]">
                  <p className="font-serif text-lg font-semibold text-brand-800">{title}</p>
                  <p className="text-sm leading-relaxed text-stone-600">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="grid items-center gap-10 lg:grid-cols-[0.55fr_1fr]">
          <Reveal>
            <div className="border border-brand-200 bg-brand-50/60 p-8 text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center bg-brand-600 font-serif text-2xl font-semibold text-white">
                AJ
              </div>
              <p className="mt-5 font-serif text-xl font-semibold">Ayush Jain</p>
              <p className="mt-1 text-sm text-stone-500">Founder and engineer</p>
              <div className="mt-5 flex justify-center gap-2">
                <a
                  href="https://www.linkedin.com/in/ayush-jain-19191a1a6/"
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-10 w-10 place-items-center border border-brand-200 bg-white text-brand-700 transition hover:border-brand-400"
                  aria-label="Ayush Jain on LinkedIn"
                >
                  <Linkedin size={17} />
                </a>
                <a
                  href="https://www.linkedin.com/company/trytouchstones/"
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-10 w-10 place-items-center border border-brand-200 bg-white text-brand-700 transition hover:border-brand-400"
                  aria-label="Touchstones on LinkedIn"
                >
                  <Linkedin size={17} />
                </a>
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <p className="font-serif text-sm italic text-brand-600">A note from the founder</p>
            <blockquote className="mt-4 font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl">
              “I would rather show an unfinished product honestly and improve it with the right teams than hide behind invented proof.”
            </blockquote>
            <p className="mt-5 max-w-xl leading-relaxed text-stone-600">
              If your team is hiring engineers and this thesis matches the problem you see, the most valuable thing you can bring is one role and unfiltered feedback.
            </p>
          </Reveal>
        </Container>
      </section>

      <EditorialCta
        title="Help turn the thesis into a workflow your team trusts."
        body="Run a real role, inspect the packet, and tell us where the product still falls short."
        primary={{ label: 'Become a design partner', to: '/contact' }}
        secondary={{ label: 'Explore the trust model', to: '/trust' }}
      />
    </>
  )
}

export default function About() {
  return EDITORIAL_UI_ENABLED ? <EditorialAbout /> : <LegacyAbout />
}
