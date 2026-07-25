import ScoreRing from './ScoreRing.jsx'
import CriterionBar from './CriterionBar.jsx'
import VerifiedBadge from './VerifiedBadge.jsx'
import { Pill } from './primitives.jsx'
import { Check, Download, Clock, Sparkle, FileText } from './icons.jsx'

// A demo result used across the marketing site and the in-app screens so the
// "product is the hero" everywhere it appears. Criteria sum to the score.
export const sampleResult = {
  role: 'Senior Backend Engineer',
  reqId: 'ENG-204',
  task: 'Debug a failing payments service',
  candidate: 'Candidate A4F9',
  score: 92,
  verdict: 'Strong evidence',
  verification: 'verified',
  durationMin: 34,
  aiNote: 'AI allowed: used for boilerplate and directed well.',
  criteria: [
    {
      label: 'Problem decomposition',
      points: '24 / 25',
      pct: 96,
      note: 'Broke the outage into reproduce → isolate → fix before touching code.',
    },
    {
      label: 'Correctness under edge cases',
      points: '21 / 25',
      pct: 84,
      note: 'Handled retries and partial failures; missed one timezone boundary.',
    },
    {
      label: 'Code quality & tests',
      points: '22 / 25',
      pct: 88,
      note: 'Added 7 tests including the original failing case.',
    },
    {
      label: 'Debugging & root cause',
      points: '25 / 25',
      pct: 100,
      note: 'Reproduced the race condition before proposing a fix.',
    },
  ],
  reasoning:
    'AI evaluates each criterion against the work evidence. The weighted total is calculated in code and provenance-logged.',
  evidence: [
    'Reproduced the failure before editing',
    'Added 7 tests incl. the failing case',
    'Refactored the retry/idempotency path',
  ],
}

function MetaRow({ data }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-500">
      <span className="inline-flex items-center gap-1.5">
        <Clock size={14} /> {data.durationMin} min
      </span>
      <span className="text-stone-300">·</span>
      <span className="inline-flex items-center gap-1.5">
        <Sparkle size={14} /> {data.aiNote}
      </span>
    </div>
  )
}

// `variant`: 'compact' (hero) shows ring + verdict + bars. 'full' adds reasoning,
// evidence and the audit-export footer.
export default function ResultCard({
  data = sampleResult,
  variant = 'full',
  className = '',
  onExport,
  exporting = false,
}) {
  const compact = variant === 'compact'
  const criteria = Array.isArray(data.criteria) ? data.criteria : []
  const evidence = Array.isArray(data.evidence) ? data.evidence : []
  return (
    <div className={`card overflow-hidden ${className}`}>
      {/* Header */}
      <div
        className={`flex items-start justify-between gap-4 border-b border-stone-200 bg-canvas/70 px-6 ${
          compact ? 'py-4' : 'py-5'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <Pill tone="neutral" className="font-mono">
              req #{data.reqId}
            </Pill>
            <span className="text-xs text-stone-400">{data.candidate}</span>
          </div>
          <h3 className="mt-2 font-serif text-lg font-semibold text-ink">{data.task}</h3>
          <p className="text-sm text-stone-500">{data.role}</p>
        </div>
        <VerifiedBadge state={data.verification} size="sm" />
      </div>

      {/* Score + verdict */}
      <div
        className={`flex flex-col items-center px-5 text-center sm:flex-row sm:px-6 sm:text-left ${
          compact ? 'gap-4 py-5' : 'gap-6 py-6'
        }`}
      >
        <ScoreRing value={data.score} size={compact ? 112 : 150} stroke={compact ? 10 : 12} />
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 ring-1 ring-brand-200">
            <Check size={15} /> {data.verdict}
          </span>
          {/* The full card carries this line; the compact preview stays short. */}
          {!compact && (
            <p className="mt-3 text-sm leading-relaxed text-stone-600">
              AI evaluates each criterion against the work evidence. The weighted total is
              calculated in code and provenance-logged.
            </p>
          )}
          <div className={compact ? 'mt-2.5' : 'mt-3'}>
            <MetaRow data={data} />
          </div>
        </div>
      </div>

      {/* Criteria */}
      <div
        className={`border-t border-stone-200 px-6 ${compact ? 'space-y-3 py-5' : 'space-y-4 py-6'}`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          Scored against the rubric
        </p>
        {criteria.length === 0 ? (
          <p className="text-sm text-stone-500">
            No per-criterion breakdown is available for this result.
          </p>
        ) : (
          (compact ? criteria.slice(0, 3) : criteria).map((c, i) => (
            <CriterionBar
              key={c.id ?? `${c.label}-${i}`}
              label={c.label}
              points={c.points}
              pct={c.pct}
              note={compact ? undefined : c.note}
              delay={i * 90}
            />
          ))
        )}
      </div>

      {/* Full-only: reasoning, evidence, audit export */}
      {!compact && (
        <>
          <div className="border-t border-stone-200 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
              Why this score
            </p>
            <p className="mt-3 text-sm leading-relaxed text-stone-700">{data.reasoning}</p>
            {evidence.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {evidence.map((e, i) => (
                  <Pill key={`${e}-${i}`} tone="white">
                    <Check size={13} className="text-brand-500" /> {e}
                  </Pill>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-canvas/70 px-6 py-4">
            <span className="inline-flex items-center gap-2 text-xs text-stone-500">
              <FileText size={15} /> Explainable and logged. Exportable audit trail.
            </span>
            {onExport && (
              <button
                type="button"
                onClick={onExport}
                disabled={exporting}
                className="btn-ghost px-4 py-2 text-xs disabled:opacity-50"
              >
                <Download size={15} /> {exporting ? 'Exporting…' : 'Export audit trail'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
