import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Pill, Stat } from '../../components/primitives.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import Reveal from '../../components/Reveal.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient.js'
import { api } from '../../services/api.js'
import { Skeleton, ErrorState, WakingNote } from '../../components/states.jsx'
import { useSlowLoading } from '../../hooks/useSlowLoading.js'
import EvidenceLedger from './EvidenceLedger.jsx'
import {
  Plus,
  ArrowRight,
  ArrowUpRight,
  Sparkle,
  FileText,
  Check,
  Lock,
  Grid,
  Link as LinkIcon,
  X,
} from '../../components/icons.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Static demo rows — shown when Supabase isn't configured so the route is never
// empty in preview/marketing mode.
const sampleRows = [
  { key: 'sample-maya', submissionId: 'sample-maya', workSampleId: 'sample-payments', id: 'Maya C.', role: 'Senior Backend Engineer', task: 'Debug a failing payments service', score: 92, state: 'verified', scored: true, when: '2h ago' },
  { key: 'sample-jonah', submissionId: 'sample-jonah', workSampleId: 'sample-webhook', id: 'Jonah R.', role: 'Full-stack Engineer', task: 'Add an idempotent webhook endpoint', score: 78, state: 'verified', scored: true, when: '5h ago' },
  { key: 'sample-alex', submissionId: 'sample-alex', workSampleId: 'sample-checkout', id: 'Alex T.', role: 'Frontend Engineer', task: 'Fix a flaky checkout component', score: 64, state: 'review', scored: true, when: 'Yesterday' },
  { key: 'sample-sam', submissionId: 'sample-sam', workSampleId: 'sample-race', id: 'Sam N.', role: 'Backend Engineer', task: 'Reproduce and fix a race condition', score: 41, state: 'flagged', scored: true, when: 'Yesterday' },
  { key: 'sample-priya', submissionId: 'sample-priya', workSampleId: 'sample-pipeline', id: 'Priya S.', role: 'Data Engineer', task: 'Find the bug in a revenue pipeline', score: 88, state: 'verified', scored: true, when: '2 days ago' },
]

const sampleAssessments = [
  { id: 'sample-payments', title: 'Payments service incident', role: 'Backend', submissions: 8, scored: 7, topScore: 92, when: 'Today' },
  { id: 'sample-webhook', title: 'Webhook reliability', role: 'Full-stack', submissions: 6, scored: 5, topScore: 86, when: 'Today' },
  { id: 'sample-checkout', title: 'Checkout regression', role: 'Frontend', submissions: 5, scored: 5, topScore: 81, when: 'Yesterday' },
  { id: 'sample-race', title: 'Concurrency diagnosis', role: 'Backend', submissions: 4, scored: 3, topScore: 79, when: 'Yesterday' },
  { id: 'sample-pipeline', title: 'Revenue pipeline audit', role: 'Data', submissions: 7, scored: 6, topScore: 88, when: '2 days ago' },
]

function scoreTone(s) {
  return s >= 75 ? 'text-clay-600' : s >= 50 ? 'text-amber-700' : 'text-flag-500'
}

