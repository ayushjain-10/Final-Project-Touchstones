// Per-case test results (LeetCode-style). Visible "sample" cases show input / expected / your
// output; hidden cases (redacted server-side for candidates) show only pass/fail. Used by both the
// candidate IDE (sample cases on Run) and the recruiter result page (all cases).
function fmt(v) {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export default function TestCaseResults({ result, className = '' }) {
  if (!result || !Array.isArray(result.cases) || result.cases.length === 0) return null
  const { cases, passedCount, total } = result
  const allPassed = passedCount === total
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <p className={`text-sm font-semibold ${allPassed ? 'text-clay-700' : 'text-amber-700'}`}>
          {passedCount}/{total} {total === 1 ? 'case' : 'cases'} passed
        </p>
        {result.timedOut && <span className="text-xs font-medium text-amber-700">time limit exceeded</span>}
      </div>
      <ul className="mt-3 space-y-2">
        {cases.map((c, i) => {
          const hasDetail = 'input' in c || 'expected' in c
          return (
            <li
              key={i}
              className={`rounded-xl border px-3 py-2 ${
                c.passed ? 'border-clay-200 bg-clay-50/60' : 'border-amber-200 bg-amber-50/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                  <span className={c.passed ? 'text-clay-600' : 'text-amber-600'}>{c.passed ? '✓' : '✕'}</span>
                  {c.name || `Test ${i + 1}`}
                </span>
                <span className={`text-xs font-medium ${c.passed ? 'text-clay-700' : 'text-amber-700'}`}>
                  {c.passed ? 'Passed' : 'Failed'}
                </span>
              </div>
              {hasDetail && (
                <div className="mt-1.5 space-y-0.5 break-words font-mono text-[11px] leading-relaxed text-stone-600">
                  <div>
                    <span className="text-stone-400">input:</span> {fmt(c.input)}
                  </div>
                  <div>
                    <span className="text-stone-400">expected:</span> {fmt(c.expected)}
                  </div>
                  {!c.passed && (
                    <div>
                      <span className="text-stone-400">got:</span> {fmt(c.got)}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
