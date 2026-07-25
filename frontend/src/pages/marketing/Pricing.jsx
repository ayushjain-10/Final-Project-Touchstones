import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Container, Kicker, Pill, SectionHeading } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import { Check, ArrowRight } from '../../components/icons.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import api from '../../services/api.js'

// Where to email enterprise inquiries.
const ENTERPRISE_EMAIL = 'help@touchstones.ai'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    blurb: 'A real product, not a teaser. Great for your first few hires.',
    cta: 'Get started',
    // 'free' → link straight into the app (ProtectedRoute / Login handles the sign-in gate).
    kind: 'free',
    to: '/app',
    features: [
      '5 evidence screens / month',
      'All role templates',
      'Score + reasoning + evidence',
      'Session integrity context',
      'Shareable link + Slack',
    ],
  },
  {
    name: 'Startup',
    price: '$99',
    cadence: 'per month',
    blurb: 'For a team making a handful of engineering hires. Pay-as-you-go available.',
    cta: 'Subscribe',
    // 'subscribe' → Stripe Checkout for this plan (resolved server-side by name).
    kind: 'subscribe',
    plan: 'startup',
    featured: true,
    features: [
      'Everything in Free',
      '50 evidence screens / month',
      'Custom rubrics',
      'Audit-trail export',
      'Or ~$15–20 per screen, pay-as-you-go',
    ],
  },
  {
    name: 'Growth',
    price: '$399',
    cadence: 'per month',
    blurb: 'More volume, more seats, and the integrations your process needs.',
    cta: 'Subscribe',
    kind: 'subscribe',
    plan: 'growth',
    features: [
      'Everything in Startup',
      'Unlimited seats',
      'Ashby / Greenhouse sync',
      'Custom rubric library',
      'Priority support',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Talk to us',
    cadence: '',
    blurb: 'For larger orgs with compliance and security requirements.',
    cta: 'Contact us',
    // 'contact' → mailto the founder; no self-serve checkout.
    kind: 'contact',
    features: ['Everything in Growth', 'SSO / SAML', 'Compliance pack & DPA', 'SLA', 'Security review'],
  },
]

const benchmarks = [
  { name: 'Touchstones', price: 'Free to $399/mo', note: 'Current indicative plans', us: true },
  { name: 'Self-serve assessment tools', price: 'Varies', note: 'Often annual or seat-based' },
  { name: 'Enterprise assessment suites', price: 'Contact sales', note: 'Frequently contract-based' },
  { name: 'Live technical interviews', price: 'Per interview', note: 'Service pricing varies' },
]

