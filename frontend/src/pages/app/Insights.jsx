import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api.js'
import { ErrorState, EmptyState } from '../../components/states.jsx'
import { Sparkle, Clock, Bolt, Compass, ArrowRight, ShieldCheck } from '../../components/icons.jsx'

// Insights — Hiring Analytics & ROI (CC2 / proof-of-value surface).
// ---------------------------------------------------------------------------------------
// The page a customer checks weekly and the slide an investor leans into. EVERY figure is a
// real, account-scoped aggregate from /api/analytics/insights/* — pipeline funnel, per-role
// score distribution, throughput, and an ROI headline that recomputes live from the
// recruiter's OWN editable assumptions (no baked constants). A brand-new account degrades to
// honest empty / insufficient_data states. Charts are dependency-free styled <div> bars to
// match the Benchmarks convention.

const ROI_KEY = 'touchstones.insights.roi-assumptions'
const WINDOWS = [
  { key: 7, label: '7d' },
  { key: 30, label: '30d' },
  { key: 90, label: '90d' },
  { key: 'all', label: 'All' },
]

function humanizeRole(rf) {
  if (!rf) return 'Unspecified'
  return String(rf).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
const fmtInt = (n) => (n == null ? '—' : Number(n).toLocaleString())
const fmtUSD = (n) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString()}`)
const fmtHours = (n) => (n == null ? '—' : `${Number(n).toLocaleString()}h`)
const pctText = (x) => (x == null ? '—' : `${x}%`)
const fmtMins = (m) => (m == null ? '—' : m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${Math.round(m)}m`)

// Mirrors backend analyticsService.computeRoi EXACTLY so the panel live-updates from the
// editable inputs WITHOUT a server round-trip per keystroke. The counts are always the real
// server aggregate; only the arithmetic (inputs × counts) runs here. onsites_avoided is the
// pure completed count (no label correction) and dollars derive from the ROUNDED hours, so
// this reconciles with the API's /insights/roi response.
function computeRoiClient(counts, { hoursPerOnsite, hourlyCost }) {
  const c = counts || {}
  const completed = Number(c.completed) || 0
  const qualified = Number(c.qualified != null ? c.qualified : c.advanced) || 0
  const hpo = Number(hoursPerOnsite) || 0
  const cost = Number(hourlyCost) || 0
  const onsites_avoided = completed
  const hours_saved = Math.round(onsites_avoided * hpo * 10) / 10
  const dollars_saved = Math.round(hours_saved * cost)
  const cost_per_qualified = qualified > 0 ? Math.round((completed * hpo * cost) / qualified) : null
  return { onsites_avoided, hours_saved, dollars_saved, cost_per_qualified }
}

function loadAssumptions() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROI_KEY) || '{}')
    return {
      hoursPerOnsite: Number.isFinite(Number(raw.hoursPerOnsite)) ? Number(raw.hoursPerOnsite) : 4,
      hourlyCost: Number.isFinite(Number(raw.hourlyCost)) ? Number(raw.hourlyCost) : 150,
    }
  } catch {
    return { hoursPerOnsite: 4, hourlyCost: 150 }
  }
}

