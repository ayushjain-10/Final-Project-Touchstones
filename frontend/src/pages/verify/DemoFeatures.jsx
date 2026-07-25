import CalibrationBadge from '../../components/CalibrationBadge.jsx'

// DemoFeatures — a PUBLIC, no-auth, static demo of the two ML deliverables (course project):
//   1. Cold-start calibration (empirical-Bayes shrinkage) — the real CalibrationBadge component,
//      fed the exact calibration objects the API emits at three points in a recruiter's timeline.
//   2. Subgroup fairness (EEOC four-fifths) — the numbers produced by backend/eval/fairness-fourfifths.mjs.
// Lives outside the app gate (like /sample-report) so it renders with no backend, DB, or login —
// reliable for a recorded demo. Numbers are the real, reproducible outputs of the eval harnesses.

// Real shrinkRate() outputs (priorMean 0.70; seed-independent, pure math) at three label counts.
const COLD = {
  day1: {
    role_family: 'backend', scope: 'heuristic', insufficient_data: true,
    sample_size: 0, cohort_size: 0, percentile: null, top_percent: null,
    band: null, overall: {}, lift: { advanced: null },
    likelihood: { label: 'Strong score', basis: 'score_only', confidence: 'uncalibrated' },
    estimate: { advanced_rate: 70, ci_low: 34.9, ci_high: 95.4, tier: 'prior', n: 0, prior_mean: 70, prior_strength: 5 },
  },
  week2: {
    role_family: 'backend', scope: 'role', insufficient_data: true,
    sample_size: 4, cohort_size: 19, percentile: 82, top_percent: 18,
    band: { bucket: '80-100', n: 4, sufficient: false, advanced_rate: 75, advanced_n: 4, offer_rate: null, offer_n: 0, hire_rate: null, hire_n: 0, retention_90d_rate: null, retention_90d_n: 0 },
    overall: { advanced_rate: 52 }, lift: { advanced: null },
    likelihood: { label: 'Strong relative score', basis: 'percentile', confidence: 'uncalibrated' },
    estimate: { advanced_rate: 72.2, ci_low: 46.2, ci_high: 92.4, tier: 'provisional', n: 4, prior_mean: 70, prior_strength: 5 },
  },
  month2: {
    role_family: 'backend', scope: 'role', insufficient_data: false,
    sample_size: 40, cohort_size: 120, percentile: 83, top_percent: 17,
    band: { bucket: '80-100', n: 40, sufficient: true, advanced_rate: 72.5, advanced_n: 40, offer_rate: 38, offer_n: 34, hire_rate: 22, hire_n: 30, retention_90d_rate: null, retention_90d_n: 0 },
    overall: { advanced_rate: 52 }, lift: { advanced: 1.4 },
    likelihood: { label: 'Likely to clear an onsite', basis: 'outcome', confidence: 'calibrated' },
    estimate: { advanced_rate: 72.2, ci_low: 60.8, ci_high: 82.5, tier: 'calibrated', n: 40, prior_mean: 70, prior_strength: 5 },
  },
}

// Real four-fifths outputs from backend/eval/fairness-fourfifths.mjs (seed 19780828, n=500/group).
const FAIR = {
  blind: [
    { value: 'Group A', rate: 65.2, ratio: 1.0 },
    { value: 'Group B', rate: 57.0, ratio: 0.87 },
    { value: 'Group C', rate: 60.4, ratio: 0.93 },
    { value: 'Group D', rate: 60.6, ratio: 0.93 },
  ],
  biased: [
    { value: 'Group A', rate: 57.8, ratio: 0.93 },
    { value: 'Group B', rate: 61.6, ratio: 0.99 },
    { value: 'Group C', rate: 62.0, ratio: 1.0 },
    { value: 'Group D', rate: 21.8, ratio: 0.35 },
  ],
}