const faqs = [
  {
    q: 'What does "AI allowed" actually mean?',
    a: 'Candidates can use AI as part of the task. The work trail preserves relevant context so reviewers can see how the candidate used, challenged, and explained the output. AI use is not a hidden penalty.',
  },
  {
    q: 'How is the score computed?',
    a: 'AI evaluates each criterion against the work evidence. The final weighted total is tallied and normalized in code from your rubric, with the reasoning and linked evidence available for review.',
  },
  {
    q: 'Do you use webcams or biometrics?',
    a: 'No. Touchstones does not use webcams, face scans, identity matching, emotion inference, or raw keystroke logging. Limited session summaries are reviewer context only.',
  },
  {
    q: 'How do you handle candidate data?',
    a: 'Candidate records are stored on Supabase, encrypted in transit and at rest, and deletable on request. Results include an exportable product record for internal review. This is not a compliance guarantee or a substitute for counsel. See the Trust page for specifics.',
  },
  {
    q: 'Can I change plans or cancel anytime?',
    a: 'Yes. The current Free, Startup, and Growth plan design is self-serve, with changes managed from the workspace.',
  },
]

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-stone-200 py-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="text-base font-semibold text-ink">{q}</span>
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border border-stone-300 text-stone-500 transition-transform ${
            open ? 'rotate-45' : ''
          }`}
        >
          +
        </span>
      </button>
      {open && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">{a}</p>}
    </div>
  )
}

function EditorialPricing({ TierCTA, checkoutError }) {
  return (
    <>
      <EditorialHero
        eyebrow="Pricing / early access"
        title="Start with one real role. Scale when the evidence earns it."
        lede="The self-serve plans below are indicative while we validate packaging with design partners. Early pilots are hands-on and free in exchange for direct product feedback."
        noteLabel="Design-partner offer"
        note="Bring one engineering role and a small candidate cohort. We help shape the task, rubric, and review workflow with you."
        primary={{ label: 'Discuss a pilot', to: '/contact' }}
        secondary={{ label: 'See the workflow', to: '/product' }}
      >
        <p className="mt-5 border-t border-white/15 pt-5 text-xs leading-relaxed text-stone-400">
          No production contract is created by joining a pilot. Final packaging will reflect what teams actually use.
        </p>
      </EditorialHero>

      <section className="border-b border-stone-200 py-16 sm:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <Reveal>
              <EditorialHeading
                eyebrow="Current offer"
                title="A design partnership before a pricing commitment."
                lede="Early teams help us pressure-test the screen, review packet, and operating workflow on a real role."
              />
              <div className="mt-8 border border-brand-200 bg-brand-50/70 p-6">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                  Pilot structure
                </p>
                <ol className="mt-5 space-y-4">
                  {[
                    ['Role', 'Choose one engineering role with an active hiring need.'],
                    ['Screen', 'Build the task and weighted rubric together.'],
                    ['Review', 'Compare the packet with your existing interview signal.'],
                    ['Feedback', 'Tell us what was useful, missing, or confusing.'],
                  ].map(([label, body]) => (
                    <li key={label} className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
                      <span className="font-semibold text-brand-800">{label}</span>
                      <span className="leading-relaxed text-stone-600">{body}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="border border-stone-200 bg-white shadow-card">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 px-5 py-5 sm:px-7">
                  <div>
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                      Indicative self-serve plans
                    </p>
                    <h2 className="mt-2 font-serif text-2xl font-semibold">After early access</h2>
                  </div>
                  <p className="max-w-xs text-xs leading-relaxed text-stone-500">
                    Prices may change as plan boundaries are validated.
                  </p>
                </div>
                <div className="divide-y divide-stone-200">
                  {tiers.map((tier) => (
                    <div
                      key={tier.name}
                      className={`grid gap-5 px-5 py-6 sm:px-7 lg:grid-cols-[0.55fr_0.7fr_1.15fr_auto] lg:items-center ${
                        tier.featured ? 'bg-brand-50/60' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-serif text-xl font-semibold">{tier.name}</h3>
                          {tier.featured && <Pill tone="brand">Common start</Pill>}
                        </div>
                      </div>
                      <div>
                        <span className="font-serif text-2xl font-semibold text-ink">{tier.price}</span>
                        {tier.cadence && <span className="ml-1.5 text-xs text-stone-500">{tier.cadence}</span>}
                      </div>
                      <p className="text-sm leading-relaxed text-stone-600">{tier.blurb}</p>
                      <div className="w-full lg:w-36">
                        <TierCTA t={tier} compact />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {checkoutError && (
                <p className="mt-4 text-sm text-danger-700" role="alert">
                  {checkoutError}
                </p>
              )}
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="border-b border-stone-200 bg-evidence-light py-16 sm:py-20">
        <Container>
          <EditorialHeading
            eyebrow="What the plan buys"
            title="The same evidence model at every stage."
            lede="Plan boundaries change volume and operating support. They do not weaken candidate transparency or reviewer control."
          />
          <div className="mt-10 grid divide-y divide-stone-200 border-y border-stone-200 md:grid-cols-4 md:divide-x md:divide-y-0">
            {[
              ['AI policy', 'Candidates know AI is allowed before they begin.'],
              ['Work evidence', 'Artifacts stay connected to the rubric criterion they support.'],
              ['Review control', 'Integrity context never makes the hiring decision.'],
              ['Data access', 'Teams can review and delete records within the product workflow.'],
            ].map(([label, body]) => (
              <Reveal key={label} className="p-6">
                <p className="font-semibold text-ink">{label}</p>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.62fr_1fr]">
          <EditorialHeading
            eyebrow="Buying questions"
            title="What teams ask before they start."
            lede="If your procurement or security question is not here, send it directly."
          />
          <div className="border-t border-stone-200">
            {faqs.map((faq) => (
              <FAQItem key={faq.q} {...faq} />
            ))}
          </div>
        </Container>
      </section>

      <EditorialCta
        title="Price the workflow after you have seen it on your role."
        body="Start with a design-partner pilot, inspect the review packet, and help us set the right packaging for teams like yours."
        primary={{ label: 'Talk through a pilot', to: '/contact' }}
        secondary={{ label: 'Read trust and security', to: '/trust' }}
      />
    </>
  )
}

export default function Pricing() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // Per-plan pending state so a click disables only that tier's button, plus a
  // single error line if Checkout couldn't be started.
  const [pendingPlan, setPendingPlan] = useState(null)
  const [checkoutError, setCheckoutError] = useState(null)

  async function startCheckout(plan) {
    // Signed out → send to login first; they can come back and subscribe.
    if (!user) {
      navigate('/login')
      return
    }
    setCheckoutError(null)
    setPendingPlan(plan)
    try {
      const { url } = await api.createCheckoutSession(plan)
      if (url) {
        window.location.assign(url)
        return // browser navigates away; keep the button disabled meanwhile
      }
      throw new Error('No checkout URL returned')
    } catch (err) {
      setCheckoutError(err?.message || 'Could not start checkout. Please try again.')
      setPendingPlan(null)
    }
  }

  // Render the right CTA for a tier: a router link (free), a Stripe Checkout button
  // (subscribe), or a contact mailto (enterprise).
  function TierCTA({ t, compact = false }) {
    const className = compact ? 'w-full lg:mt-0' : 'mt-5 w-full'
    if (t.kind === 'subscribe') {
      const pending = pendingPlan === t.plan
      return (
        <Button
          variant={t.featured ? 'primary' : 'ghost'}
          className={className}
          onClick={() => startCheckout(t.plan)}
          disabled={pending}
        >
          {pending ? 'Redirecting…' : t.cta} {t.featured && !pending && <ArrowRight size={16} />}
        </Button>
      )
    }
    if (t.kind === 'contact') {
      return (
        <Button href={`mailto:${ENTERPRISE_EMAIL}`} variant="ghost" className={className}>
          {t.cta}
        </Button>
      )
    }
    // free
    return (
      <Button to={t.to} variant="ghost" className={className}>
        {t.cta}
      </Button>
    )
  }

  if (EDITORIAL_UI_ENABLED) {
    return <EditorialPricing TierCTA={TierCTA} checkoutError={checkoutError} />
  }

  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20 text-center">
          <Reveal>
            <Kicker className="mb-5 justify-center">Pricing</Kicker>
            <h1 className="mx-auto max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              Transparent pricing. No demo wall.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
              Usage-based and self-serve. Start free, then pay as your hiring volume grows.
              only as you hire.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <div className="grid gap-5 lg:grid-cols-4">
            {tiers.map((t, i) => (
              <Reveal key={t.name} delay={i * 80}>
                <div
                  className={`flex h-full flex-col rounded-2xl border p-6 ${
                    t.featured
                      ? 'border-clay-300 bg-clay-50/60 shadow-lift ring-1 ring-clay-200'
                      : 'border-stone-200 bg-white shadow-card'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-xl font-semibold">{t.name}</h3>
                    {t.featured && <Pill tone="clay">Most popular</Pill>}
                  </div>
                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="font-serif text-4xl font-semibold text-ink">{t.price}</span>
                    {t.cadence && <span className="text-sm text-stone-500">{t.cadence}</span>}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-600">{t.blurb}</p>
                  <TierCTA t={t} />
                  <ul className="mt-6 space-y-3 border-t border-stone-200 pt-6">
                    {t.features.map((f) => (
                      <li key={f} className="flex gap-2.5 text-sm leading-snug text-stone-700">
                        <Check size={17} className="mt-0.5 shrink-0 text-clay-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
          {checkoutError && (
            <p className="mt-6 text-center text-sm text-flag-700" role="alert">
              {checkoutError}
            </p>
          )}
          <p className="mt-6 text-center text-sm text-stone-500">
            Prices shown are indicative while we lock pricing with design partners. Early access is
            free for design partners.
          </p>
        </Container>
      </section>

      {/* Benchmarks */}
      <section className="border-y border-stone-200 bg-sand py-20">
        <Container>
          <SectionHeading
            align="center"
            kicker="How we compare"
            title="Price structure, without pretending every product is comparable."
            lede="Market packaging changes often. These categories are directional and should be verified before a purchasing decision."
          />
          <div className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-2xl border border-stone-200 bg-white">
            {benchmarks.map((b) => (
              <div
                key={b.name}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${
                  b.us ? 'bg-clay-50/70' : ''
                } border-b border-stone-100 last:border-0`}
              >
                <span
                  className={`text-sm font-semibold ${b.us ? 'text-clay-700' : 'text-ink'}`}
                >
                  {b.name}
                </span>
                <span className="ml-auto text-sm font-medium text-ink">{b.price}</span>
                <span className="hidden w-44 text-right text-xs text-stone-500 sm:block">
                  {b.note}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <Container className="max-w-3xl">
          <SectionHeading kicker="Honest answers" title="Frequently asked." />
          <div className="mt-8">
            {faqs.map((f) => (
              <FAQItem key={f.q} {...f} />
            ))}
          </div>
        </Container>
      </section>
    </>
  )
}