export default function Insights() {
  const [role, setRole] = useState(null) // null = all roles
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null) // { funnel, throughput, roi, distribution }
  const [allRoles, setAllRoles] = useState([]) // stable, filter-independent option list
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [assumptions, setAssumptions] = useState(loadAssumptions)

  // The role-filter options are fetched ONCE (filter-independent) so selecting a role can't
  // cannibalize the option list.
  useEffect(() => {
    let active = true
    api
      .getInsightsRoles()
      .then((r) => active && setAllRoles(r?.roles || []))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Persist the recruiter's own ROI assumptions (their settings — not hardcoded).
  useEffect(() => {
    try {
      localStorage.setItem(ROI_KEY, JSON.stringify(assumptions))
    } catch {
      /* private mode / quota — non-fatal, defaults still apply */
    }
  }, [assumptions])

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    const filters = { role, days }
    Promise.all([
      api.getInsightsFunnel(filters),
      api.getInsightsThroughput(filters),
      api.getInsightsRoi({ ...filters, ...assumptions }),
      api.getInsightsDistribution(role || '_all'),
    ])
      .then(([funnel, throughput, roi, distribution]) => {
        if (active) setData({ funnel, throughput, roi, distribution })
      })
      .catch((e) => active && setError(e.message || 'Could not load insights.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // assumptions deliberately excluded — ROI recomputes client-side from real counts; we
    // don't re-hit the API on every keystroke. role/days do drive a real reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, days])

  useEffect(() => load(), [load])

  // Stable role options (fetched once); fall back to whatever a response carries.
  const roles = useMemo(() => {
    if (allRoles.length) return allRoles
    return data?.funnel?.roles || data?.throughput?.roles || data?.roi?.roles || []
  }, [allRoles, data])

  if (loading && !data) return <LoadingState />

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <Header />
        <ErrorState className="mt-6" title="Couldn’t load insights" message={error} onRetry={load} />
      </div>
    )
  }

  // "No screens at all" (a brand-new account) → the single intentional empty state. Having
  // screens but none in the selected window is NOT empty — the windowed panels show honest
  // zeros and the all-time distribution still renders.
  const noScreens = !data?.funnel || (data.funnel.screens_total || 0) === 0
  const windowEmpty = !noScreens && (data?.funnel?.total || 0) === 0

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Header />
        {!noScreens && (
          <div className="flex items-center gap-2">
            <RoleFilter role={role} roles={roles} onChange={setRole} />
            <WindowFilter days={days} onChange={setDays} />
          </div>
        )}
      </div>

      {noScreens ? (
        <EmptyState
          className="mt-10"
          icon={<Sparkle size={22} />}
          title="No screens yet"
          hint="Create and send a screen, then your funnel, throughput, score distribution and senior-engineer hours saved show up here — every number traced to a real result, nothing fabricated."
          cta="Create a screen"
          ctaTo="/app/library"
        />
      ) : (
        <>
          {windowEmpty && (
            <p className="mt-6 rounded-xl border border-stone-200 bg-canvas/60 px-4 py-3 text-sm text-stone-600">
              No screen activity in the selected window. The pipeline, throughput and ROI below
              reflect that window; the score distribution is calibrated across all your scored screens.
            </p>
          )}
          <RoiPanel
            counts={data.roi?.counts}
            serverDefaults={data.roi?.defaults}
            insufficient={data.roi?.insufficient_data}
            assumptions={assumptions}
            setAssumptions={setAssumptions}
          />
          <FunnelPanel funnel={data.funnel} />
          <ThroughputPanel throughput={data.throughput} />
          {/* Distribution is the all-time calibration corpus — render regardless of window. */}
          <DistributionPanel distribution={data.distribution} role={role} />
        </>
      )}
    </div>
  )
}

