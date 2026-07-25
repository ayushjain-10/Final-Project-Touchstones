import { useEffect, useState } from 'react'
import { Container, Kicker } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import Seo from '../../components/Seo.jsx'
import { RotateCcw } from '../../components/icons.jsx'
import {
  EDITORIAL_UI_ENABLED,
  EditorialCta,
  EditorialHeading,
  EditorialHero,
} from '../../components/EditorialMarketing.jsx'

const API_URL = (import.meta.env.VITE_API_URL || 'https://touchstone-api-dev.onrender.com').replace(/\/$/, '')

// "operational" | "checking" | "degraded"
function Dot({ state }) {
  const color =
    state === 'operational' ? 'bg-clay-500' : state === 'degraded' ? 'bg-flag-500' : 'bg-stone-300'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
}

const LABEL = {
  operational: 'Operational',
  degraded: 'Investigating',
  checking: 'Checking…',
}

export default function Status() {
  const [api, setApi] = useState('checking')
  const [checkKey, setCheckKey] = useState(0)
  const [lastChecked, setLastChecked] = useState(null)

  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    setApi('checking')
    fetch(`${API_URL}/health/live`, { signal: ctrl.signal })
      .then((r) => alive && setApi(r.ok ? 'operational' : 'degraded'))
      .catch(() => alive && setApi('degraded'))
      .finally(() => {
        clearTimeout(t)
        if (alive) setLastChecked(new Date())
      })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [checkKey])

  // Website is up (you're reading this). Screening + email ride on the API.
  const rows = [
    { name: 'Website', state: 'operational' },
    { name: 'API', state: api },
    { name: 'Screening engine', state: api },
    { name: 'Email delivery', state: api === 'checking' ? 'checking' : 'operational' },
  ]
  const allUp = rows.every((r) => r.state === 'operational')
  const anyDown = rows.some((r) => r.state === 'degraded')

  if (EDITORIAL_UI_ENABLED) {
    const verifiedRows = [
      { name: 'Marketing website', detail: 'Available in this browser session', state: 'operational' },
      { name: 'Application API', detail: `${API_URL}/health/live`, state: api },
    ]
    const headline =
      api === 'checking'
        ? 'Checking the application API.'
        : api === 'operational'
          ? 'The checked systems are responding.'
          : 'The application API needs attention.'

    return (
      <>
        <Seo
          title="Status"
          description="Live operational status for the Touchstones website and application API."
        />
        <EditorialHero
          eyebrow="Status / live check"
          title={headline}
          lede="This page performs a lightweight request against the application health endpoint and reports only what it can observe directly."
          noteLabel="Current check"
          note={
            api === 'checking'
              ? 'Waiting for the health endpoint to respond.'
              : api === 'operational'
                ? 'The API returned a successful health response.'
                : 'The health request failed, timed out, or returned a non-success response.'
          }
        >
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/15 pt-5">
            <span className="text-xs text-stone-400">
              {lastChecked
                ? `Checked ${lastChecked.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : 'Check in progress'}
            </span>
            <span className="inline-flex items-center gap-2 text-xs text-stone-300">
              <Dot state={api} /> {LABEL[api]}
            </span>
          </div>
        </EditorialHero>

        <section className="border-b border-stone-200 py-16 sm:py-24">
          <Container className="grid gap-12 lg:grid-cols-[0.62fr_1fr]">
            <Reveal>
              <EditorialHeading
                eyebrow="System register"
                title="A small status page should make small claims."
                lede="Website availability is visible from this page. The API row comes from the live health request."
              />
              <Button
                type="button"
                variant="ghost"
                className="mt-7"
                onClick={() => setCheckKey((value) => value + 1)}
                disabled={api === 'checking'}
              >
                <RotateCcw size={16} /> {api === 'checking' ? 'Checking…' : 'Check again'}
              </Button>
            </Reveal>

            <Reveal delay={100}>
              <div className="border border-stone-200 bg-white shadow-card">
                <div className="border-b border-stone-200 px-5 py-4 sm:px-7">
                  <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-700">
                    Live systems
                  </p>
                </div>
                <div className="divide-y divide-stone-200">
                  {verifiedRows.map((row) => (
                    <div key={row.name} className="grid gap-3 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-7">
                      <div>
                        <p className="font-semibold text-ink">{row.name}</p>
                        <p className="mt-1 break-all font-mono text-xs text-stone-400">{row.detail}</p>
                      </div>
                      <span className="inline-flex items-center gap-2 text-sm text-stone-600">
                        <Dot state={row.state} /> {LABEL[row.state]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </Container>
        </section>

        <section className="bg-evidence-light py-16 sm:py-20">
          <Container>
            <div className="grid border-y border-stone-200 lg:grid-cols-2">
              <Reveal className="py-6 lg:border-r lg:border-stone-200 lg:pr-10">
                <p className="font-serif text-xl font-semibold">What this check covers</p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  Whether the website rendered for you and whether the configured API health endpoint returned a successful response within eight seconds.
                </p>
              </Reveal>
              <Reveal delay={80} className="border-t border-stone-200 py-6 lg:border-t-0 lg:pl-10">
                <p className="font-serif text-xl font-semibold">What it does not prove</p>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  Historical uptime, third-party email delivery, every screening workflow, or the health of a specific customer workspace.
                </p>
              </Reveal>
            </div>
          </Container>
        </section>

        <EditorialCta
          eyebrow="Seeing a problem?"
          title="Report the route, time, and what you expected to happen."
          body="That context helps us investigate faster during early access."
          primary={{ label: 'Email help@touchstones.ai', href: 'mailto:help@touchstones.ai' }}
          secondary={{ label: 'Return home', to: '/' }}
        />
      </>
    )
  }

  return (
    <>
      <Seo
        title="Status"
        description="Live operational status for the Touchstones website, API, screening engine, and email delivery."
      />
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-16">
          <Reveal>
            <Kicker className="mb-5">Status</Kicker>
            <h1 className="max-w-2xl text-balance font-serif text-4xl font-semibold leading-[1.08] sm:text-5xl">
              {anyDown ? 'Some systems are degraded' : allUp ? 'All systems operational' : 'Checking systems…'}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600">
              A live snapshot of the Touchstones platform. Seeing something we're not? Email{' '}
              <a href="mailto:help@touchstones.ai" className="font-medium text-clay-700 underline">
                help@touchstones.ai
              </a>
              .
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-2xl">
          <div className="overflow-hidden rounded-2xl border border-stone-200">
            {rows.map((r, i) => (
              <div
                key={r.name}
                className={`flex items-center justify-between px-5 py-4 ${i > 0 ? 'border-t border-stone-200' : ''}`}
              >
                <span className="font-medium text-ink">{r.name}</span>
                <span className="inline-flex items-center gap-2 text-sm text-stone-600">
                  <Dot state={r.state} /> {LABEL[r.state]}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-stone-400">
            Live check against our API health endpoint. This is a lightweight status view, not an
            historical uptime log.
          </p>
        </Container>
      </section>
    </>
  )
}
