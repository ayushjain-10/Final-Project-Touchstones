import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Container } from '../../components/primitives.jsx'
import ResultCard, { sampleResult } from '../../components/ResultCard.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import DecisionCard from '../../components/DecisionCard.jsx'
import DirectionPanel from '../../components/DirectionPanel.jsx'
import DeliverablesReviewCard from '../../components/DeliverablesReviewCard.jsx'
import IntegrityActivityPanel from '../../components/IntegrityActivityPanel.jsx'
import ActivityTimeline from '../../components/ActivityTimeline.jsx'
import ExecutionPanel from '../../components/ExecutionPanel.jsx'
import IssueCredentialCard from '../../components/IssueCredentialCard.jsx'
import ClientReviewCard from '../../components/ClientReviewCard.jsx'
import Reveal from '../../components/Reveal.jsx'
import { api } from '../../services/api.js'
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient.js'
import { track, trackOnce } from '../../services/analytics.js'
import { toResultCardData, verificationStateFromDigest } from '../../services/proofMappers.js'
import { Skeleton } from '../../components/states.jsx'
import {
  ArrowRight,
  Check,
  Clock,
  Eye,
  Code,
  ShieldCheck,
  Download,
  Sparkle,
  Link as LinkIcon,
} from '../../components/icons.jsx'

// Demo session-context signals shown when no real digest is available (sample mode).
const sampleSignals = [
  {
    icon: Code,
    label: 'Typed, not pasted',
    detail: '94% of code was typed in-editor. Two small pastes, both flagged and reviewed.',
  },
  {
    icon: Eye,
    label: 'Stayed in the tab',
    detail: '3 brief focus changes were recorded. Review them with the work evidence; no intent is inferred.',
  },
  {
    icon: Clock,
    label: 'Edit cadence',
    detail: 'The work unfolded across edits and pauses. This is session context, not identity proof.',
  },
  {
    icon: ShieldCheck,
    label: 'Session continuity',
    detail: 'The server observed one continuous assessment session in a consistent environment.',
  },
]

// Build behavioral-signal rows from a real integrity digest summary.
function signalsFromDigest(digest) {
  if (!digest?.summary) return sampleSignals
  const s = digest.summary
  const typedPct =
    typeof s.typed_fraction === 'number' ? Math.round(s.typed_fraction * 100) : null
  return [
    {
      icon: Code,
      label: 'Typed, not pasted',
      detail:
        typedPct != null
          ? `${typedPct}% of the response was typed in-editor. ${s.paste_count || 0} paste${s.paste_count === 1 ? '' : 's'} recorded.`
          : `${s.paste_count || 0} paste event(s) recorded.`,
    },
    {
      icon: Eye,
      label: 'Tab focus',
      detail: `${s.tab_hidden_count || 0} tab switches, ${s.window_blur_count || 0} window blurs during the screen.`,
    },
    {
      icon: Clock,
      label: 'Time hidden',
      detail: `${Math.round((s.tab_hidden_ms || 0) / 1000)}s spent with the tab hidden in total.`,
    },
    {
      icon: ShieldCheck,
      label: 'Automation check',
      detail:
        s.bot_verdict === true
          ? 'A server-observed automation signal was detected — review recommended.'
          : 'No automation signal flagged by the server.',
    },
  ]
}

function SignalRow({ s }) {
  const Icon = s.icon
  return (
    <div className="flex gap-3 py-3.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{s.label}</span>
          <Check size={14} className="text-clay-500" />
        </div>
        {/* Rendered as TEXT — backend/model strings are never injected as HTML. */}
        <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{s.detail}</p>
      </div>
    </div>
  )
}