// ── ROI ─────────────────────────────────────────────────────────────────────
function RoiPanel({ counts, serverDefaults, insufficient, assumptions, setAssumptions }) {
  const r = computeRoiClient(counts, assumptions)
  const c = counts || {}
  const set = (k) => (e) => {
    const v = e.target.value
    setAssumptions((a) => ({ ...a, [k]: v === '' ? '' : Math.max(0, Number(v) || 0) }))
  }
  const reset = () =>
    setAssumptions({
      hoursPerOnsite: serverDefaults?.hoursPerOnsite ?? 4,
      hourlyCost: serverDefaults?.hourlyCost ?? 150,
    })

  return (
    <section className="mt-7 rounded-2xl border border-clay-200 bg-clay-50 p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="kicker text-clay-700">
            <Bolt size={13} /> Return on screening
          </span>
          <h2 className="mt-2 font-serif text-xl font-semibold text-ink">Senior-engineer time you didn’t spend</h2>
        </div>
        <button type="button" onClick={reset} className="btn-quiet text-xs text-clay-700 hover:text-clay-900">
          Reset assumptions
        </button>
      </div>

      {insufficient ? (
        <p className="mt-4 rounded-xl border border-clay-200 bg-clay-50/60 px-4 py-3 text-sm text-clay-800">
          No completed screens in this window yet — once candidates finish a screen, your hours and
          dollars saved compute here from the assumptions below.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Headline
            value={fmtHours(r.hours_saved)}
            label="Senior-eng hours saved"
            basis={`${fmtInt(r.onsites_avoided)} completed screens × ${assumptions.hoursPerOnsite || 0}h first-round review`}
          />
          <Headline
            value={fmtUSD(r.dollars_saved)}
            label="Estimated cost avoided"
            basis={`${fmtHours(r.hours_saved)} × $${assumptions.hourlyCost || 0}/h loaded cost`}
          />
          <Headline
            value={r.cost_per_qualified == null ? '—' : fmtUSD(r.cost_per_qualified)}
            label="Onsite cost / qualified candidate"
            basis={
              r.cost_per_qualified == null
                ? 'Needs at least one advanced candidate'
                : `If you onsited all ${fmtInt(c.completed)} to find ${fmtInt(c.qualified)} qualified`
            }
          />
        </div>
      )}

      {/* Editable assumptions — the inputs that live-update every figure above. */}
      <div className="mt-6 grid grid-cols-1 gap-4 border-t border-clay-200/70 pt-5 sm:grid-cols-2">
        <Assumption
          label="Hours per onsite"
          hint="Senior-eng hours a first-round onsite / take-home review costs"
          value={assumptions.hoursPerOnsite}
          onChange={set('hoursPerOnsite')}
          suffix="h"
        />
        <Assumption
          label="Loaded hourly cost"
          hint="Fully-loaded senior-engineer cost per hour"
          value={assumptions.hourlyCost}
          onChange={set('hourlyCost')}
          prefix="$"
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-clay-700/80">
        Each completed screen replaces a first-round technical screen (take-home / phone screen) a
        senior engineer would otherwise run. Counts ({fmtInt(c.completed)} completed ·{' '}
        {fmtInt(c.advanced)} advanced) are real aggregates from your screens; the assumptions above
        are yours, saved to this browser.
      </p>
    </section>
  )
}

function Headline({ value, label, basis }) {
  return (
    <div>
      <p className="font-serif text-4xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-sm font-medium text-clay-900">{label}</p>
      <p className="mt-0.5 text-xs leading-snug text-clay-700/80">{basis}</p>
    </div>
  )
}

function Assumption({ label, hint, value, onChange, prefix, suffix }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-1 flex items-center rounded-lg border border-stone-300 bg-white focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-400">
        {prefix && <span className="pl-3 text-sm text-stone-400">{prefix}</span>}
        <input
          type="number"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={onChange}
          className="w-full bg-transparent px-3 py-2 text-sm tabular-nums text-ink focus:outline-none"
        />
        {suffix && <span className="pr-3 text-sm text-stone-400">{suffix}</span>}
      </span>
      <span className="mt-1 block text-xs text-clay-700/70">{hint}</span>
    </label>
  )
}