// Small score chip — uses the same band colours as ScoreRing/CriterionBar.
function ScoreChip({ score }) {
  if (typeof score !== 'number') {
    return <span className="text-sm font-normal text-stone-400">—</span>
  }
  const ring =
    score >= 75 ? 'border-clay-200 bg-clay-50' : score >= 50 ? 'border-amber-100 bg-amber-50' : 'border-flag-100 bg-flag-50'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${ring}`}>
      <span className={`font-serif text-sm font-semibold tabular-nums ${scoreTone(score)}`}>{score}</span>
      <span className="text-[0.65rem] text-stone-400">/100</span>
    </span>
  )
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

const STATUS_STATE = { scored: 'verified', submitted: 'review', assigned: 'review' }

// The three outcome labels we surface inline (notes/advanced live in the result view).
const OUTCOME_LABELS = [
  { key: 'got_offer', short: 'Offer' },
  { key: 'hired', short: 'Hired' },
  { key: 'retained_90d', short: '90d' },
]

// --- AI-direction chip: lazily fetches the latest direction score per submission ---
function DirectionChip({ submissionId }) {
  const [state, setState] = useState('idle') // idle | loading | done | none
  const [score, setScore] = useState(null)

  useEffect(() => {
    let active = true
    setState('loading')
    api
      .getDirection(submissionId)
      .then((d) => {
        if (!active) return
        const v = Number(d?.direction_score)
        if (Number.isFinite(v)) {
          setScore(Math.round(v))
          setState('done')
        } else {
          setState('none')
        }
      })
      .catch(() => active && setState('none'))
    return () => {
      active = false
    }
  }, [submissionId])

  if (state !== 'done') return null
  return (
    <Pill tone="clay" className="font-mono">
      <Sparkle size={12} /> AI {score}
    </Pill>
  )
}

// --- Outcome labeling: a tiny inline control to set offer/hire/90d-retention ---
function OutcomeControl({ submissionId, initial, onSaved }) {
  const [labels, setLabels] = useState(initial || {})
  const [saving, setSaving] = useState(null) // the key currently saving
  const [err, setErr] = useState(false)

  async function toggle(key) {
    // tri-state cycle: unknown(null) -> true -> false -> unknown
    const cur = labels[key]
    const next = cur === true ? false : cur === false ? null : true
    const optimistic = { ...labels, [key]: next }
    setLabels(optimistic)
    setSaving(key)
    setErr(false)
    try {
      const saved = await api.setOutcome(submissionId, optimistic)
      onSaved?.(saved)
    } catch {
      setLabels(labels) // revert
      setErr(true)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OUTCOME_LABELS.map((o) => {
        const v = labels[o.key]
        const on = v === true
        const no = v === false
        const busy = saving === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              toggle(o.key)
            }}
            disabled={busy}
            aria-pressed={on}
            title={`${o.short}: ${on ? 'yes' : no ? 'no' : 'unknown'} — click to cycle`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'border-clay-300 bg-clay-50 text-clay-700'
                : no
                  ? 'border-stone-200 bg-stone-100 text-stone-400 line-through'
                  : 'border-dashed border-stone-300 bg-white text-stone-500 hover:border-stone-400'
            }`}
          >
            {on && <Check size={11} />}
            {o.short}
          </button>
        )
      })}
      {err && <span className="text-[0.7rem] text-flag-700">save failed</span>}
    </div>
  )
}

// --- First-run onboarding: a friendly, dismissible "create your first screen"
// checklist that points at the EXISTING flow (Library template → Use as a screen
// → copy link / invite → sample result). Light by design — no wizard. ---
const ONBOARD_DISMISS_KEY = 'ts_onboard_dismissed'

const ONBOARD_STEPS = [
  {
    n: 1,
    title: 'Pick a Library template',
    body: 'Start from a real-work task for the role — backend, frontend, data, and more. You can edit everything.',
    to: '/app/library',
    cta: 'Open the Library',
    icon: Grid,
  },
  {
    n: 2,
    title: '“Use as a screen”',
    body: 'One click turns a template into a live candidate screen and a shareable link — no setup.',
    to: '/app/library',
    cta: 'Browse templates',
    icon: FileText,
  },
  {
    n: 3,
    title: 'Copy the link or invite by email',
    body: 'Send it to a candidate. It opens pre-loaded in the in-browser editor with the AI assistant.',
    to: '/app/library',
    cta: 'Create & share',
    icon: LinkIcon,
  },
  {
    n: 4,
    title: 'See a sample result',
    body: 'Preview a fully scored, audit-ready result card before your first real submission lands.',
    to: '/app/result',
    cta: 'View sample result',
    icon: Sparkle,
  },
]

