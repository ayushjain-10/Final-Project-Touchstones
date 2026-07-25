import { Check, FileText } from './icons.jsx'
import { coverageOf, COVERAGE_LABEL } from '../lib/deliverablesCoverage.js'

// Deliverables review (TOU-146): the screen's checklist with the candidate's own self-check
// state, plus a LIGHTWEIGHT textual coverage heuristic imported from lib/deliverablesCoverage.js.
// That module is shared with the candidate's own "Check coverage" console pane so the two sides
// can never disagree about an item. It is a reading aid for the human reviewer, clearly labeled
// as a heuristic. Never a score, never pass/fail.

const COVERAGE_CHIP = {
  mentioned: { label: COVERAGE_LABEL.mentioned, cls: 'bg-clay-50 text-clay-700 ring-clay-200' },
  'not-found': { label: COVERAGE_LABEL['not-found'], cls: 'bg-amber-50 text-amber-800 ring-amber-100' },
  'no-signal': { label: COVERAGE_LABEL['no-signal'], cls: 'bg-stone-50 text-stone-500 ring-stone-200' },
}

export default function DeliverablesReviewCard({ deliverables, checked, text }) {
  const items = Array.isArray(deliverables) ? deliverables : []
  if (!items.length) return null
  const checkedSet = new Set(Array.isArray(checked) ? checked : [])
  const textLower = String(text || '').toLowerCase()
  const tickedCount = items.filter((_, i) => checkedSet.has(i)).length

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-ink">Deliverables</h3>
        <span className="text-xs text-stone-400">
          {tickedCount}/{items.length} self-checked
        </span>
      </div>
      <p className="mt-2 inline-flex items-start gap-1.5 text-xs leading-relaxed text-stone-500">
        <FileText size={13} className="mt-0.5 shrink-0 text-clay-500" />
        <span>
          The candidate&apos;s own tick-offs, plus a keyword-presence check against their
          submission. A heuristic aid for your review, not a score, never pass/fail.
        </span>
      </p>
      <ul className="mt-3 divide-y divide-stone-200">
        {items.map((item, i) => {
          const ticked = checkedSet.has(i)
          const chip = COVERAGE_CHIP[coverageOf(item, textLower)]
          return (
            <li key={i} className="flex items-start gap-2.5 py-2.5">
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                  ticked ? 'border-clay-500 bg-clay-500 text-white' : 'border-stone-300 bg-white'
                }`}
              >
                {ticked && <Check size={11} />}
              </span>
              <div className="min-w-0 flex-1">
                {/* Recruiter-authored + candidate-derived strings render as TEXT, never HTML. */}
                <p className="text-sm text-stone-700">{item}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-stone-400">
                    {ticked ? 'Self-checked by the candidate' : 'Not marked by the candidate'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${chip.cls}`}>
                    {chip.label}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
