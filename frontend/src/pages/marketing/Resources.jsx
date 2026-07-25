import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient.js'
import { Container, Kicker, Pill, SectionHeading, Stat } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import { ArrowRight, FileText, Check, Clock } from '../../components/icons.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'

const articles = [
  {
    tag: 'Guide',
    title: 'How to write a real-work screen that rewards judgment',
    desc: 'The anatomy of a messy, role-specific task and a rubric that keeps the work evidence reviewable.',
    read: '8 min',
  },
  {
    tag: 'Comparison',
    title: 'Assessment design beyond proctoring and detection',
    desc: 'Why changing the task format can create better evidence without escalating surveillance.',
    read: '6 min',
  },
  {
    tag: 'Playbook',
    title: 'Reviewing session integrity without surveillance',
    desc: 'Limited context that can prompt human review without biometrics, face scans, or identity matching.',
    read: '7 min',
  },
  {
    tag: 'Compliance',
    title: 'Questions to ask counsel about automated hiring tools',
    desc: 'A plain-language checklist for product records, validation, review, and local obligations.',
    read: '9 min',
  },
  {
    tag: 'Opinion',
    title: 'AI did not break technical hiring. The format did.',
    desc: 'Why "did they use AI" is the wrong question, and what to ask instead.',
    read: '5 min',
  },
  {
    tag: 'Candidate',
    title: 'A candidate-respect checklist for real-work screens',
    desc: 'How to keep the task bounded, transparent, and proportionate to the hiring decision.',
    read: '4 min',
  },
]