// ── Funnel ──────────────────────────────────────────────────────────────────
function FunnelPanel({ funnel }) {
  const stages = funnel?.stages || []
  const top = funnel?.total || 0
  const biggest = funnel?.biggest_dropoff
  return (
    <section className="mt-6 card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-ink">
          <Compass size={16} className="mr-1.5 inline text-clay-500" /> Pipeline funnel
        </h2>
        <p className="text-xs text-stone-500">
          {fmtInt(top)} screens sent
          {biggest && (
            <>
              {' · '}biggest drop-off{' '}
              <span className="font-semibold text-ink">
                {humanizeStage(biggest.from)} → {humanizeStage(biggest.to)}
              </span>{' '}
              (−{fmtInt(biggest.lost)})
            </>
          )}
        </p>
      </div>

      <div className="mt-5 space-y-2.5">
        {stages.map((s, i) => {
          const widthPct = s.conversion_from_top ?? 0
          const isLeak = biggest && biggest.to === s.key
          return (
            <div key={s.key} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-right text-xs font-medium text-stone-600">{s.label}</div>
              <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-stone-100">
                <div
                  className={`h-full rounded-lg ${isLeak ? 'bg-clay-300' : 'bg-clay-400/80'}`}
                  style={{ width: `${s.count > 0 ? Math.max(2, widthPct) : 0}%` }}
                  title={`${s.label}: ${s.count} (${s.basis})`}
                />
                <span className="absolute inset-y-0 left-2.5 flex items-center text-xs font-semibold tabular-nums text-ink">
                  {fmtInt(s.count)}
                </span>
              </div>
              <div className="w-14 shrink-0 text-right text-xs tabular-nums text-stone-500">
                {i === 0 ? '—' : pctText(s.conversion_from_prev)}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-[0.7rem] leading-relaxed text-stone-400">
        Right column = conversion from the previous stage. Stages 5–8 (advanced → stayed-90d) come from
        the outcomes you record; label more results to complete the funnel.
      </p>
    </section>
  )
}
function humanizeStage(key) {
  const map = {
    created: 'Sent',
    started: 'Started',
    submitted: 'Submitted',
    scored: 'Scored',
    advanced: 'Advanced',
    offer: 'Offer',
    hired: 'Hired',
    retained_90d: 'Stayed 90d',
  }
  return map[key] || key
}

// ── Throughput ──────────────────────────────────────────────────────────────
function ThroughputPanel({ throughput }) {
  const t = throughput || {}
  const vol = t.volume || []
  return (
    <section className="mt-6 card p-6">
      <h2 className="font-serif text-lg font-semibold text-ink">
        <Clock size={16} className="mr-1.5 inline text-clay-500" /> Throughput &amp; time
      </h2>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TimeStat
          value={fmtMins(t.median_minutes_to_submit)}
          label="Median time to submit"
          basis={`assignment → submit · n=${t.samples?.to_submit ?? 0}`}
        />
        <TimeStat
          value={fmtMins(t.median_minutes_to_score)}
          label="Median time to score"
          basis={`submit → scored · n=${t.samples?.to_score ?? 0}`}
        />
        <TimeStat
          value={t.median_hours_to_decision == null ? '—' : `${t.median_hours_to_decision}h`}
          label="Median time to decision"
          basis={`submit → outcome · n=${t.samples?.to_decision ?? 0}`}
        />
      </div>
      {vol.length > 0 ? (
        <div className="mt-6">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Volume over window
          </span>
          <VolumeBars volume={vol} />
        </div>
      ) : (
        <p className="mt-5 text-sm text-stone-400">No volume in this window yet.</p>
      )}
    </section>
  )
}
function TimeStat({ value, label, basis }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-canvas/50 p-4">
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-sm text-stone-600">{label}</p>
      <p className="mt-0.5 text-xs text-stone-400">{basis}</p>
    </div>
  )
}
function VolumeBars({ volume }) {
  const max = Math.max(1, ...volume.map((d) => d.created || 0))
  return (
    <div className="mt-3">
      <div className="flex h-28 items-end gap-1">
        {volume.map((d) => {
          const h = Math.round(((d.created || 0) / max) * 100)
          return (
            <div key={d.date} className="group flex flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-clay-400/70 transition-colors group-hover:bg-clay-500"
                style={{ height: `${d.created > 0 ? Math.max(3, h) : 0}%` }}
                title={`${d.date}: ${d.created} sent · ${d.submitted} submitted · ${d.scored} scored`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between border-t border-stone-200 pt-1.5 text-[0.6rem] tabular-nums text-stone-400">
        <span>{volume[0]?.date}</span>
        {volume.length > 1 && <span>{volume[volume.length - 1]?.date}</span>}
      </div>
    </div>
  )
}

// ── Distribution (reuses the calibration engine) ──────────────────────────────
function DistributionPanel({ distribution, role }) {
  const d = distribution || {}
  const bins = d.distribution || []
  const total = bins.reduce((a, b) => a + (b.n || 0), 0)
  const p = d.percentiles || {}
  const bands = d.buckets || []
  const minBand = d.thresholds?.min_band_sample ?? 8

  return (
    <section className="mt-6 card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-ink">
          <Sparkle size={16} className="mr-1.5 inline text-clay-500" /> Score distribution
          <span className="ml-2 text-sm font-normal text-stone-500">· {humanizeRole(role)} · all-time</span>
        </h2>
        <Link to="/app/benchmarks" className="inline-flex items-center gap-1 text-xs font-medium text-clay-700 hover:text-clay-800">
          Full benchmarks <ArrowRight size={13} />
        </Link>
      </div>

      {total === 0 ? (
        <p className="mt-5 text-sm text-stone-400">No scored screens in this role yet.</p>
      ) : (
        <>
          <div className="mt-5">
            <div className="flex h-40 items-end gap-1.5">
              {bins.map((b) => {
                const max = Math.max(1, ...bins.map((x) => x.n || 0))
                const h = Math.round(((b.n || 0) / max) * 100)
                return (
                  <div key={b.label} className="group flex flex-1 flex-col items-center justify-end">
                    <span className="mb-1 text-[0.6rem] tabular-nums text-stone-400 opacity-0 transition-opacity group-hover:opacity-100">
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
              <span className="font-semibold tabular-nums text-ink">{p.p50 ?? '—'}</span> · your bar (p90){' '}
              <span className="font-semibold tabular-nums text-ink">{p.p90 ?? '—'}</span>
            </p>
          </div>

          {d.sample_size < minBand && (
            <div className="mt-4 rounded-xl border border-stone-200 bg-canvas/60 px-4 py-3 text-sm text-stone-600">
              <ShieldCheck size={14} className="mr-1.5 inline text-clay-500" />
              Low sample — outcome bands fill in honestly as you record more results; we never fabricate a
              rate.
            </div>
          )}

          {bands.length > 0 && (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {bands.map((b) => (
                <BandCard key={b.bucket} band={b} minBand={minBand} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
function BandCard({ band, minBand }) {
  const label = (band.bucket || '').replace('-', '–')
  return (
    <div className="rounded-xl border border-stone-200 bg-canvas/50 p-4">
      <div className="flex items-center justify-between">
        <span className="font-serif text-base font-semibold text-ink">{label}</span>
        <span className="text-xs text-stone-400">n={band.n}</span>
      </div>
      {band.sufficient ? (
        <dl className="mt-3 space-y-1.5">
          <BandRow label="Advanced" value={pctText(band.advanced_rate)} n={band.advanced_n} />
          <BandRow label="Offer" value={pctText(band.offer_rate)} n={band.offer_n} />
          <BandRow label="Hired" value={pctText(band.hire_rate)} n={band.hire_n} />
        </dl>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Not enough labeled outcomes yet{minBand ? ` (need ${minBand}+).` : '.'}
        </p>
      )}
    </div>
  )
}
function BandRow({ label, value, n }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
        {n != null && <span className="text-[0.6rem] tabular-nums text-stone-400">n={n}</span>}
      </dd>
    </div>
  )
}

// ── filters + chrome ──────────────────────────────────────────────────────────
function RoleFilter({ role, roles, onChange }) {
  if (!roles || roles.length === 0) return null
  return (
    <select
      value={role || '__all'}
      onChange={(e) => onChange(e.target.value === '__all' ? null : e.target.value)}
      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-clay-400 focus:outline-none focus:ring-1 focus:ring-clay-400"
      aria-label="Filter by role"
    >
      <option value="__all">All roles</option>
      {roles.map((r) => (
        <option key={r} value={r}>
          {humanizeRole(r)}
        </option>
      ))}
    </select>
  )
}
function WindowFilter({ days, onChange }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-stone-300">
      {WINDOWS.map((w) => (
        <button
          key={w.key}
          type="button"
          onClick={() => onChange(w.key)}
          className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
            days === w.key ? 'bg-clay-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Insights</h1>
      <p className="mt-1 max-w-xl text-sm text-stone-600">
        What your screens are doing for your hiring funnel — pipeline conversion, score
        distribution, throughput, and the senior-engineer time you’ve saved. Every number is a real
        aggregate of your own results.
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="h-8 w-40 animate-pulse rounded bg-stone-200/70" />
      <div className="mt-8 h-40 animate-pulse rounded-2xl bg-stone-200/50" />
      <div className="mt-6 h-56 animate-pulse rounded-2xl bg-stone-200/50" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-200/50" />
        ))}
      </div>
    </div>
  )
}
