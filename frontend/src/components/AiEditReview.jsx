import { useEffect, useMemo, useRef } from 'react'
import { Sparkle, Check, X } from './icons.jsx'

// Cursor-style review of an AI-suggested edit: a unified line diff of the candidate's
// current buffer vs. the assistant's proposal, with explicit Accept / Reject. Nothing
// touches the editor until the candidate accepts — "AI is allowed, verify it" made
// concrete. Additions read in clay, removals in flag red (design system: no green).
//
// Props:
//   original  string  the code currently in the editor (or response text)
//   proposed  string  the assistant's suggested replacement
//   onAccept  ()      apply the proposal (parent records disposition 'accepted')
//   onReject  ()      dismiss it (parent records disposition 'rejected')
//   fill      bool    fill parent height (IDE pane) instead of a bounded card
//   fused     bool    card-bottom variant (no top rounding) for slots under a fused
//                     rounded-t-2xl/border-b-0 header, like the written-task response card

// Unified line diff. Common prefix/suffix are trimmed first so the LCS table only
// covers the edited middle — tiny for the single-function edits the assistant makes.
// Above the size guard we degrade to delete-all/add-all rather than freeze the tab.
function diffLines(original, proposed) {
  const A = String(original ?? '').split('\n')
  const B = String(proposed ?? '').split('\n')
  const rows = []
  const push = (type, text) => rows.push({ type, text })

  let start = 0
  while (start < A.length && start < B.length && A[start] === B[start]) start++
  let endA = A.length
  let endB = B.length
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--
    endB--
  }
  const midA = A.slice(start, endA)
  const midB = B.slice(start, endB)
  const n = midA.length
  const m = midB.length

  for (let i = 0; i < start; i++) push('ctx', A[i])

  if (n * m > 250000) {
    midA.forEach((t) => push('del', t))
    midB.forEach((t) => push('add', t))
  } else if (n || m) {
    // LCS lengths, then walk back to emit del/add/ctx runs.
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push('ctx', midA[i])
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        push('del', midA[i])
        i++
      } else {
        push('add', midB[j])
        j++
      }
    }
    while (i < n) push('del', midA[i++])
    while (j < m) push('add', midB[j++])
  }

  for (let k = endA; k < A.length; k++) push('ctx', A[k])
  return rows
}

const ROW_STYLES = {
  add: 'bg-clay-50 text-clay-800 dark:bg-clay-500/10 dark:text-[#C8CEFA]',
  del: 'bg-flag-50 text-flag-700 opacity-75 dark:bg-flag-500/10 dark:text-[#F0846A]',
  ctx: 'text-stone-600 dark:text-[#AEB7D0]',
}
const ROW_MARKERS = { add: '+', del: '−', ctx: ' ' }

export default function AiEditReview({ original, proposed, onAccept, onReject, fill = false, fused = false }) {
  const rows = useMemo(() => diffLines(original, proposed), [original, proposed])
  const added = useMemo(() => rows.filter((r) => r.type === 'add').length, [rows])
  const removed = useMemo(() => rows.filter((r) => r.type === 'del').length, [rows])
  const noChanges = added === 0 && removed === 0

  // The review replaces the editor with no other cue — move focus here so keyboard and
  // screen-reader users land on the pane (and can scroll the diff, which has no focusable children).
  const diffRef = useRef(null)
  useEffect(() => {
    diffRef.current?.focus()
  }, [])

  const frame = fill
    ? 'h-full min-h-0'
    : fused
      ? 'min-h-[360px] rounded-b-2xl border border-stone-200 shadow-card'
      : 'min-h-[360px] rounded-2xl border border-stone-200 shadow-card'

  return (
    <div className={`flex flex-col overflow-hidden bg-canvas dark:bg-[#11182B] ${frame}`}>
      {/* Review bar — the accept/deny decision lives here */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-clay-200 bg-clay-50 px-4 py-2.5 dark:border-clay-500/30 dark:bg-clay-500/10">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink dark:text-[#F4F6FF]">
          <Sparkle size={15} className="text-clay-500" /> AI suggested edit
          <span className="text-xs font-normal text-stone-500 dark:text-[#AEB7D0]">
            <span className="text-clay-700 dark:text-[#C8CEFA]">+{added}</span>{' '}
            <span className="text-flag-700 dark:text-[#F0846A]">&minus;{removed}</span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500 dark:text-[#AEB7D0]">
            Nothing changes until you accept
          </span>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:border-flag-500 hover:text-flag-700 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#AEB7D0] dark:hover:border-flag-500/50 dark:hover:text-[#F0846A]"
          >
            <X size={13} /> Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="inline-flex items-center gap-1 rounded-lg bg-clay-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-clay-600"
          >
            <Check size={13} /> Accept
          </button>
        </div>
      </div>

      {/* Unified diff */}
      <div
        ref={diffRef}
        tabIndex={0}
        role="region"
        aria-label="AI suggested edit: diff of your code against the suggestion"
        className="min-h-0 flex-1 overflow-auto py-2 font-mono text-[13px] leading-[1.7] focus:outline-none focus-visible:ring-2 focus-visible:ring-clay-400"
      >
        {noChanges && (
          <p className="mx-3 mb-2 rounded-lg bg-stone-100 px-3 py-2 font-sans text-xs text-stone-600 dark:bg-[#18213A] dark:text-[#AEB7D0]">
            No changes: this suggestion matches your current code, so accepting won&rsquo;t alter anything.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={i} className={`flex px-3 ${ROW_STYLES[r.type]}`}>
            <span className="w-5 shrink-0 select-none text-center">{ROW_MARKERS[r.type]}</span>
            <span className="whitespace-pre-wrap break-words">{r.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