function Ratio({ r }) {
  const flagged = r != null && r < 0.8
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${flagged ? 'bg-[#f6e4de] text-[#8C2F1D]' : 'bg-clay-50 text-clay-700'}`}>
      {r == null ? '—' : r.toFixed(2)}
      {flagged && ' ⚑'}
    </span>
  )
}

function FairnessTable({ title, rows, verdict, flagged }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h4 className="font-serif text-lg text-ink">{title}</h4>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${flagged ? 'bg-[#f6e4de] text-[#8C2F1D]' : 'bg-clay-50 text-clay-700'}`}>{verdict}</span>
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
            <th className="pb-1 font-medium">Subgroup</th>
            <th className="pb-1 font-medium">Selection rate</th>
            <th className="pb-1 font-medium">Impact ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.value} className="border-t border-stone-100">
              <td className="py-1.5 text-ink">{g.value}</td>
              <td className="py-1.5 text-stone-600">{g.rate.toFixed(1)}%</td>
              <td className="py-1.5"><Ratio r={g.ratio} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DemoFeatures() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-6xl px-6 py-12">
        {/* Hero */}
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-clay-500">Touchstones · ML project demo</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold leading-tight">Verified real-work screening in the AI era</h1>
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-stone-600">
          AI is allowed. A short, messy work-sample task is scored <em>in code</em> from a rubric, tied to a
          server-attributed proof-of-human, and returned as one explainable, audit-ready score. This page demonstrates
          the two statistical guarantees behind that score: <strong>calibration that works from day one</strong> and
          <strong> subgroup fairness checked from day one</strong>.
        </p>

        {/* Feature 1 — cold start */}
        <section className="mt-12">
          <h2 className="font-serif text-2xl font-semibold">1 · Calibration under cold start</h2>
          <p className="mt-2 max-w-3xl text-stone-600">
            Outcome-calibrated bands (advanced / offer / hired / retained) need real downstream labels, which do not
            exist early on. Instead of dead-ending at “insufficient data”, we return a Beta-Binomial posterior: a
            documented per-band prior shrunk toward whatever outcomes exist, tiered honestly and carrying a 90% credible
            interval that <em>narrows as data arrives</em>. The same badge, at three points in a recruiter’s timeline:
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Day 1 · no outcomes yet</p>
              <CalibrationBadge calibration={COLD.day1} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Week 2 · 4 outcomes</p>
              <CalibrationBadge calibration={COLD.week2} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Month 2 · 40 outcomes</p>
              <CalibrationBadge calibration={COLD.month2} />
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <figure className="card p-4">
              <img src="/demo/coldstart-accuracy.svg" alt="Cold-start accuracy" className="w-full" />
              <figcaption className="mt-2 text-xs text-stone-500">
                Simulation (4,000 trials/band): the shrinkage posterior cuts mean-absolute error by ~57% when labels are
                scarce and converges to the raw rate as data accrues.
              </figcaption>
            </figure>
            <figure className="card p-4">
              <img src="/demo/coldstart-availability.svg" alt="Cold-start availability" className="w-full" />
              <figcaption className="mt-2 text-xs text-stone-500">
                The raw band is suppressed until it has 8 labeled outcomes; the shrinkage estimate is always available,
                tiered prior → provisional → calibrated.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Feature 2 — fairness */}
        <section className="mt-14">
          <h2 className="font-serif text-2xl font-semibold">2 · Subgroup fairness (EEOC four-fifths)</h2>
          <p className="mt-2 max-w-3xl text-stone-600">
            Scoring is attribute-blind by construction. We verify that on synthetic cohorts <em>now</em>, before real
            labels exist: a blind scorer holds every subgroup at or above the 0.80 four-fifths threshold, while a
            deliberately biased scorer is detected and flagged. Small groups are suppressed for privacy.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <FairnessTable title="Blind scorer" rows={FAIR.blind} verdict="Passes · min 0.87" flagged={false} />
            <FairnessTable title="Biased scorer (counterfactual)" rows={FAIR.biased} verdict="Flagged · Group D 0.35" flagged />
          </div>
          <figure className="card mt-6 p-4">
            <img src="/demo/fairness-fourfifths.svg" alt="Adverse-impact ratios by subgroup" className="mx-auto w-full max-w-3xl" />
            <figcaption className="mt-2 text-xs text-stone-500">
              Impact ratio = group selection rate ÷ the highest group’s rate. Below 0.80 flags potential adverse impact.
              Group labels are employer-provided and opt-in; Touchstones never collects or infers protected attributes,
              and labels never affect scoring. Decision-support, not a legal certification.
            </figcaption>
          </figure>
        </section>

        <p className="mt-12 border-t border-stone-200 pt-4 text-xs text-stone-400">
          Numbers on this page are the reproducible outputs of <code>backend/eval/calibration-coldstart.mjs</code> and
          <code> backend/eval/fairness-fourfifths.mjs</code>. Real work. Real person. Provable.
        </p>
      </div>
    </div>
  )
}
