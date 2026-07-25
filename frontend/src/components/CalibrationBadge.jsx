import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { Skeleton } from './states.jsx'
import { Sparkle, ShieldCheck } from './icons.jsx'

// CalibrationBadge — the data moat, shown next to a single result.
// ----------------------------------------------------------------------------------
// A SIBLING component (it never touches ResultCard / DecisionCard). Give it either a
// `scoreId` (it self-fetches GET /api/benchmarks/score/:id) or a pre-fetched
// `calibration` object (e.g. an item from /summary.recent) and it renders an honest
// percentile + outcome-calibrated band, degrading gracefully to a low-sample state.
//
// Everything here traces to a real aggregate — there are no fabricated numbers. When the
// sample is too small the copy SAYS so and names the fallback cohort it used.

const TITLE = {
  role: (r) => `Calibrated · ${r}`,
  account_all_roles: () => 'Calibrated · your screens',
  global: (r) => `Calibrated · ${r} (Touchstones pool)`,
  global_all_roles: () => 'Calibrated · Touchstones pool',
  heuristic: () => 'Score reference',
}

function humanizeRole(rf) {
  if (!rf) return 'All roles'
  return String(rf)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function scopeCaption(c) {
  const role = humanizeRole(c.role_family)
  switch (c.scope) {
    case 'role':
      return `Based on ${c.sample_size} labeled outcome${c.sample_size === 1 ? '' : 's'} for ${role}.`
    case 'account_all_roles':
      return `Not enough ${humanizeRole(c.role_family)} outcomes yet — ranked across all your screens (${c.sample_size} labeled).`
    case 'global':
    case 'global_all_roles':
      return `Your sample is small — ranked against the anonymized Touchstones pool (${c.sample_size} labeled).`
    case 'heuristic':
    default:
      return 'Not enough outcomes recorded yet — showing a score-only reference.'
  }
}

// "Top X%" headline, kept honest at the edges.
function topLabel(c) {
  if (c.top_percent == null || c.cohort_size == null || c.cohort_size === 0) return null
  if (c.top_percent <= 0) return 'Top of cohort'
  return `Top ${Math.max(1, c.top_percent)}%`
}

// The single calibrated-outcome sentence, preferring a lift multiple when it's meaningful.
function bandInsight(c) {
  const b = c.band
  if (!b || !b.sufficient || b.advanced_rate == null) return null
  const lift = c.lift && c.lift.advanced
  if (lift != null && lift >= 1.2) {
    return `Candidates at this score advanced ${lift}× your average.`
  }
  if (lift != null && lift > 0 && lift <= 0.8) {
    return `Candidates at this score advanced ${b.advanced_rate}% — below your average.`
  }
  return `${b.advanced_rate}% advanced past the screen (n=${b.advanced_n}).`
}

function offerInsight(c) {
  const b = c.band
  if (!b || !b.sufficient || b.offer_rate == null || b.offer_n < 1) return null
  return `${b.offer_rate}% reached an offer (n=${b.offer_n}).`
}

// Cold-start estimate (empirical-Bayes): a always-available, honestly-tiered advance-rate the
// backend attaches even before a band has enough labels to headline. Keeps the badge useful in
// early testing instead of dead-ending at "not enough data".
const TIER = {
  prior: { label: 'Starting estimate', cls: 'bg-stone-100 text-stone-600', shield: false },
  provisional: { label: 'Provisional', cls: 'bg-clay-50 text-clay-700 ring-1 ring-clay-200', shield: false },
  calibrated: { label: 'Calibrated', cls: 'bg-clay-50 text-clay-700 ring-1 ring-clay-200', shield: true },
}

function estimateBasis(e) {
  if (e.tier === 'prior') return `prior only (${e.prior_mean}% base rate)`
  if (e.tier === 'provisional') return `prior + ${e.n} outcome${e.n === 1 ? '' : 's'}`
  return `${e.n} labeled outcome${e.n === 1 ? '' : 's'}`
}

export default function CalibrationBadge({ scoreId, calibration = null, className = '', compact = false }) {
  const [data, setData] = useState(calibration)
  const [loading, setLoading] = useState(!calibration && !!scoreId)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (calibration) {
      setData(calibration)
      return
    }
    if (!scoreId) return
    let active = true
    setLoading(true)
    setError(null)
    api
      .request(`/benchmarks/score/${scoreId}`)
      .then((res) => active && setData(res))
      .catch((e) => active && setError(e.message || 'Could not load calibration.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [scoreId, calibration])

  if (loading) {
    return (
      <div className={`card p-5 ${className}`}>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-7 w-40" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </div>
    )
  }

  // A failed lookup should never break the surrounding result — degrade to nothing.
  if (error || !data) return null

  const c = data
  const calibrated = c.likelihood && c.likelihood.confidence === 'calibrated'
  const role = humanizeRole(c.role_family)
  const top = topLabel(c)
  const insight = bandInsight(c)
  const offer = offerInsight(c)
  const title = (TITLE[c.scope] || TITLE.heuristic)(role)

  return (
    <div className={`card p-5 ${className}`} aria-label="Score calibration">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          <Sparkle size={14} className="text-clay-500" /> {title}
        </span>
        {c.insufficient_data && (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.65rem] font-medium text-stone-500">
            low sample
          </span>
        )}
      </div>

      {/* Headline: percentile + the calibrated likelihood band */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {top ? (
          <span className="font-serif text-3xl font-semibold text-ink">
            {top}
            <span className="ml-1.5 align-middle text-sm font-sans font-normal text-stone-500">{role}</span>
          </span>
        ) : (
          <span className="font-serif text-xl font-semibold text-stone-400">Percentile pending</span>
        )}
      </div>

      {c.likelihood && c.likelihood.basis !== 'none' && (
        <span
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            calibrated ? 'bg-clay-50 text-clay-700 ring-1 ring-clay-200' : 'bg-stone-100 text-stone-600'
          }`}
        >
          {calibrated && <ShieldCheck size={13} />}
          {c.likelihood.label}
        </span>
      )}

      {/* The outcome-calibrated sentence(s) — only when the band has enough labels */}
      {(insight || offer) && !compact && (
        <div className="mt-3 space-y-1">
          {insight && <p className="text-sm leading-relaxed text-ink">{insight}</p>}
          {offer && <p className="text-sm leading-relaxed text-stone-600">{offer}</p>}
        </div>
      )}

      {/* Cold-start advance-rate estimate — always present, tiered prior → provisional → calibrated,
          with a 90% credible interval that narrows as real outcomes arrive. */}
      {c.estimate && !compact && (
        <div className="mt-3 rounded-lg bg-canvas/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Advance-rate estimate</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${TIER[c.estimate.tier].cls}`}>
              {TIER[c.estimate.tier].shield && <ShieldCheck size={11} />}
              {TIER[c.estimate.tier].label}
            </span>
          </div>
          <p className="mt-1 font-serif text-2xl font-semibold text-ink">
            {c.estimate.advanced_rate}%
            <span className="ml-2 align-middle text-xs font-sans font-normal text-stone-500">
              90% CI {c.estimate.ci_low}–{c.estimate.ci_high}%
            </span>
          </p>
          <p className="text-xs text-stone-500">Basis: {estimateBasis(c.estimate)}.</p>
        </div>
      )}

      {/* Honest provenance — always shown, names the cohort + the sample it leaned on */}
      <p className="mt-3 text-xs leading-relaxed text-stone-400">{scopeCaption(c)}</p>
    </div>
  )
}
