import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Pill } from '../../components/primitives.jsx'
import { Skeleton } from '../../components/states.jsx'
import { api } from '../../services/api.js'
import {
  ArrowRight,
  Check,
  Clock,
  FileText,
  Grid,
  Link as LinkIcon,
  Mail,
  ShieldCheck,
  Sparkle,
} from '../../components/icons.jsx'

const statusTone = {
  skeleton: 'amber',
  partially_live: 'clay',
  live: 'clay',
}

const defaultRoadmap = [
  { key: 'review_queue', title: 'Recruiter Review Queue', status: 'skeleton', owner_surface: '/app/mvp-buildout', next: 'Promote filters into Activity.' },
  { key: 'client_notifications', title: 'Client Review Notifications', status: 'partially_live', owner_surface: '/app/result', next: 'Resend, revoke, and comment/decision emails are live. Add reminder scheduling next.' },
  { key: 'role_templates', title: 'Role Template Library', status: 'partially_live', owner_surface: '/app/library', next: 'Seed 8 to 12 excellent templates.' },
  { key: 'jd_to_screen', title: 'JD to Screen Wizard', status: 'partially_live', owner_surface: '/app/author?tab=ai', next: 'Add review checklist before publishing.' },
  { key: 'candidate_preflight', title: 'Candidate Preflight and Reminders', status: 'partially_live', owner_surface: '/candidate', next: 'Manual deadline reminder email is live. Add preflight, extension, and scheduling.' },
  { key: 'decision_packet', title: 'One-Page Decision Packet', status: 'partially_live', owner_surface: '/app/result', next: 'Packet JSON is live. Add printable PDF or public share page next.' },
  { key: 'ashby_polish', title: 'Ashby End-to-End Polish', status: 'partially_live', owner_surface: '/app/developers', next: 'Expose partner setup and write-back checks.' },
  { key: 'mvp_analytics', title: 'MVP Analytics Dashboard', status: 'skeleton', owner_surface: '/app/insights', next: 'Read real Amplitude funnel data.' },
]

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function FeatureCard({ item }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-canvas p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
        <Pill tone={statusTone[item.status] || 'neutral'}>{item.status?.replace(/_/g, ' ') || 'planned'}</Pill>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-stone-600">{item.next}</p>
      {item.owner_surface && (
        <Link to={item.owner_surface} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-clay-700 hover:text-clay-800">
          Open surface <ArrowRight size={14} />
        </Link>
      )}
    </article>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-canvas px-4 py-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold text-ink">{value ?? 0}</p>
    </div>
  )
}

function StatusMark({ status }) {
  const ready = status === 'ready' || status === 'done'
  return ready ? <Check size={15} className="text-clay-600" /> : <Clock size={15} className="text-stone-400" />
}

