import { Container, Kicker, SectionHeading, Stat } from '../../components/primitives.jsx'
import Button from '../../components/Button.jsx'
import Reveal from '../../components/Reveal.jsx'
import {
  ShieldCheck, Fingerprint, Bolt, Code, FileText, Lock, Check, ArrowRight, Sparkle,
} from '../../components/icons.jsx'

const mono = 'font-mono text-[13px]'

const pillars = [
  {
    icon: Fingerprint,
    title: 'Proof-of-human',
    body: 'Server-observed integrity signals surface paste-throughs and automated/bot sessions and record how AI was used. Those in-session integrity events are sealed in a tamper-evident SHA-256 hash chain. No biometrics: no face scans, no identity matching, no emotion inference.',
  },
  {
    icon: Sparkle,
    title: 'Defensible scoring',
    body: 'The same engine that powers Touchstones grades each submission against your rubric in code: reproducible by record, explainable, audit-logged.',
  },
  {
    icon: ShieldCheck,
    title: 'Portable credential',
    body: 'Every verification mints a shareable report and an immutable audit record your customers can independently verify.',
  },
]

const features = [
  { icon: Bolt, title: 'One POST, one Verification', body: 'Send the candidate’s work, optional behavior events, and an AI transcript. Get back a proof-of-human state, a score, and a report URL.' },
  { icon: Lock, title: 'Strict per-key tenancy', body: 'Every key maps to one account; data is row-level isolated. We store only a SHA-256 of your keys, never the plaintext.' },
  { icon: Code, title: 'Test & live modes', body: 'Iterate against the sandbox with tsk_test_ keys, then flip to tsk_live_. Same shapes, no surprises.' },
  { icon: FileText, title: 'Signed webhooks', body: 'Receive verification.completed events signed with HMAC-SHA256, retried with backoff. Reconcile asynchronously.' },
]

const steps = [
  { n: '01', t: 'Create a key', d: 'Mint a test key in the developer console.' },
  { n: '02', t: 'POST a verification', d: 'Send work + a rubric to /v1/verifications.' },
  { n: '03', t: 'Read the result', d: 'Get proof-of-human, a score, and a report URL, or a webhook.' },
]

const SNIPPET = `curl https://api.touchstones.ai/v1/verifications \\
  -H "Authorization: Bearer tsk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "candidate_ref": "cand-001",
    "rubric": { "criteria": [
      { "id": "correctness",
        "requirement": "Implements add(a,b)",
        "points_possible": 100 } ] },
    "work": { "response_code": "module.exports=(a,b)=>a+b;" }
  }'`

const RESPONSE = `{
  "id": "ef14…f4a1",
  "status": "completed",
  "proof_of_human": { "state": "verified", "verified_chain": true },
  "score": { "score": 100, "outcome": "advance" },
  "audit_url": "https://api.touchstones.ai/v1/…/audit",
  "report_url": "https://touchstones.ai/verify/…"
}`

export default function Platforms() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20">
          <Reveal>
            <Kicker className="mb-5">Touchstones for platforms</Kicker>
            <h1 className="max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              The trust layer for your assessment platform, as an API.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              Embed proof-of-human and defensible, audit-logged scoring into your own product. One
              call turns a candidate’s work into a verification your customers can trust: no
              biometrics, no black boxes.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button to="/app/developers">Get an API key <ArrowRight size={16} /></Button>
              <Button variant="ghost" to="/docs/api">Read the docs</Button>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Code preview */}
      <section className="border-b border-stone-200 py-16">
        <Container>
          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal>
              <div className="overflow-hidden rounded-2xl border border-stone-200 bg-ink/95">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-clay-400" />
                  <span className="text-xs font-medium text-stone-400">Request</span>
                </div>
                <pre className={`${mono} overflow-auto p-4 text-stone-100`}>{SNIPPET}</pre>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-clay-500" />
                  <span className="text-xs font-medium text-stone-500">Verification</span>
                </div>
                <pre className={`${mono} overflow-auto p-4 text-stone-700`}>{RESPONSE}</pre>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Pillars */}
      <section className="py-20">
        <Container>
          <SectionHeading
            kicker="What you embed"
            title="Three signals, one verification"
            lede="The Verify API reuses the exact engine behind Touchstones: you get our integrity and scoring without rebuilding any of it."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {pillars.map((p, i) => (
              <Reveal key={p.title} delay={i * 70}>
                <div className="card h-full p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                    <p.icon size={20} />
                  </span>
                  <h3 className="mt-4 font-serif text-xl font-semibold text-ink">{p.title}</h3>
                  <p className="mt-2 leading-relaxed text-stone-600">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Features grid */}
      <section className="border-y border-stone-200 bg-canvas/60 py-20">
        <Container>
          <SectionHeading kicker="Built for builders" title="Production-ready from the first call" />
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 60}>
                <div className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-clay-600 ring-1 ring-stone-200">
                    <f.icon size={18} />
                  </span>
                  <div>
                    <h3 className="font-semibold text-ink">{f.title}</h3>
                    <p className="mt-1 leading-relaxed text-stone-600">{f.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section className="py-20">
        <Container>
          <SectionHeading kicker="Integrate in an afternoon" title="From key to verification in three steps" align="center" />
          <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 70}>
                <div className="text-center">
                  <div className="font-mono text-sm font-semibold text-clay-600">{s.n}</div>
                  <h3 className="mt-2 font-serif text-lg font-semibold text-ink">{s.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Stats / trust */}
      <section className="border-t border-stone-200 bg-grain py-20">
        <Container>
          <div className="grid gap-10 sm:grid-cols-3">
            <Stat value="< 1 call" label="to verify a candidate end-to-end" tone="clay" />
            <Stat value="SHA-256" label="hash-chained audit record per verification" />
            <Stat value="0" label="biometric data collected, ever" tone="clay" />
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="py-20">
        <Container>
          <div className="card mx-auto max-w-3xl p-10 text-center">
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink">
              Ship trust, don’t rebuild it.
            </h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-stone-600">
              Get a test key, send your first verification today, and talk to us about volume pricing
              when you’re ready to go live.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button to="/app/developers">Get an API key <ArrowRight size={16} /></Button>
              <Button variant="ghost" href="mailto:help@touchstones.ai">Talk to us</Button>
            </div>
            <ul className="mx-auto mt-8 flex max-w-md flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-stone-500">
              {['Test mode free', 'No biometrics', 'Audit-logged', 'Signed webhooks'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><Check size={14} className="text-clay-600" /> {t}</li>
              ))}
            </ul>
          </div>
        </Container>
      </section>
    </>
  )
}