// One row of the scoring-provenance list (label + value). Values are rendered as TEXT —
// model/version/hash strings from the backend are never injected as HTML.
function ProvRow({ label, value, mono = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-stone-400">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-stone-600${mono ? ' font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  )
}

// "Adjust this score" (flag: VITE_SCORE_OVERRIDE, off by default). Recruiter-only by
// construction: this component lives in the recruiter Result view and is never part of
// the shared ResultCard/DecisionCard (which candidate + marketing pages also render).
const SCORE_OVERRIDE_ENABLED = import.meta.env.VITE_SCORE_OVERRIDE === 'true'

// Parse the server-composed override_reason ("Adjusted to NN/100 (model scored MM): why")
// back into its parts for display; a non-matching reason (legacy/manual) renders raw.
const OVERRIDE_REASON_RE = /^Adjusted to (\d{1,3})\/100 \(model scored (\d{1,3})\): ([\s\S]*)$/

// Every disagreement becomes a human_override training label. The model score is never
// changed here; the backend stores the correction alongside it on the live score row.
function ScoreOverride({ score, onSaved }) {
  const parsed = score.human_override ? (score.override_reason || '').match(OVERRIDE_REASON_RE) : null
  const rawReason = parsed ? parsed[3] : score.human_override ? score.override_reason || '' : ''
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [why, setWhy] = useState('')
  const [showWhy, setShowWhy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Prefill from the CURRENT props at click time (not mount time), so editing an
  // existing adjustment always starts from what is on record right now.
  function startEdit() {
    setValue(String(parsed ? parsed[1] : (score.normalized_score ?? '')))
    setWhy(rawReason)
    setError(null)
    setEditing(true)
  }

  const num = Number(value)
  const valid = Number.isInteger(num) && num >= 0 && num <= 100 && why.trim().length >= 10

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await api.overrideScore(score.id, {
        humanScore: num,
        overrideReason: why.trim(),
      })
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Could not save the adjustment.')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs">
        {score.human_override ? (
          <>
            <span
              title={rawReason}
              className="inline-flex items-center gap-1.5 rounded-full bg-clay-50 px-3 py-1 font-medium text-clay-800 ring-1 ring-clay-200"
            >
              {parsed ? `Adjusted to ${parsed[1]} (model: ${parsed[2]})` : 'Human override recorded'}
            </span>
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              className="text-stone-500 hover:text-ink"
            >
              {showWhy ? 'Hide reason' : 'Why?'}
            </button>
            <button type="button" onClick={startEdit} className="text-stone-500 hover:text-ink">
              Edit
            </button>
            {showWhy && rawReason && (
              <p className="w-full text-right text-xs leading-relaxed text-stone-500">{rawReason}</p>
            )}
          </>
        ) : (
          <button type="button" onClick={startEdit} className="btn-ghost px-3 py-1.5 text-xs">
            Adjust score
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card mt-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-stone-500">
          Adjusted score (0-100)
          <input
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 block w-24 rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
          />
        </label>
        <label className="min-w-[16rem] flex-1 text-xs font-medium text-stone-500">
          Why?
          <input
            type="text"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            maxLength={1000}
            placeholder="What did the model get wrong?"
            className="mt-1 block w-full rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!valid || saving}
            className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="btn-ghost px-4 py-2 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-stone-500">
        The model score stays on record; your correction (at least 10 characters on why) is saved
        alongside it and improves future scoring.
      </p>
      {error && <p className="mt-2 text-xs text-amber-800">{error}</p>}
    </div>
  )
}

export default function Result() {
  const [params] = useSearchParams()
  const scoreId = params.get('score')
  const submissionId = params.get('submission') || params.get('sub')

  const [loading, setLoading] = useState(Boolean(scoreId || submissionId))
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  // The raw proof_scores row (toResultCardData drops human_override/override_reason,
  // which the ScoreOverride affordance needs). Updated in place after an adjustment.
  const [scoreRow, setScoreRow] = useState(null)
  const [digest, setDigest] = useState(null)
  // AI-direction is lifted here (instead of self-fetched in DirectionPanel) so the
  // DecisionCard and the panel below share ONE request. null = not loaded / unscored.
  const [direction, setDirection] = useState(null)
  const [audit, setAudit] = useState(null)
  const [exporting, setExporting] = useState(false)
  // The submission id behind this result — from the URL or the loaded score.
  // Drives the AI-direction + credential panels.
  const [resolvedSubId, setResolvedSubId] = useState(submissionId || null)
  const [resolvedScoreId, setResolvedScoreId] = useState(scoreId || null)
  const [outcome, setOutcome] = useState(null) // 'advanced' | 'passed' | null
  const [outcomeSaving, setOutcomeSaving] = useState(false)
  // Deliverables review (TOU-146): the screen's checklist + the candidate's self-check state
  // (metadata.deliverables_check) + the submitted text for the keyword-coverage heuristic.
  const [deliverablesReview, setDeliverablesReview] = useState(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [copiedLink, setCopiedLink] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      if (!scoreId && !submissionId) return
      setLoading(true)
      setError(null)
      try {
        // Resolve the score id. A ?score deep-link has it directly; a ?submission
        // link (e.g. from Activity) looks up the latest score row for that
        // submission via Supabase — WITHOUT re-scoring (scoring is not safely
        // repeatable; re-running it hits a unique-constraint write error).
        let sId = scoreId
        if (!sId && submissionId && isSupabaseConfigured) {
          const { data: scoreRows } = await supabase
            .from('proof_scores')
            .select('id')
            .eq('submission_id', submissionId)
            .order('created_at', { ascending: false })
            .limit(1)
          sId = scoreRows?.[0]?.id || null
        }
        if (!sId) {
          if (active) setError('This submission hasn’t been scored yet.')
          return
        }
        const score = await api.getScore(sId)
        if (active) {
          setResolvedScoreId(sId)
          setScoreRow(score)
        }

        // Enrich (best-effort) with submission/work-sample/digest/direction context.
        let workSample = null
        let submission = null
        let dig = null
        let dir = null
        const sid = submissionId || score.submission_id
        if (active && sid) setResolvedSubId(sid)
        // E-10: these four are mutually independent and each is best-effort — fetch them in parallel
        // (was a 4-5 RTT serial waterfall). The immutable audit record loads on view (not just on
        // export) so the recruiter SEES how the score was computed; older/seed scores may lack it.
        const [loaded, digRes, dirRes, auditRes] = await Promise.all([
          sid ? api.getSubmission(sid).catch(() => null) : Promise.resolve(null),
          sid ? api.getIntegrityDigest(sid).catch(() => null) : Promise.resolve(null),
          sid ? api.getDirection(sid).catch(() => null) : Promise.resolve(null),
          api.getScoreAudit(sId).catch(() => null),
        ])
        if (loaded) {
          submission = loaded.submission
          workSample = loaded.work_sample
        }
        dig = digRes
        dir = dirRes
        const auditRec = auditRes
        if (!active) return
        setDeliverablesReview(
          Array.isArray(workSample?.deliverables) && workSample.deliverables.length
            ? {
                deliverables: workSample.deliverables,
                checked: Array.isArray(submission?.metadata?.deliverables_check)
                  ? submission.metadata.deliverables_check
                  : [],
                text: String(submission?.response_text || submission?.response_code || ''),
              }
            : null,
        )
        setDigest(dig)
        setDirection(dir)
        setAudit(auditRec)
        setData(toResultCardData(score, { workSample, submission, digest: dig }))
        track('result_viewed', { scoreId: sId })
        // Aha metric: the first real score a recruiter views (median time-to-first-score).
        trackOnce('first_score_viewed', { scoreId: sId })
      } catch (e) {
        if (active) setError(e.message || 'Could not load this result.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [scoreId, submissionId, retryNonce])

  async function exportAudit() {
    if (!resolvedScoreId) return
    setExporting(true)
    try {
      const record = await api.getScoreAudit(resolvedScoreId)
      setAudit(record)
      const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-${resolvedScoreId}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      // The audit record may not exist yet for an older/seed score — say so
      // plainly instead of leaking a raw "not found".
      setError(
        e.status === 404
          ? 'No audit record is available for this result yet.'
          : e.message || 'Could not export the audit trail.',
      )
    } finally {
      setExporting(false)
    }
  }

  async function copyResultLink() {
    try {
      await navigator.clipboard?.writeText(window.location.href)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 1800)
    } catch {
      /* clipboard unavailable (insecure context) */
    }
  }

  // Smooth-scroll a DecisionCard signal tile to its detailed panel below.
  function scrollToSection(id) {
    if (typeof document === 'undefined') return
    const el = document.getElementById(id)
    if (!el) return
    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  }

  if (loading) {
    return (
      <Container className="py-8 lg:py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-9 w-56" />
        </div>
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[26rem] rounded-2xl" />
          <div className="space-y-6">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        </div>
      </Container>
    )
  }

  if (error && !data) {
    return (
      <Container className="py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">Result unavailable</h1>
        <p className="mx-auto mt-3 max-w-md text-stone-600">{error}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="btn-primary px-4 py-2 text-sm"
          >
            Try again
          </button>
          <Link to="/app" className="btn-ghost px-4 py-2 text-sm">
            Back to results
          </Link>
        </div>
      </Container>
    )
  }

  // Sample mode when no real score id is provided — keeps the route a useful demo.
  const result = data || sampleResult
  const isSample = !scoreId && !submissionId
  const signals = isSample ? sampleSignals : signalsFromDigest(digest)
  const verification = isSample
    ? sampleResult.verification
    : verificationStateFromDigest(digest)

  // Real "scored at" timestamp from the immutable audit log, when available.
  const scoredAt = (() => {
    const ts = audit?.event_ts_end || audit?.created_at
    if (!ts) return null
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
  })()

  // Audit timeline: real digest events when present, else the sample story. The scoring row is
  // backed by the real proof_audit_log (model + version + normalized score) when we have it.
  const auditRows =
    digest?.summary && !isSample
      ? [
          { t: '—', e: `${digest.event_count || 0} integrity events recorded`, meta: 'Hash-chained, append-only' },
          {
            t: '—',
            e: digest.verified_chain ? 'Chain verified' : 'Chain check pending',
            meta: `head ${String(digest.head_hash || '').slice(0, 12) || 'n/a'}…`,
          },
          audit
            ? {
                t: scoredAt || '—',
                e: 'Weighted total calculated from rubric',
                meta: `weighted sum · ${audit.normalized_score ?? result.score} / 100`,
              }
            : { t: 'system', e: 'Weighted total calculated from rubric', meta: `${result.score} / 100` },
          { t: 'system', e: 'Session integrity summarized', meta: verification },
        ]
      : [
          { t: '14:02:11', e: 'Screen opened by candidate', meta: 'session environment recorded' },
          { t: '14:06:48', e: 'First edit', meta: 'Typed in editor' },
          { t: '14:19:02', e: 'Paste detected (12 chars)', meta: 'Flagged · reviewed · within policy' },
          { t: '14:35:54', e: 'Submitted', meta: '34 min elapsed' },
          { t: '14:35:55', e: 'Weighted total calculated from rubric', meta: '92 / 100 · reasoning attached' },
          { t: '14:35:55', e: 'Session integrity summarized', meta: 'review signals clear' },
        ]

  // Outcome loop: a hiring manager records the real decision (advance / pass), which
  // feeds the calibration flywheel. Best-effort; surfaces a soft error on failure.
  async function recordOutcome(advanced) {
    if (!resolvedSubId || outcomeSaving) return
    setOutcomeSaving(true)
    try {
      await api.setOutcome(resolvedSubId, { advanced })
      setOutcome(advanced ? 'advanced' : 'passed')
      if (advanced) track('candidate_advanced')
    } catch (e) {
      setError(e.message || 'Could not record the decision.')
    } finally {
      setOutcomeSaving(false)
    }
  }

  return (
    <Container className="py-8 lg:py-10">
      {/* Honest sample-mode banner — so an example result is never mistaken for
          a real candidate. Real results open from the dashboard with a ?score. */}
      {isSample && (
        <Reveal className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-clay-200 bg-clay-50 px-4 py-3 text-sm text-clay-800">
          <span className="inline-flex items-center gap-2">
            <Sparkle size={15} className="text-clay-600" />
            <span>
              <span className="font-semibold">Sample result</span> — example data so you can see the
              full decision card. Your real results open from the dashboard.
            </span>
          </span>
          <Link
            to="/app"
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-clay-700 hover:text-clay-800"
          >
            Go to your results <ArrowRight size={14} />
          </Link>
        </Reveal>
      )}

      {/* Breadcrumb + verdict */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <Link to="/app" className="hover:text-ink">
            Results
          </Link>
          <span className="text-stone-300">/</span>
          <h1 className="font-medium text-ink">{result.candidate}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportAudit}
            disabled={!resolvedScoreId || exporting}
            className="btn-ghost px-4 py-2 text-xs disabled:opacity-50"
          >
            <Download size={15} /> {exporting ? 'Exporting…' : 'Export audit trail'}
          </button>
          {outcome === 'advanced' ? (
            <span className="px-4 py-2 text-xs font-medium text-clay-700">Advanced ✓</span>
          ) : outcome === 'passed' ? (
            <span className="px-4 py-2 text-xs font-medium text-stone-500">Passed</span>
          ) : (
            <>
              <button
                onClick={() => recordOutcome(false)}
                disabled={!resolvedSubId || outcomeSaving}
                className="btn-ghost px-4 py-2 text-xs disabled:opacity-50"
              >
                Pass
              </button>
              <button
                onClick={() => recordOutcome(true)}
                disabled={!resolvedSubId || outcomeSaving}
                className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
              >
                {outcomeSaving ? 'Saving…' : 'Advance candidate'} <ArrowRight size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      {error && data && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-100">
          {error}
        </p>
      )}

      {/* Decision Card — the fused verdict, hero of the page. Real scored
          submissions only; sample mode keeps the marketing demo clean. We feed it
          the data Result already loaded (work score + criteria, lifted direction,
          digest) so there are no duplicate network calls. */}
      {!isSample && data && (
        <Reveal className="mt-6">
          <DecisionCard
            score={result}
            direction={direction}
            digest={digest}
            onAnchor={scrollToSection}
          />
        </Reveal>
      )}

      {/* Human score correction, right under the headline score (VITE_SCORE_OVERRIDE,
          off by default). Never rendered in sample mode or candidate/marketing views. */}
      {!isSample && SCORE_OVERRIDE_ENABLED && scoreRow && (
        <ScoreOverride score={scoreRow} onSaved={setScoreRow} />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The result card — the product. Anchor target for the Work tile. */}
        <div id="work-score" className="scroll-mt-20">
          <Reveal>
            <ResultCard
              data={{ ...result, verification }}
              variant="full"
              onExport={resolvedScoreId ? exportAudit : undefined}
              exporting={exporting}
            />
          </Reveal>
        </div>

        {/* Session context + AI-direction + audit side rail */}
        <div className="space-y-6">
          {/* How they directed the AI — the headline "Direct the AI" signal.
              Only shown for a real submission; sample mode keeps the demo clean.
              We hand it the direction row Result lifted so the DecisionCard and
              this panel share ONE request. Anchor target for the AI-direction tile. */}
          {!isSample && resolvedSubId && (
            <div id="direction-panel" className="scroll-mt-20">
              <Reveal delay={40}>
                <DirectionPanel submissionId={resolvedSubId} direction={direction} />
              </Reveal>
            </div>
          )}

          {/* Deliverables checklist review (TOU-146): the candidate's self-check state plus a
              plainly-labeled keyword-coverage heuristic. Review aid only, never a score. */}
          {!isSample && deliverablesReview && (
            <Reveal delay={50}>
              <DeliverablesReviewCard {...deliverablesReview} />
            </Reveal>
          )}

          {/* Neutral behavioral / in-editor activity signals from the integrity
              digest. Self-contained: it degrades to a quiet "no data" if the
              digest 404s or is empty, so it never blocks the result. We hand it
              the digest Result already loaded to avoid a duplicate request.
              Anchor target for the session-context tile. */}
          {!isSample && resolvedSubId && (
            <div id="integrity-panel" className="scroll-mt-20">
              <Reveal delay={60}>
                <IntegrityActivityPanel submissionId={resolvedSubId} digest={digest} />
              </Reveal>
            </div>
          )}

          {/* Timestamped session activity report (start, AI prompts, paste/focus, submit). */}
          {!isSample && resolvedSubId && (
            <Reveal delay={70}>
              <ActivityTimeline submissionId={resolvedSubId} />
            </Reveal>
          )}

          {/* Objective signal: run the candidate's code against hidden tests in a sandbox. */}
          {!isSample && resolvedSubId && (
            <Reveal delay={70}>
              <ExecutionPanel submissionId={resolvedSubId} />
            </Reveal>
          )}

          {!isSample && resolvedSubId && (
            <Reveal delay={75}>
              <ClientReviewCard submissionId={resolvedSubId} candidateName={result.candidate} />
            </Reveal>
          )}

          <Reveal delay={80} className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-base font-semibold text-ink">Session integrity record</h3>
              <VerifiedBadge state={verification} size="sm" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">
              Behavioral signals are observed by the server and shown only as review context. No
              identity matching, biometrics, or emotion inference. These signals never make the hiring decision.
            </p>
            <div className="mt-2 divide-y divide-stone-200">
              {signals.map((s) => (
                <SignalRow key={s.label} s={s} />
              ))}
            </div>
          </Reveal>

          <Reveal delay={140} className="card p-5">
            <h3 className="font-serif text-base font-semibold text-ink">Audit trail</h3>
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
              <ShieldCheck size={14} className="text-clay-500" /> Explainable &amp; logged by default
            </p>
            <ol className="mt-4 space-y-3.5">
              {auditRows.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-clay-400" />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-stone-400">{a.t}</span>
                      <span className="text-sm text-ink">{a.e}</span>
                    </div>
                    <p className="text-xs text-stone-500">{a.meta}</p>
                  </div>
                </li>
              ))}
            </ol>
            {audit && (
              <div className="mt-4 border-t border-stone-100 pt-4">
                <p className="text-xs font-medium text-stone-500">Scoring provenance</p>
                <dl className="mt-2 space-y-1.5">
                  <ProvRow label="Grader model" value={`${audit.model_id || '—'}${audit.model_version && audit.model_version !== audit.model_id ? ` · ${audit.model_version}` : ''}`} />
                  <ProvRow label="Rubric / prompt" value={`v${audit.rubric_version ?? '—'} · p${audit.prompt_version ?? '—'}`} />
                  <ProvRow label="Normalized score" value={`${audit.normalized_score ?? result.score} / 100`} />
                  {scoredAt && <ProvRow label="Scored at" value={scoredAt} />}
                  <ProvRow label="Input hash" value={audit.input_hash ? `${String(audit.input_hash).slice(0, 16)}…` : '—'} mono />
                  {audit.row_hash && (
                    <ProvRow label="Record hash" value={`${String(audit.row_hash).slice(0, 16)}…`} mono />
                  )}
                </dl>
                <p className="mt-2.5 text-xs leading-relaxed text-stone-500">
                  The grader model evaluates each rubric criterion from the evidence. Code applies
                  the rubric weights to calculate the 0 to 100 total, and the provenance is logged.
                </p>
                <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-clay-700">
                  <Check size={14} /> Immutable record — append-only &amp; tamper-evident
                </p>
              </div>
            )}
          </Reveal>

          {/* Issue a publicly verifiable credential for this score. */}
          {!isSample && resolvedSubId && (
            <Reveal delay={200}>
              <IssueCredentialCard submissionId={resolvedSubId} />
            </Reveal>
          )}

          <Reveal delay={260} className="card p-5">
            <h3 className="font-serif text-base font-semibold text-ink">Share &amp; sync</h3>
            <div className="mt-3 space-y-2">
              <button
                onClick={copyResultLink}
                className="btn-ghost w-full justify-start px-3 py-2.5 text-xs"
              >
                <LinkIcon size={15} /> {copiedLink ? 'Copied' : 'Copy shareable result link'}
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-stone-400">
              Slack alerts and Ashby &amp; Greenhouse sync are coming next — ask us to prioritize it.
            </p>
          </Reveal>
        </div>
      </div>
    </Container>
  )
}