function OnboardingCard({ onDismiss }) {
  return (
    <Reveal className="mt-8 overflow-hidden rounded-2xl border border-clay-200 bg-clay-50">
      <div className="flex items-start justify-between gap-4 border-b border-clay-200/70 px-5 py-4 sm:px-6">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-clay-700">
            <Sparkle size={14} /> Get started
          </span>
          <h2 className="mt-1.5 font-serif text-xl font-semibold text-ink">
            Create your first screen
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-clay-800">
            Four short steps to a sent screen — under ten minutes, start to finish. Pick a template,
            send the link, and watch the first scored result land right here.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-clay-600 transition-colors hover:bg-clay-100 hover:text-clay-800"
          aria-label="Dismiss getting started"
        >
          <X size={16} />
        </button>
      </div>

      <ol className="grid gap-px bg-clay-200/60 sm:grid-cols-2">
        {ONBOARD_STEPS.map((s) => {
          const Icon = s.icon
          return (
            <li key={s.n} className="bg-clay-50 px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Icon size={14} className="text-clay-600" /> {s.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">{s.body}</p>
                  <Link
                    to={s.to}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
                  >
                    {s.cta} <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3 border-t border-clay-200/70 px-5 py-4 sm:px-6">
        <Link to="/app/library" className="btn-primary">
          <Plus size={16} /> Start in the Library
        </Link>
        <Link
          to="/app/result"
          className="inline-flex items-center gap-1 text-sm font-semibold text-clay-700 hover:text-clay-800"
        >
          Or peek at a sample result <ArrowUpRight size={14} />
        </Link>
      </div>
    </Reveal>
  )
}

export default function Dashboard() {
  const { configured, user } = useAuth()
  const [rows, setRows] = useState(null) // null = not loaded; [] = empty
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(null) // work_sample id
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  // Onboarding card is dismissible and stays dismissed (per browser).
  const [onboardDismissed, setOnboardDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(ONBOARD_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  function dismissOnboarding() {
    setOnboardDismissed(true)
    try {
      window.localStorage.setItem(ONBOARD_DISMISS_KEY, '1')
    } catch {
      /* storage unavailable — dismiss for this session only */
    }
  }

  // Cold-start resilience: keep loading (so the "waking…" hint stays up) and
  // auto-retry transient failures a few times before surfacing a real error.
  const attemptRef = useRef(0)
  const retryTimer = useRef(null)
  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !user) return
    setLoading(true)
    setError(null)
    try {
      // RLS scopes these to the signed-in recruiter (owner_id = auth.uid()).
      const { data: samples, error: e1 } = await supabase
        .from('work_samples')
        .select('id, title, role_family, created_at')
        .neq('status', 'archived') // archived = the app's delete semantics; keep them out of the list
        .order('created_at', { ascending: false })
        .limit(50)
      if (e1) throw e1

      const ids = (samples || []).map((s) => s.id)
      let subs = []
      if (ids.length) {
        const { data: subData, error: e2 } = await supabase
          .from('work_sample_submissions')
          .select('id, work_sample_id, candidate_id, status, submitted_at, created_at')
          .in('work_sample_id', ids)
          .order('created_at', { ascending: false })
        if (e2) throw e2
        subs = subData || []
      }

      // Latest score per submission (RLS-scoped).
      const subIds = subs.map((s) => s.id)
      const scoreBySub = {}
      if (subIds.length) {
        const { data: scoreData } = await supabase
          .from('proof_scores')
          .select('id, submission_id, normalized_score, outcome, created_at')
          .in('submission_id', subIds)
          .order('created_at', { ascending: false })
        for (const sc of scoreData || []) {
          if (!scoreBySub[sc.submission_id]) scoreBySub[sc.submission_id] = sc
        }
      }

      // Recorded outcome labels per submission (RLS-scoped).
      const outcomeBySub = {}
      if (subIds.length) {
        const { data: outcomeData } = await supabase
          .from('submission_outcomes')
          .select('submission_id, advanced, got_offer, hired, retained_90d')
          .in('submission_id', subIds)
        for (const o of outcomeData || []) outcomeBySub[o.submission_id] = o
      }

      const byWs = Object.fromEntries((samples || []).map((s) => [s.id, s]))
      const merged = subs.map((sub) => {
        const ws = byWs[sub.work_sample_id] || {}
        const sc = scoreBySub[sub.id]
        const score = sc ? Number(sc.normalized_score) : null
        return {
          key: sub.id,
          scoreId: sc?.id || null,
          submissionId: sub.id,
          workSampleId: sub.work_sample_id,
          id: String(sub.candidate_id || sub.id).slice(0, 4).toUpperCase(),
          role: ws.role_family || '—',
          task: ws.title || 'Work sample',
          score,
          outcome: sc?.outcome || null,
          state: STATUS_STATE[sub.status] || 'review',
          when: relativeTime(sub.submitted_at || sub.created_at),
          labels: outcomeBySub[sub.id] || null,
          scored: typeof score === 'number',
        }
      })

      // If a recruiter has authored samples but no submissions yet, surface them too.
      const assignedWsIds = new Set(subs.map((s) => s.work_sample_id))
      const bareSamples = (samples || [])
        .filter((s) => !assignedWsIds.has(s.id))
        .map((s) => ({
          key: s.id,
          scoreId: null,
          submissionId: null,
          workSampleId: s.id,
          id: String(s.id).slice(0, 4).toUpperCase(),
          role: s.role_family || '—',
          task: s.title || 'Work sample',
          score: null,
          state: 'review',
          when: relativeTime(s.created_at),
          awaiting: true,
        }))

      // Per-assessment rollup: # submissions and the latest (highest) score.
      const subsByWs = {}
      for (const sub of subs) (subsByWs[sub.work_sample_id] ||= []).push(sub)
      const assessmentCards = (samples || []).map((s) => {
        const list = subsByWs[s.id] || []
        const scores = list
          .map((sub) => scoreBySub[sub.id])
          .filter(Boolean)
          .map((sc) => Number(sc.normalized_score))
          .filter((n) => Number.isFinite(n))
        return {
          id: s.id,
          title: s.title || 'Work sample',
          role: s.role_family || '—',
          submissions: list.length,
          scored: scores.length,
          topScore: scores.length ? Math.max(...scores) : null,
          when: relativeTime(s.created_at),
        }
      })

      attemptRef.current = 0
      setRows([...merged, ...bareSamples])
      setAssessments(assessmentCards)
      setLoading(false)
    } catch (e) {
      const transient = !e?.status || e.status >= 500 || e.status === 429
      if (transient && attemptRef.current < 3) {
        attemptRef.current += 1
        retryTimer.current = setTimeout(() => load(), 3000)
      } else {
        attemptRef.current = 0
        setError(e.message || 'Could not load your screens.')
        setLoading(false)
      }
    }
  }, [user])

  useEffect(() => {
    load()
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [load])

  // Delete a screen (work_sample) with optimistic removal + rollback on failure.
  async function handleDeleteScreen(id) {
    setConfirmingDelete(null)
    setDeletingId(id)
    setDeleteError(null)
    const prevAssessments = assessments
    const prevRows = rows
    setAssessments((a) => a.filter((x) => x.id !== id))
    setRows((r) => (r ? r.filter((x) => x.workSampleId !== id) : r))
    try {
      await api.deleteWorkSample(id)
    } catch (e) {
      setAssessments(prevAssessments)
      setRows(prevRows)
      setDeleteError(
        e?.status === 404
          ? 'Deleting screens isn’t available yet — it lights up after the next deploy.'
          : e?.message || 'Could not delete the screen.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  // After ~6s of an unresolved initial load, tell the user the dev backend is waking.
  const slow = useSlowLoading(loading && !rows)

  // Live data when signed in; otherwise the demo rows.
  const live = configured && user
  const displayRows = live ? rows || [] : sampleRows

  // Has this recruiter created anything yet? Drives onboarding + empty states.
  const hasAnyData = !live || assessments.length > 0 || displayRows.length > 0

  // ONE honest headline line computed from the REAL loaded data — never invented.
  // "N screens · X flagged · Y advanced". Counts are RLS-scoped to this recruiter.
  const headline = useMemo(() => {
    const screens = assessments.length
    // Only real submissions can be flagged — not authored-but-unsent screens.
    const flagged = displayRows.filter(
      (r) => r.submissionId && (r.state === 'flagged' || r.state === 'review'),
    ).length
    const advanced = displayRows.filter((r) => r.labels?.advanced === true).length
    return { screens, flagged, advanced }
  }, [assessments.length, displayRows])

  if (EDITORIAL_UI_ENABLED && (!isSupabaseConfigured || !user)) {
    return (
      <EvidenceLedger
        rows={sampleRows}
        assessments={sampleAssessments}
        live={false}
        confirmingDelete={confirmingDelete}
        deletingId={deletingId}
        deleteError={deleteError}
        onRequestDelete={(id) => {
          setDeleteError(null)
          setConfirmingDelete(id)
        }}
        onCancelDelete={() => setConfirmingDelete(null)}
        onConfirmDelete={handleDeleteScreen}
      />
    )
  }

  // --- Signed-out / unconfigured: a graceful prompt instead of an empty page ---
  if (!isSupabaseConfigured || !user) {
    return (
      <Container className="py-8 lg:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Overview</h1>
            <p className="mt-2 text-stone-600">
              A preview of your recruiter dashboard. Sign in to load your real screens.
            </p>
          </div>
          <Link to="/app/author" className="btn-primary">
            <Plus size={16} /> New screen
          </Link>
        </div>

        <Reveal className="mt-8 rounded-2xl border border-stone-200 bg-canvas/60 p-6">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <Lock size={16} className="text-clay-500" />{' '}
            {isSupabaseConfigured ? 'Sign in to see your data' : 'Preview mode'}
          </span>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-500">
            {isSupabaseConfigured
              ? 'Sign in and your authored assessments, candidate submissions, scores, and calibration will appear here.'
              : 'Connect Supabase (VITE_SUPABASE_URL / ANON_KEY) and sign in to load real assessments, submissions, and calibration. Sample data below.'}
          </p>
          {isSupabaseConfigured && (
            <Link to="/login" className="btn-primary mt-4 inline-flex">
              Sign in <ArrowRight size={16} />
            </Link>
          )}
        </Reveal>

        {/* Demo stats + rows so the route is never blank in preview mode. */}
        <Reveal className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 sm:grid-cols-4">
          {[
            { value: String(sampleRows.length), label: 'Verified screens run' },
            { value: '1', label: 'Flagged or needs review', tone: 'clay' },
            { value: '78', label: 'Median score' },
            { value: '11h', label: 'Onsite hours saved' },
          ].map((s) => (
            <div key={s.label} className="bg-canvas px-5 py-6">
              <Stat value={s.value} label={s.label} tone={s.tone} />
            </div>
          ))}
        </Reveal>

        <Reveal delay={80} className="mt-8 card overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-5 py-4">
            <h2 className="font-serif text-lg font-semibold text-ink">Sample results</h2>
            <Link
              to="/app/result"
              className="inline-flex items-center gap-1 text-sm font-medium text-clay-700 hover:text-clay-800"
            >
              View sample <ArrowRight size={14} />
            </Link>
          </div>
          <ul className="divide-y divide-stone-200">
            {sampleRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{r.task}</span>
                  <span className="block truncate text-xs text-stone-500">{r.role}</span>
                </div>
                <ScoreChip score={r.score} />
                <VerifiedBadge state={r.state} size="sm" />
                <span className="hidden text-right text-xs text-stone-400 sm:inline">{r.when}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    )
  }

  if (EDITORIAL_UI_ENABLED) {
    return (
      <>
        {slow && (
          <div className="mx-auto w-full max-w-[1480px] px-4 pt-6 sm:px-6 lg:px-8">
            <WakingNote />
          </div>
        )}
        {error && (
          <div className="mx-auto w-full max-w-[1480px] px-4 pt-6 sm:px-6 lg:px-8">
            <ErrorState title="Couldn’t load your workspace" message={error} onRetry={load} />
          </div>
        )}
        <EvidenceLedger
          rows={displayRows}
          assessments={assessments}
          loading={loading}
          live={live}
          confirmingDelete={confirmingDelete}
          deletingId={deletingId}
          deleteError={deleteError}
          onRequestDelete={(id) => {
            setDeleteError(null)
            setConfirmingDelete(id)
          }}
          onCancelDelete={() => setConfirmingDelete(null)}
          onConfirmDelete={handleDeleteScreen}
          OutcomeComponent={OutcomeControl}
        />
      </>
    )
  }

  return (
    <Container className="py-8 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Overview</h1>
          <p className="mt-2 text-stone-600">
            Every advanced candidate is a real person who can do the work — and you can prove how you
            decided.
          </p>
        </div>
        <Link to="/app/author" className="btn-primary">
          <Plus size={16} /> New screen
        </Link>
      </div>

      {slow && <WakingNote className="mt-8" />}

      {/* First-run onboarding — only when the recruiter genuinely has nothing
          yet (not when a load merely failed), so it never tells an existing
          recruiter to "create your first screen" after a transient error. */}
      {!hasAnyData && !loading && !error && !onboardDismissed && (
        <OnboardingCard onDismiss={dismissOnboarding} />
      )}

      {error && (
        <ErrorState
          className="mt-8"
          title="Couldn’t load your overview"
          message={error}
          onRetry={load}
        />
      )}

      {/* ONE honest headline line, computed from REAL loaded data. Shown only
          when there's something to count — never a row of fabricated zeros. */}
      {loading && !rows ? (
        <Skeleton className="mt-8 h-6 w-72" />
      ) : !error && hasAnyData ? (
        <Reveal className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600">
          <span>
            <span className="font-serif text-lg font-semibold tabular-nums text-ink">
              {headline.screens}
            </span>{' '}
            {headline.screens === 1 ? 'screen' : 'screens'}
          </span>
          <span className="text-stone-300">·</span>
          <span>
            <span className="font-serif text-lg font-semibold tabular-nums text-clay-600">
              {headline.flagged}
            </span>{' '}
            flagged
          </span>
          <span className="text-stone-300">·</span>
          <span>
            <span className="font-serif text-lg font-semibold tabular-nums text-ink">
              {headline.advanced}
            </span>{' '}
            advanced
          </span>
        </Reveal>
      ) : null}

      {/* Assessments */}
      <Reveal delay={60} className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Your screens</h2>
          <Link
            to="/app/author"
            className="inline-flex items-center gap-1 text-sm font-medium text-clay-700 hover:text-clay-800"
          >
            New <Plus size={14} />
          </Link>
        </div>
        {loading && !assessments.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : assessments.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-canvas/40 px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">No assessments yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Author your first verified real-work screen and share the link with a candidate.
            </p>
            <Link to="/app/author" className="btn-primary mt-5 inline-flex">
              <Plus size={16} /> Author your first screen
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assessments.map((a) => (
              <div key={a.id} className="card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-serif text-base font-semibold text-ink">{a.title}</h3>
                    <p className="truncate text-xs text-stone-500">{a.role}</p>
                  </div>
                  {typeof a.topScore === 'number' ? <ScoreChip score={a.topScore} /> : null}
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 text-xs text-stone-500">
                  <span>
                    <span className="font-semibold tabular-nums text-ink">{a.submissions}</span>{' '}
                    {a.submissions === 1 ? 'submission' : 'submissions'}
                    {a.scored ? ` · ${a.scored} scored` : ''}
                  </span>
                  {confirmingDelete === a.id ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-stone-400">Delete?</span>
                      <button
                        onClick={() => handleDeleteScreen(a.id)}
                        disabled={deletingId === a.id}
                        className="font-semibold text-flag-700 hover:opacity-80 disabled:opacity-50"
                      >
                        {deletingId === a.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button onClick={() => setConfirmingDelete(null)} className="text-stone-400 hover:text-ink">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-3">
                      <span className="text-stone-400">{a.when}</span>
                      <button
                        onClick={() => {
                          setDeleteError(null)
                          setConfirmingDelete(a.id)
                        }}
                        className="text-stone-300 transition-colors hover:text-flag-700"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {deleteError && <p className="mt-3 text-xs text-flag-700">{deleteError}</p>}
      </Reveal>

      {/* Submissions */}
      <Reveal delay={80} className="mt-8 card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-5 py-4">
          <h2 className="font-serif text-lg font-semibold text-ink">Submissions</h2>
          <Link
            to="/app/result"
            className="inline-flex items-center gap-1 text-sm font-medium text-clay-700 hover:text-clay-800"
          >
            View sample <ArrowRight size={14} />
          </Link>
        </div>

        <div className="hidden grid-cols-[5rem_1fr_7rem_9rem_8rem] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-stone-400 md:grid">
          <span>Candidate</span>
          <span>Real-work task</span>
          <span>Score</span>
          <span>Session record</span>
          <span>Outcome</span>
        </div>

        {loading && !rows ? (
          <div className="divide-y divide-stone-200">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-6 w-14" />
                <Skeleton className="hidden h-5 w-24 md:block" />
              </div>
            ))}
          </div>
        ) : displayRows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium text-ink">No submissions yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Share an assessment link with a candidate — their submission and score will appear here.
            </p>
            <Link to="/app/author" className="btn-primary mt-5 inline-flex">
              <Plus size={16} /> New screen
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-stone-200">
            {displayRows.map((r) => {
              const to = r.scoreId
                ? `/app/result?score=${r.scoreId}${r.submissionId ? `&submission=${r.submissionId}` : ''}`
                : '/app/result'
              return (
                <li
                  key={r.key || r.id}
                  className="grid grid-cols-2 items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-stone-50 md:grid-cols-[5rem_1fr_7rem_9rem_8rem]"
                >
                  <Link to={to} className="font-mono text-sm text-stone-500 hover:text-ink">
                    {r.id}
                  </Link>
                  <Link
                    to={to}
                    className="order-last col-span-2 min-w-0 md:order-none md:col-span-1"
                  >
                    <span className="block truncate text-sm font-medium text-ink">{r.task}</span>
                    <span className="flex items-center gap-2 truncate text-xs text-stone-500">
                      {r.role}
                      {r.submissionId && r.scored ? <DirectionChip submissionId={r.submissionId} /> : null}
                    </span>
                  </Link>
                  <Link to={to} className="justify-self-start">
                    {typeof r.score === 'number' ? (
                      <ScoreChip score={r.score} />
                    ) : (
                      <span className="text-sm font-normal text-stone-400">
                        {r.awaiting ? 'Awaiting' : 'Pending'}
                      </span>
                    )}
                  </Link>
                  <span className="justify-self-start">
                    <VerifiedBadge state={r.state} size="sm" />
                  </span>
                  <span className="justify-self-start">
                    {r.submissionId && r.scored ? (
                      <OutcomeControl submissionId={r.submissionId} initial={r.labels} />
                    ) : (
                      <span className="text-xs text-stone-300">—</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Reveal>

      {/* Helper cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Reveal delay={120} className="rounded-2xl border border-stone-200 bg-canvas/60 p-5">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkle size={16} className="text-clay-500" /> Try a sample
          </span>
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            See a fully scored, audit-ready result card before you send your first screen.
          </p>
          <Link
            to="/app/result"
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-clay-700 hover:text-clay-800"
          >
            Open sample result <ArrowUpRight size={14} />
          </Link>
        </Reveal>
        <Reveal delay={160} className="rounded-2xl border border-stone-200 bg-canvas/60 p-5">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <FileText size={16} className="text-clay-500" /> Built for the audit
          </span>
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            Every score is explainable and logged by default — built for NYC LL-144 and the Mobley
            standard.
          </p>
          <Link
            to="/trust"
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-clay-700 hover:text-clay-800"
          >
            Trust &amp; audit <ArrowUpRight size={14} />
          </Link>
        </Reveal>
      </div>
    </Container>
  )
}
