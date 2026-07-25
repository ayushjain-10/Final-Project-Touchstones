import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api.js'
import { ErrorState, EmptyState } from '../../components/states.jsx'
import CalibrationBadge from '../../components/CalibrationBadge.jsx'
import { Sparkle, ArrowRight, ShieldCheck } from '../../components/icons.jsx'

// Benchmarks — the data moat, made visible (CC3 / Calibrated Score + Benchmarks).
// ----------------------------------------------------------------------------------------
// Per-role score DISTRIBUTIONS + OUTCOME-CALIBRATED bands derived from the labels Touchstones
// already collects (advanced / offer / hired / stayed-90d). Every number traces to a real
// aggregate from /api/benchmarks/summary; low-sample roles say so instead of faking precision.

function humanizeRole(rf) {
  if (!rf) return 'Unspecified'
  return String(rf)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const pctText = (x) => (x == null ? '—' : `${x}%`)

// A clean, dependency-free score histogram (0–100 in ten 10-pt bins) built from styled divs.
function Histogram({ bins = [], percentiles = {} }) {
  const max = Math.max(1, ...bins.map((b) => b.n || 0))
  const total = bins.reduce((a, b) => a + (b.n || 0), 0)
  if (!total) {
    return <p className="text-sm text-stone-400">No scores in this view yet.</p>
  }
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {bins.map((b) => {
          const h = Math.round(((b.n || 0) / max) * 100)
          return (
            <div key={b.label} className="group flex flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[0.65rem] tabular-nums text-stone-400 opacity-0 transition-opacity group-hover:opacity-100">
                {b.n}
              </span>
              <div
                className="w-full rounded-t bg-clay-400/80 transition-colors group-hover:bg-clay-500"
                style={{ height: `${b.n > 0 ? Math.max(4, h) : 0}%` }}
                title={`${b.label}: ${b.n}`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-stone-200 pt-1.5">
        {bins.map((b) => (
          <span key={b.label} className="flex-1 text-center text-[0.6rem] tabular-nums text-stone-400">
            {b.lo}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-500">
        {total} scored · median{' '}
        <span className="font-semibold text-ink tabular-nums">{percentiles.p50 ?? '—'}</span> · top-decile (p90){' '}
        <span className="font-semibold text-ink tabular-nums">{percentiles.p90 ?? '—'}</span>
      </p>
    </div>
  )
}

// One score band's outcome rates (advanced / offer / hired), with an honest low-sample state.
function BandCard({ band, minBand }) {
  const label = band.bucket.replace('-', '–')
  const need = Math.max(0, minBand - (band.advanced_n || 0))
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="font-serif text-base font-semibold text-ink">{label}</span>
        <span className="text-xs text-stone-400">n={band.n}</span>
      </div>
      {band.sufficient ? (
        <dl className="mt-3 space-y-2">
          <Row label="Advanced" value={pctText(band.advanced_rate)} n={band.advanced_n} />
          <Row label="Offer" value={pctText(band.offer_rate)} n={band.offer_n} />
          <Row label="Hired" value={pctText(band.hire_rate)} n={band.hire_n} />
        </dl>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Not enough labeled outcomes yet
          {need > 0 ? ` — ${need} more to calibrate this band.` : '.'}
        </p>
      )}
    </div>
  )
}

function Row({ label, value, n }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
        {n != null && <span className="text-[0.65rem] tabular-nums text-stone-400">n={n}</span>}
      </dd>
    </div>
  )
}

export default function Benchmarks() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState('__all')

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    api
      .request('/benchmarks/summary')
      .then((res) => active && setSummary(res || null))
      .catch((e) => active && setError(e.message || 'Could not load benchmarks.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => load(), [load])

  // Build the tab set: an "All roles" overview + one tab per role family the account has scored.
  const tabs = useMemo(() => {
    if (!summary) return []
    const all = {
      key: '__all',
      label: 'All roles',
      role_family: null,
      sample_size: summary.account_total_labeled,
      scored_size: summary.account_total_scored,
      distribution: summary.overall.distribution,
      percentiles: summary.overall.percentiles,
      buckets: summary.overall.buckets,
    }
    const roleTabs = (summary.roles || []).map((r) => ({
      key: r.role_family || '__none',
      label: humanizeRole(r.role_family),
      ...r,
    }))
    return [all, ...roleTabs]
  }, [summary])

  const active = useMemo(() => tabs.find((t) => t.key === selected) || tabs[0], [tabs, selected])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="h-8 w-44 animate-pulse rounded bg-stone-200/70" />
        <div className="mt-8 h-48 animate-pulse rounded-2xl bg-stone-200/50" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-200/50" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <Header />
        <ErrorState className="mt-6" title="Couldn’t load benchmarks" message={error} onRetry={load} />
      </div>
    )
  }

  const empty = !summary || summary.account_total_scored === 0

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Header />

      {empty ? (
        <EmptyState
          className="mt-10"
          icon={<Sparkle size={22} />}
          title="No scored screens yet"
          hint="Once candidates complete a screen and you record what happened next (advanced, offer, hired), their scores calibrate into real per-role benchmarks here."
          cta="Create a screen"
          ctaTo="/app/library"
        />
      ) : (
        <>
          {/* Moat size — the honest headline: how much labeled outcome data backs this. */}
          <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Scored screens" value={summary.account_total_scored} />
            <Stat label="Labeled outcomes" value={summary.account_total_labeled} />
            <Stat label="Role families" value={(summary.roles || []).length} />
          </div>

          {/* Role tabs */}
          <div className="mt-7 flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelected(t.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active && active.key === t.key
                    ? 'bg-clay-600 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs opacity-70">{t.scored_size}</span>
              </button>
            ))}
          </div>

          {active && (
            <>
              {/* Distribution */}
              <div className="mt-5 card p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-lg font-semibold text-ink">
                    {active.label} — score distribution
                  </h2>
                </div>
                <div className="mt-5">
                  <Histogram bins={active.distribution} percentiles={active.percentiles} />
                </div>
              </div>

              {/* Outcome-calibrated bands */}
              <div className="mt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-serif text-lg font-semibold text-ink">Outcome-calibrated bands</h2>
                  <p className="text-xs text-stone-500">
                    Based on{' '}
                    <span className="font-semibold text-ink">{active.sample_size}</span> labeled outcome
                    {active.sample_size === 1 ? '' : 's'}
                    {active.role_family || active.key === '__all' ? '' : ` for ${active.label}`}.
                  </p>
                </div>

                {active.sample_size < summary.min_band_sample && (
                  <div className="mt-3 rounded-xl border border-stone-200 bg-canvas/60 px-4 py-3 text-sm text-stone-600">
                    <ShieldCheck size={14} className="mr-1.5 inline text-clay-500" />
                    Low sample — bands stay honest and fill in as you record more outcomes. We never
                    fabricate a rate to look precise.
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {(active.buckets || []).map((b) => (
                    <BandCard key={b.bucket} band={b} minBand={summary.min_band_sample} />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Recent results, each with its real calibration pre-attached */}
          {Array.isArray(summary.recent) && summary.recent.length > 0 && (
            <div className="mt-9">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-serif text-lg font-semibold text-ink">Recent results, calibrated</h2>
                <Link
                  to="/app/result"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-clay-700 hover:text-clay-800"
                >
                  Open a result <ArrowRight size={15} />
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {summary.recent.map((r) => (
                  <Link
                    key={r.score_id}
                    to={`/app/result?score=${r.score_id}`}
                    className="block"
                    aria-label={`Open calibrated result for ${humanizeRole(r.role_family)}`}
                  >
                    <CalibrationBadge calibration={r} className="h-full transition-shadow hover:shadow-lift" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Benchmarks</h1>
      <p className="mt-1 text-sm text-stone-600">
        How your scores map to real outcomes — per-role percentiles and calibrated bands, built only
        from the results you’ve recorded.
      </p>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-stone-500">{label}</p>
    </div>
  )
}
