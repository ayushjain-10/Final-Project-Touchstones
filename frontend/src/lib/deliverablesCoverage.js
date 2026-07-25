// Shared deliverables coverage heuristic (TOU-146 / TOU-162).
//
// ONE source of truth, used by BOTH sides so they can never disagree:
//   - the candidate's console pane on a written screen ("Check coverage")
//   - the recruiter's DeliverablesReviewCard on the result view
// If a candidate is told an item's terms were found, the recruiter must see the same verdict.
//
// It is deliberately modest: case-insensitive keyword presence of each item's salient terms.
// No AI, no weighting, no scoring. It is a reading aid for a human, never pass/fail, and it
// never leaks the hidden rubric (it only ever looks at the PUBLIC deliverables checklist).

// Common words that carry no signal for keyword matching.
const STOPWORDS = new Set([
  'the', 'and', 'that', 'with', 'this', 'from', 'your', 'have', 'will', 'must',
  'should', 'would', 'could', 'into', 'each', 'every', 'them', 'they', 'their',
  'when', 'what', 'which', 'where', 'here', 'there', 'then', 'than', 'also',
  'least', 'include', 'includes', 'including', 'included', 'make', 'made',
  'state', 'stated', 'provide', 'provided', 'write', 'written', 'show', 'shown',
  'explain', 'explained', 'describe', 'described', 'add', 'added', 'using', 'used',
])

/** Salient terms of a checklist item: lowercase words of 4+ chars, minus stopwords. */
export function salientTerms(item) {
  return [...new Set(
    String(item || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  )]
}

/** 'mentioned' | 'not-found' | 'no-signal' (an item with no salient terms can't be matched). */
export function coverageOf(item, textLower) {
  const terms = salientTerms(item)
  if (!terms.length || !textLower) return 'no-signal'
  const hits = terms.filter((t) => textLower.includes(t)).length
  return hits * 2 >= terms.length ? 'mentioned' : 'not-found'
}

/** Coverage for a whole checklist against one body of text. */
export function coverageReport(deliverables, text) {
  const items = Array.isArray(deliverables) ? deliverables : []
  const textLower = String(text || '').toLowerCase()
  const rows = items.map((item, i) => ({ index: i, item, coverage: coverageOf(item, textLower) }))
  return {
    rows,
    mentioned: rows.filter((r) => r.coverage === 'mentioned').length,
    total: rows.length,
  }
}

export const COVERAGE_LABEL = {
  mentioned: 'terms found',
  'not-found': 'terms not found',
  'no-signal': 'no keyword signal',
}