function ReadinessPanel({ readiness }) {
  const items = readiness?.items || []
  const tone = readiness?.status === 'ready' ? 'clay' : readiness?.status === 'nearly_ready' ? 'amber' : 'flag'
  return (
    <section className="rounded-lg border border-stone-200 bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-ink">Launch readiness</h2>
          <p className="mt-1 text-sm text-stone-500">The minimum loop for a credible design-partner pilot.</p>
        </div>
        <Pill tone={tone}>{readiness?.status?.replace(/_/g, ' ') || 'loading'}</Pill>
      </div>
      <div className="mt-4 flex items-end gap-3">
        <span className="font-serif text-4xl font-semibold text-ink">{readiness?.score ?? 0}</span>
        <span className="pb-1 text-sm text-stone-500">of 100</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-clay-500" style={{ width: `${Math.max(0, Math.min(100, readiness?.score || 0))}%` }} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.key} className="flex items-start gap-2 rounded-lg bg-paper px-3 py-2">
            <StatusMark status={item.status} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{item.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {(readiness?.next_best_actions || []).length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase text-amber-800">Next best actions</p>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-amber-900">
            {readiness.next_best_actions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

function PilotPanel({ pilot }) {
  const stages = pilot?.stages || []
  return (
    <section className="rounded-lg border border-stone-200 bg-canvas p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">Pilot path</h2>
          <p className="mt-1 text-sm text-stone-500">One design partner, one role, one reviewed result.</p>
        </div>
        <Pill tone="clay">{pilot?.status?.replace(/_/g, ' ') || 'loading'}</Pill>
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((stage) => (
          <div key={stage.key} className="flex gap-2 rounded-lg bg-paper px-3 py-2">
            <StatusMark status={stage.status} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{stage.title}</p>
              <p className="mt-0.5 text-xs text-stone-500">{stage.evidence}</p>
            </div>
          </div>
        ))}
      </div>
      {(pilot?.next_script || []).length > 0 && (
        <div className="mt-4 border-t border-stone-200 pt-3">
          <p className="text-xs font-semibold uppercase text-stone-500">Founder script</p>
          <ol className="mt-2 space-y-1 text-sm leading-relaxed text-stone-600">
            {pilot.next_script.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>
      )}
    </section>
  )
}

export default function MvpBuildout() {
  const [roadmap, setRoadmap] = useState(defaultRoadmap)
  const [queue, setQueue] = useState({ summary: {}, rows: [] })
  const [analytics, setAnalytics] = useState({ events: [], funnel: [] })
  const [ashby, setAshby] = useState({ checklist: [] })
  const [readiness, setReadiness] = useState(null)
  const [pilot, setPilot] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState(null)
  const [actionId, setActionId] = useState('')
  const [extendMinutes, setExtendMinutes] = useState(1440)
  const [actionResult, setActionResult] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setState('loading')
      setError(null)
      try {
        const [roadmapRes, queueRes, analyticsRes, ashbyRes, readinessRes, pilotRes] = await Promise.all([
          api.getMvpRoadmap().catch((e) => ({ error: e })),
          api.getMvpReviewQueue().catch((e) => ({ error: e })),
          api.getMvpAnalytics().catch((e) => ({ error: e })),
          api.getAshbyPolishChecklist().catch((e) => ({ error: e })),
          api.getMvpReadiness().catch((e) => ({ error: e })),
          api.getMvpPilotPlan().catch((e) => ({ error: e })),
        ])
        if (!active) return
        if (roadmapRes?.roadmap) setRoadmap(roadmapRes.roadmap)
        if (queueRes?.summary) setQueue(queueRes)
        if (analyticsRes?.events) setAnalytics(analyticsRes)
        if (ashbyRes?.checklist) setAshby(ashbyRes)
        if (readinessRes?.items) setReadiness(readinessRes)
        if (pilotRes?.stages) setPilot(pilotRes)
        const firstError = [roadmapRes, queueRes, analyticsRes, ashbyRes, readinessRes, pilotRes].find((res) => res?.error)?.error
        if (firstError) setError(firstError.message || 'Some skeleton data is unavailable.')
        setState('ready')
      } catch (e) {
        if (!active) return
        setError(e.message || 'Could not load MVP skeletons.')
        setState('ready')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const summary = queue.summary || {}
  const rows = queue.rows || []
  const events = analytics.events || []
  const funnel = analytics.funnel || []
  const completedEvents = useMemo(() => events.filter((event) => event.instrumented).length, [events])

  async function runAction(kind) {
    const id = actionId.trim()
    if (!id) return
    setActionLoading(kind)
    setActionResult(null)
    try {
      const res =
        kind === 'packet'
          ? await api.getDecisionPacket(id)
          : kind === 'extend'
            ? await api.extendCandidateDeadline(id, extendMinutes)
            : await api.sendCandidateReminderSkeleton(id)
      setActionResult(res)
    } catch (e) {
      setActionResult({ error: e.message || 'Action is not available.' })
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <Container className="py-8 lg:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-clay-700">Founder buildout</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-ink">MVP skeletons</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
            A single staging surface for the eight MVP features. Some cards point to live surfaces,
            others are contract stubs ready to fill in after design-partner feedback.
          </p>
        </div>
        <Pill tone="amber">Feature flag: VITE_MVP_SKELETONS_ENABLED</Pill>
      </div>

      {error && (
        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-100">
          {error}
        </p>
      )}

      {state === 'loading' ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <section className="mt-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
              <ReadinessPanel readiness={readiness} />
              <PilotPanel pilot={pilot} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-serif text-xl font-semibold text-ink">Roadmap contracts</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {roadmap.map((item) => (
                <FeatureCard key={item.key} item={item} />
              ))}
            </div>
          </section>

          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-semibold text-ink">Recruiter review queue</h2>
                <p className="mt-1 text-sm text-stone-500">Skeleton queue data from screens, submissions, scores, and client reviews.</p>
              </div>
              <Link to="/app/activity" className="btn-ghost px-3 py-2 text-xs">
                Activity <ArrowRight size={14} />
              </Link>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Screens" value={summary.screens} />
              <Metric label="Assigned" value={summary.assigned} />
              <Metric label="Submitted" value={summary.submitted} />
              <Metric label="Scored" value={summary.scored} />
              <Metric label="Client reviews" value={summary.client_reviews} />
              <Metric label="Decisions" value={summary.client_decisions} />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-canvas">
              <div className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-stone-200 px-4 py-2 text-xs font-semibold uppercase text-stone-500">
                <span>Candidate</span>
                <span>Screen</span>
                <span>Score</span>
                <span>Client</span>
                <span>Due</span>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-stone-500">No submissions yet. The table is ready for real rows.</p>
              ) : (
                rows.slice(0, 8).map((row) => (
                  <Link
                    key={row.submission_id}
                    to={`/app/result?submission=${row.submission_id}`}
                    className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-b-0 hover:bg-paper"
                  >
                    <span className="min-w-0 truncate font-medium text-ink">{row.candidate}</span>
                    <span className="min-w-0 truncate text-stone-600">{row.screen_title}</span>
                    <span className="text-stone-600">{row.score ?? '-'}</span>
                    <span className="text-stone-600">{row.client_review_status || '-'}</span>
                    <span className="text-stone-500">{formatDate(row.deadline_at)}</span>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div>
              <h2 className="font-serif text-xl font-semibold text-ink">MVP analytics checklist</h2>
              <div className="mt-4 rounded-lg border border-stone-200 bg-canvas p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{completedEvents} of {events.length || 0} events marked instrumented</p>
                  <Pill tone="clay"><Sparkle size={13} /> Amplitude</Pill>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {events.map((event) => (
                    <div key={event.event || event} className="flex items-center justify-between rounded-lg bg-paper px-3 py-2 text-sm">
                      <span className="text-stone-700">{event.event || event}</span>
                      {event.instrumented ? <Check size={15} className="text-clay-600" /> : <Clock size={15} className="text-stone-400" />}
                    </div>
                  ))}
                </div>
                {funnel.length > 0 && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {funnel.map((step) => (
                      <Metric key={step.step} label={step.step} value={step.count} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <section className="rounded-lg border border-stone-200 bg-canvas p-4">
                <h2 className="font-serif text-lg font-semibold text-ink">Action contracts</h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-500">
                  Paste a submission id to build a packet, send a reminder, or extend the deadline.
                </p>
                <input
                  value={actionId}
                  onChange={(event) => setActionId(event.target.value)}
                  placeholder="submission uuid"
                  className="mt-3 w-full rounded-lg border border-stone-200 bg-paper px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
                />
                <select
                  value={extendMinutes}
                  onChange={(event) => setExtendMinutes(Number(event.target.value))}
                  className="mt-2 w-full rounded-lg border border-stone-200 bg-paper px-3 py-2 text-sm text-ink focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
                >
                  <option value={60}>Extend 1 hour</option>
                  <option value={240}>Extend 4 hours</option>
                  <option value={1440}>Extend 1 day</option>
                  <option value={2880}>Extend 2 days</option>
                  <option value={10080}>Extend 1 week</option>
                </select>
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={() => runAction('packet')} disabled={!actionId.trim() || actionLoading} className="btn-primary px-3 py-2 text-xs disabled:opacity-50">
                    <FileText size={14} /> {actionLoading === 'packet' ? 'Building...' : 'Build packet'}
                  </button>
                  <button type="button" onClick={() => runAction('reminder')} disabled={!actionId.trim() || actionLoading} className="btn-ghost px-3 py-2 text-xs disabled:opacity-50">
                    <Mail size={14} /> {actionLoading === 'reminder' ? 'Sending...' : 'Send reminder'}
                  </button>
                  <button type="button" onClick={() => runAction('extend')} disabled={!actionId.trim() || actionLoading} className="btn-ghost px-3 py-2 text-xs disabled:opacity-50">
                    <Clock size={14} /> {actionLoading === 'extend' ? 'Extending...' : 'Extend deadline'}
                  </button>
                </div>
                {actionResult && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">
                    {JSON.stringify(actionResult, null, 2)}
                  </pre>
                )}
              </section>

              <section className="rounded-lg border border-stone-200 bg-canvas p-4">
                <h2 className="font-serif text-lg font-semibold text-ink">Fast links</h2>
                <div className="mt-3 space-y-2">
                  <Link to="/app/author?tab=ai" className="btn-ghost w-full justify-start px-3 py-2 text-xs">
                    <Sparkle size={14} /> JD to screen
                  </Link>
                  <Link to="/app/library" className="btn-ghost w-full justify-start px-3 py-2 text-xs">
                    <Grid size={14} /> Role templates
                  </Link>
                  <Link to="/app/developers" className="btn-ghost w-full justify-start px-3 py-2 text-xs">
                    <LinkIcon size={14} /> Ashby polish
                  </Link>
                  <Link to="/app/compliance" className="btn-ghost w-full justify-start px-3 py-2 text-xs">
                    <ShieldCheck size={14} /> Decision packet source
                  </Link>
                </div>
              </section>

              <section className="rounded-lg border border-stone-200 bg-canvas p-4">
                <h2 className="font-serif text-lg font-semibold text-ink">Ashby checklist</h2>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-stone-600">
                  {(ashby.checklist || []).map((item) => (
                    <li key={item} className="flex gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-clay-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </section>
        </>
      )}
    </Container>
  )
}