export default function Resources() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [subStatus, setSubStatus] = useState('idle') // 'idle' | 'submitting' | 'error'
  const [category, setCategory] = useState('All')

  // Real signup (was a UI-only no-op that silently discarded the email): lands on the
  // waitlist with a newsletter source tag, which also triggers the founder notification
  // + Resend-audience add via the waitlist DB trigger (migration 089).
  async function subscribe(e) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value || !isSupabaseConfigured) return setSubStatus('error')
    setSubStatus('submitting')
    const { error } = await supabase.from('waitlist').insert({
      kind: 'waitlist',
      email: value,
      referral_source: 'resources-newsletter',
    })
    if (error && error.code !== '23505') return setSubStatus('error') // duplicate email = already subscribed = success
    setSubStatus('idle')
    setSubscribed(true)
  }

  if (EDITORIAL_UI_ENABLED) {
    const categories = ['All', ...new Set(articles.map((article) => article.tag))]
    const visibleArticles =
      category === 'All' ? articles : articles.filter((article) => article.tag === category)

    return (
      <>
        <EditorialHero
          eyebrow="Resources / field notes"
          title="Better screens start with a better assessment model."
          lede="Practical notes on designing AI-allowed work samples, reviewing evidence, protecting candidate dignity, and learning from real hiring decisions."
          noteLabel="Editorial policy"
          note="Nothing is presented as published research until it is sourced and available to read. Draft topics are labeled clearly."
          primary={{ label: 'Join the reading list', href: '#newsletter' }}
          secondary={{ label: 'See the product model', to: '/product' }}
        >
          <p className="mt-5 border-t border-white/15 pt-5 text-xs leading-relaxed text-stone-400">
            Written for hiring managers, engineering leaders, and operators building an evidence-based process.
          </p>
        </EditorialHero>

        <section className="border-b border-stone-200 py-16 sm:py-24">
          <Container>
            <Reveal>
              <div className="grid overflow-hidden border border-brand-200 bg-brand-50/55 shadow-card lg:grid-cols-[1.18fr_0.82fr]">
                <div className="p-6 sm:p-9 lg:border-r lg:border-brand-200">
                  <Pill tone="brand">
                    <FileText size={13} /> Field guide in progress
                  </Pill>
                  <h2 className="mt-5 max-w-2xl text-balance font-serif text-3xl font-semibold leading-tight sm:text-4xl">
                    Designing a technical screen where AI use becomes evidence.
                  </h2>
                  <p className="mt-5 max-w-2xl leading-relaxed text-stone-600">
                    A working guide to choosing a messy but bounded task, writing criteria that reward judgment, and capturing enough context for a useful human review.
                  </p>
                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <Pill>
                      <Clock size={13} /> Publication pending
                    </Pill>
                    <Link to="/contact" className="text-sm font-semibold text-brand-700 hover:underline">
                      Ask for the current outline
                    </Link>
                  </div>
                </div>
                <div className="border-t border-brand-200 p-6 sm:p-9 lg:border-t-0">
                  <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                    Current outline
                  </p>
                  <ol className="mt-5 space-y-4">
                    {[
                      'Choose job-relevant ambiguity',
                      'State the AI policy clearly',
                      'Tie every criterion to observable work',
                      'Separate session context from hiring outcomes',
                    ].map((item, index) => (
                      <li key={item} className="grid grid-cols-[2rem_1fr] gap-3 text-sm leading-relaxed text-stone-700">
                        <span className="font-mono text-brand-600">0{index + 1}</span>
                        {item}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </Reveal>
          </Container>
        </section>

        <section className="border-b border-stone-200 bg-evidence-light py-16 sm:py-24">
          <Container>
            <EditorialHeading
              eyebrow="Editorial queue"
              title="The questions we are working through in public."
              lede="Filter the queue by the kind of decision you are researching."
            />
            <div className="mt-8 flex flex-wrap gap-2" aria-label="Filter resource topics">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    category === item
                      ? 'border-brand-500 bg-brand-600 text-white'
                      : 'border-stone-300 bg-white text-stone-600 hover:border-brand-300 hover:text-brand-700'
                  }`}
                  aria-pressed={category === item}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="mt-10 border-t border-stone-200">
              {visibleArticles.map((article, index) => (
                <Reveal key={article.title} delay={(index % 3) * 60}>
                  <article className="grid gap-4 border-b border-stone-200 py-6 md:grid-cols-[8rem_1fr_auto] md:items-start">
                    <div>
                      <Pill>{article.tag}</Pill>
                    </div>
                    <div>
                      <h3 className="font-sans text-lg font-semibold leading-snug text-ink">{article.title}</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">{article.desc}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-stone-400 md:justify-end">
                      <Clock size={13} /> {article.read} draft
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>

        <section id="newsletter" className="py-16 sm:py-24">
          <Container className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
            <EditorialHeading
              eyebrow="Reading list"
              title="Get the next useful draft, not a weekly content quota."
              lede="We will send field guides and product learning when they are ready."
            />
            <Reveal>
              {subscribed ? (
                <div className="flex items-start gap-4 border border-success-200 bg-success-50 p-6 text-success-700">
                  <Check size={20} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">You are on the reading list.</p>
                    <p className="mt-1 text-sm">The next finished guide will arrive at the address you provided.</p>
                  </div>
                </div>
              ) : (
                <form className="border border-brand-200 bg-white p-5 shadow-card sm:p-6" onSubmit={subscribe}>
                  <label htmlFor="resource-email" className="text-sm font-semibold text-ink">
                    Work email
                  </label>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      id="resource-email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                      className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-paper px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    />
                    <Button variant="primary" type="submit" disabled={subStatus === 'submitting'}>
                      {subStatus === 'submitting' ? 'Joining…' : 'Join the list'} <ArrowRight size={16} />
                    </Button>
                  </div>
                  <p className={`mt-3 text-xs ${subStatus === 'error' ? 'text-danger-700' : 'text-stone-500'}`}>
                    {subStatus === 'error'
                      ? 'The signup could not be saved. Try again, or email help@touchstones.ai.'
                      : 'No publishing schedule theater. Unsubscribe at any time.'}
                  </p>
                </form>
              )}
            </Reveal>
          </Container>
        </section>

        <EditorialCta
          eyebrow="Have a question worth researching?"
          title="Bring the hiring problem you cannot answer with another checklist."
          body="Design partners shape both the product and the field notes around it."
          primary={{ label: 'Send the question', to: '/contact' }}
          secondary={{ label: 'Read trust and security', to: '/trust' }}
        />
      </>
    )
  }

  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20">
          <Reveal>
            <Kicker className="mb-5">The hiring-integrity hub</Kicker>
            <h1 className="max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              Better evidence for technical hiring.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              Research, guides, and comparisons on hiring real engineers in the AI era. Written to be
              useful whether or not you ever use Touchstones.
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Featured report */}
      <section className="py-16">
        <Container>
          <Reveal>
            <div className="overflow-hidden rounded-2xl border border-clay-200 bg-clay-50/50">
              <div className="grid gap-8 p-8 md:grid-cols-[1.2fr_0.8fr] md:p-10">
                <div>
                  <Pill tone="clay" className="mb-4">
                    <FileText size={13} /> Field guide · in progress
                  </Pill>
                  <h2 className="text-balance font-serif text-3xl font-semibold leading-tight">
                    Designing an AI-allowed work screen
                  </h2>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-stone-600">
                    How to choose a role-specific task, state the AI policy, connect work artifacts
                    to a weighted rubric, and preserve human control over the hiring decision.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <Pill tone="neutral">
                      <Clock size={13} /> Full report coming soon
                    </Pill>
                    <span className="text-sm text-stone-500">
                      Want an early copy?{' '}
                      <Link to="/contact" className="font-semibold text-clay-700 hover:text-clay-800">
                        Ask us
                      </Link>
                      .
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 self-center border-t border-clay-200 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
                  <Stat value="Task" label="Start with job-relevant ambiguity" tone="clay" />
                  <Stat value="Rubric" label="Define observable criteria" tone="clay" />
                  <Stat value="Trail" label="Keep evidence connected" tone="clay" />
                  <Stat value="Review" label="Let a person decide" tone="clay" />
                </div>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Article grid */}
      <section className="pb-24">
        <Container>
          <SectionHeading kicker="Reading" title="Guides, comparisons & playbooks." />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((a, i) => (
              <Reveal key={a.title} delay={(i % 3) * 90}>
                <div className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-card">
                  <div className="flex items-center justify-between">
                    <Pill>{a.tag}</Pill>
                    <span className="text-xs text-stone-400">{a.read}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold leading-snug text-ink">{a.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{a.desc}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-stone-400">
                    <Clock size={13} /> Coming soon
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-stone-200 bg-sand py-16">
        <Container className="flex flex-col items-center gap-5 text-center">
          <h2 className="max-w-xl text-balance font-serif text-3xl font-semibold leading-tight">
            Get the next report and guide in your inbox.
          </h2>
          {subscribed ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-clay-50 px-5 py-3 text-sm font-medium text-clay-800 ring-1 ring-clay-200">
              <Check size={16} /> Thanks. We’ll send the next finished guide your way.
            </p>
          ) : (
            <>
              <form
                className="flex w-full max-w-md items-center gap-2 rounded-full border border-stone-300 bg-white p-1 pl-4"
                onSubmit={subscribe}
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@startup.com"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
                />
                <Button variant="primary" type="submit" disabled={subStatus === 'submitting'}>
                  {subStatus === 'submitting' ? 'Subscribing…' : 'Subscribe'} <ArrowRight size={16} />
                </Button>
              </form>
              <p className="text-xs text-stone-500">
                {subStatus === 'error'
                  ? 'Something went wrong. Try again, or email help@touchstones.ai.'
                  : 'No spam. Unsubscribe anytime.'}
              </p>
            </>
          )}
        </Container>
      </section>
    </>
  )
}
