import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  FileText,
  Plus,
  X,
} from '../../components/icons.jsx'
import { api } from '../../services/api.js'
import { toResultCardData } from '../../services/proofMappers.js'
import EvidenceNetwork from '../../components/EvidenceNetwork.jsx'

const STATE_OPTIONS = [
  { value: 'all', label: 'All states' },
  { value: 'evidence_ready', label: 'Evidence ready' },
  { value: 'review_flagged', label: 'Review flagged' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_candidate', label: 'Awaiting candidate' },
]

const STATUS_META = {
  evidence_ready: {
    label: 'Evidence ready',
    dot: 'bg-success-500',
    className: 'border-success-200 bg-success-50 text-success-700',
  },
  review_flagged: {
    label: 'Review flagged',
    dot: 'bg-danger-500',
    className: 'border-danger-200 bg-danger-50 text-danger-700',
  },
  in_progress: {
    label: 'In progress',
    dot: 'bg-warning-500',
    className: 'border-warning-200 bg-warning-50 text-warning-700',
  },
  awaiting_candidate: {
    label: 'Awaiting candidate',
    dot: 'bg-brand-500',
    className: 'border-brand-200 bg-brand-50 text-brand-700',
  },
}

function rowKey(row) {
  return String(row?.key || row?.submissionId || row?.workSampleId || row?.id || '')
}

function screenKeyForRow(row) {
  if (row?.workSampleId) return String(row.workSampleId)
  return `preview:${row?.role || row?.task || rowKey(row)}`
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function stateForRow(row) {
  if (row?.awaiting) return 'awaiting_candidate'
  if (row?.state === 'flagged' || row?.state === 'review' || row?.reviewFlagged) return 'review_flagged'
  if (row?.scored || finiteNumber(row?.score) != null) return 'evidence_ready'
  if (!row?.submissionId) return 'awaiting_candidate'
  return 'in_progress'
}

function scoreLabel(value) {
  const score = finiteNumber(value)
  return score != null ? String(Math.round(score)) : '--'
}

function Status({ state, compact = false }) {
  const meta = STATUS_META[state] || STATUS_META.in_progress
  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-medium ${
        compact ? 'rounded-md px-2 py-1 text-[0.68rem]' : 'rounded-lg px-2.5 py-1.5 text-xs'
      } ${meta.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function fallbackEvidence(row) {
  const task = row?.task || 'the work sample'
  const score = Math.max(0, Math.min(100, finiteNumber(row?.score) ?? 82))
  const diagnosis = Math.min(30, Math.round(score * 0.3))
  const implementation = Math.min(50, Math.round(score * 0.5))
  const verification = Math.min(20, Math.max(0, Math.round(score - diagnosis - implementation)))
  return {
    score,
    reasoning: `The candidate broke ${task.toLowerCase()} into a diagnosis, a focused change, and a verification pass. Review the excerpts below against the rubric before making a decision.`,
    criteria: [
      {
        label: 'Problem diagnosis',
        points: `${diagnosis} / 30`,
        pct: Math.round((diagnosis / 30) * 100),
        note: 'Traced the failure to the retry path before changing the handler.',
      },
      {
        label: 'Implementation quality',
        points: `${implementation} / 50`,
        pct: Math.round((implementation / 50) * 100),
        note: 'Kept the patch narrow and preserved the existing service contract.',
      },
      {
        label: 'Verification',
        points: `${verification} / 20`,
        pct: Math.round((verification / 20) * 100),
        note: 'Reproduced the issue, added a regression case, and reran the suite.',
      },
    ],
    evidence: [
      'Compared the original request path with the retry path before editing.',
      'Ran the failing case, revised the implementation, then reran the complete check.',
      'Explained the tradeoff between a local guard and a wider service change.',
    ],
    activity: ['Diagnosis captured', 'AI interaction recorded', 'Revision tested'],
    provenance: 'Illustrative preview',
  }
}

function normalizeLiveEvidence(score, loaded, digest, audit) {
  const submission = loaded?.submission || null
  const workSample = loaded?.work_sample || null
  const mapped = toResultCardData(score, { workSample, submission, digest })
  const summary = digest?.summary || {}
  const activity = []
  const pasteCount = finiteNumber(summary.paste_count)
  const tabChangeCount = finiteNumber(summary.tab_hidden_count)
  if (pasteCount != null) {
    activity.push(`${pasteCount} paste event${pasteCount === 1 ? '' : 's'} recorded`)
  }
  if (tabChangeCount != null) {
    activity.push(`${tabChangeCount} tab change${tabChangeCount === 1 ? '' : 's'} recorded`)
  }
  if (mapped.durationMin != null) activity.push(`${mapped.durationMin} minute work session`)

  const provenance =
    audit?.scoring?.model ||
    audit?.model ||
    audit?.grader_model ||
    audit?.score?.model ||
    'Scoring record available'

  return {
    score: mapped.score,
    reasoning: mapped.reasoning,
    criteria: mapped.criteria || [],
    evidence: mapped.evidence || [],
    activity,
    provenance: String(provenance),
  }
}

function Metric({ value, label, accent = false }) {
  return (
    <div className="min-w-[5.4rem] border-l border-white/15 pl-4 first:border-l-0 first:pl-0 sm:pl-6">
      <p className={`font-mono text-2xl font-semibold tabular-nums ${accent ? 'text-brand-200' : 'text-white'}`}>
        {value}
      </p>
      <p className="mt-0.5 whitespace-nowrap text-[0.68rem] text-white/55">{label}</p>
    </div>
  )
}

function LoadingLines() {
  return (
    <div className="space-y-3" aria-label="Loading evidence">
      {[84, 68, 92, 54].map((width) => (
        <div key={width} className="h-3 animate-pulse rounded bg-stone-200/70" style={{ width: `${width}%` }} />
      ))}
    </div>
  )
}

function EvidenceInspector({ row, detail, detailState, OutcomeComponent, reduceMotion }) {
  if (!row) {
    return (
      <aside className="border border-dashed border-stone-300 bg-canvas/60 p-6 lg:sticky lg:top-24">
        <FileText size={18} className="text-stone-400" />
        <p className="mt-3 text-sm font-semibold text-ink">No row selected</p>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">
          Adjust the filters or select a candidate to inspect their work trail.
        </p>
      </aside>
    )
  }

  const state = stateForRow(row)
  const resultTo = row.scoreId
    ? `/app/result?score=${row.scoreId}${row.submissionId ? `&submission=${row.submissionId}` : ''}`
    : '/app/result'

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.aside
        key={rowKey(row)}
        initial={reduceMotion ? false : { opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
        transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="relative border border-brand-200 bg-white shadow-[0_18px_50px_-32px_rgba(24,42,150,0.5)] lg:sticky lg:top-24"
      >
        <span className="absolute -left-3 top-10 hidden h-px w-3 bg-brand-400 lg:block" aria-hidden="true" />
        <motion.span
          className="absolute -left-[0.28rem] top-[2.36rem] hidden h-2 w-2 rounded-full bg-brand-500 ring-4 ring-brand-100 lg:block"
          animate={reduceMotion ? undefined : { scale: [0.85, 1.1, 0.85], opacity: [0.65, 1, 0.65] }}
          transition={reduceMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
        />

        <header className="border-b border-stone-200 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-brand-600">
                Evidence inspector
              </p>
              <h2 className="mt-2 truncate font-sans text-lg font-semibold text-ink">
                Candidate {row.id || 'record'}
              </h2>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-500">{row.task}</p>
            </div>
            <div className="shrink-0 text-right">
              <span className="font-mono text-3xl font-semibold tabular-nums text-brand-700">
                {scoreLabel(detail?.score ?? row.score)}
              </span>
              <span className="block text-[0.65rem] text-stone-400">out of 100</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Status state={state} compact />
            <span className="font-mono text-[0.66rem] text-stone-400">{row.when || 'Recently updated'}</span>
          </div>
        </header>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-5">
          {detailState === 'loading' ? <LoadingLines /> : null}

          {detailState === 'error' ? (
            <div className="border border-warning-200 bg-warning-50 px-4 py-3 text-xs leading-relaxed text-warning-700">
              The summary could not load. Open the full packet to retry with the complete record.
            </div>
          ) : null}

          {detailState === 'waiting' ? (
            <div className="border border-brand-200 bg-brand-50 px-4 py-4">
              <Clock size={16} className="text-brand-600" />
              <p className="mt-2 text-sm font-semibold text-ink">Work is still underway</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-600">
                Rubric evidence appears here after the candidate submits and the scoring record is ready.
              </p>
            </div>
          ) : null}

          {detail && detailState === 'ready' ? (
            <div className="space-y-6">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                    Rubric ledger
                  </h3>
                  <span className="font-mono text-[0.65rem] text-stone-400">{detail.criteria.length} criteria</span>
                </div>
                <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
                  {detail.criteria.slice(0, 4).map((criterion, index) => (
                    <div key={`${criterion.label}-${index}`} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-medium text-ink">{criterion.label}</span>
                        <span className="shrink-0 font-mono text-[0.68rem] text-stone-500">
                          {criterion.points || `${criterion.pct || 0}%`}
                        </span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden bg-stone-100">
                        <motion.div
                          className="h-full bg-brand-500"
                          initial={reduceMotion ? false : { scaleX: 0 }}
                          animate={{ scaleX: Math.max(0, Math.min(100, Number(criterion.pct) || 0)) / 100 }}
                          transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
                          style={{ transformOrigin: 'left' }}
                        />
                      </div>
                      {criterion.note ? (
                        <p className="mt-2 line-clamp-3 text-[0.7rem] leading-relaxed text-stone-500">
                          {criterion.note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>

              {detail.evidence.length ? (
                <section>
                  <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                    Evidence excerpts
                  </h3>
                  <ol className="mt-3 space-y-3">
                    {detail.evidence.slice(0, 3).map((item, index) => (
                      <li key={`${item}-${index}`} className="grid grid-cols-[1.35rem_1fr] gap-2 text-xs leading-relaxed text-stone-600">
                        <span className="font-mono text-brand-600">{String(index + 1).padStart(2, '0')}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {detail.activity.length ? (
                <section>
                  <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                    Work trail
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {detail.activity.slice(0, 3).map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-stone-600">
                        <Check size={13} className="mt-0.5 shrink-0 text-success-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="border-l-2 border-brand-300 pl-3">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-stone-400">Review note</p>
                <p className="mt-1 text-xs leading-relaxed text-stone-600">{detail.reasoning}</p>
                <p className="mt-2 truncate font-mono text-[0.64rem] text-stone-400">{detail.provenance}</p>
              </section>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-stone-200 px-5 py-4">
          {OutcomeComponent && row.submissionId && row.scored ? (
            <div className="mb-4">
              <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-stone-400">
                Hiring outcome
              </p>
              <OutcomeComponent submissionId={row.submissionId} initial={row.labels} />
            </div>
          ) : null}
          <Link
            to={resultTo}
            className="inline-flex w-full items-center justify-between bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
          >
            Open evidence packet <ArrowRight size={15} />
          </Link>
        </footer>
      </motion.aside>
    </AnimatePresence>
  )
}

export default function EvidenceLedger({
  rows = [],
  assessments = [],
  loading = false,
  live = false,
  confirmingDelete = null,
  deletingId = null,
  deleteError = null,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  OutcomeComponent,
}) {
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [screenFilter, setScreenFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [detailState, setDetailState] = useState('idle')
  const [detail, setDetail] = useState(null)
  const cacheRef = useRef(new Map())

  const allRows = Array.isArray(rows) ? rows : []
  const allAssessments = Array.isArray(assessments) ? assessments : []

  const displayAssessments = useMemo(() => {
    if (allAssessments.length || live) return allAssessments
    const previews = new Map()
    allRows.forEach((row) => {
      const id = screenKeyForRow(row)
      const current = previews.get(id) || {
        id,
        title: row.task || 'Work sample',
        role: row.role || 'Role not set',
        submissions: 0,
        topScore: null,
        preview: true,
      }
      current.submissions += 1
      const score = finiteNumber(row.score)
      if (score != null) current.topScore = current.topScore == null ? score : Math.max(current.topScore, score)
      previews.set(id, current)
    })
    return Array.from(previews.values())
  }, [allAssessments, allRows, live])

  const screenNames = useMemo(() => {
    const names = new Map()
    displayAssessments.forEach((assessment) => names.set(String(assessment.id), assessment.title || 'Untitled screen'))
    allRows.forEach((row) => {
      const id = screenKeyForRow(row)
      if (!names.has(id)) {
        names.set(id, row.task || 'Work sample')
      }
    })
    return names
  }, [allRows, displayAssessments])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allRows.filter((row) => {
      const state = stateForRow(row)
      const matchesState = stateFilter === 'all' || state === stateFilter
      const matchesScreen = screenFilter === 'all' || screenKeyForRow(row) === screenFilter
      const searchable = [
        row.id,
        row.role,
        row.task,
        screenNames.get(screenKeyForRow(row)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesState && matchesScreen && (!needle || searchable.includes(needle))
    })
  }, [allRows, query, screenFilter, screenNames, stateFilter])

  const selectedRow =
    filteredRows.find((row) => rowKey(row) === selectedId) || filteredRows[0] || null

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedId(null)
      return
    }
    if (!filteredRows.some((row) => rowKey(row) === selectedId)) {
      setSelectedId(rowKey(filteredRows[0]))
    }
  }, [filteredRows, selectedId])

  useEffect(() => {
    let active = true
    const selectedKey = rowKey(selectedRow)
    if (!selectedRow) {
      setDetail(null)
      setDetailState('idle')
      return () => {
        active = false
      }
    }

    if (!live) {
      setDetail(fallbackEvidence(selectedRow))
      setDetailState('ready')
      return () => {
        active = false
      }
    }

    if (!selectedRow.scoreId || !selectedRow.submissionId) {
      setDetail(null)
      setDetailState('waiting')
      return () => {
        active = false
      }
    }

    if (cacheRef.current.has(selectedKey)) {
      setDetail(cacheRef.current.get(selectedKey))
      setDetailState('ready')
      return () => {
        active = false
      }
    }

    setDetail(null)
    setDetailState('loading')
    Promise.all([
      api.getScore(selectedRow.scoreId),
      api.getSubmission(selectedRow.submissionId).catch(() => null),
      api.getIntegrityDigest(selectedRow.submissionId).catch(() => null),
      api.getScoreAudit(selectedRow.scoreId).catch(() => null),
    ])
      .then(([score, loaded, digest, audit]) => {
        if (!active) return
        const normalized = normalizeLiveEvidence(score, loaded, digest, audit)
        cacheRef.current.set(selectedKey, normalized)
        setDetail(normalized)
        setDetailState('ready')
      })
      .catch(() => {
        if (!active) return
        setDetail(null)
        setDetailState('error')
      })

    return () => {
      active = false
    }
  }, [live, selectedRow])

  const counts = useMemo(() => {
    const result = {
      evidence_ready: 0,
      review_flagged: 0,
      in_progress: 0,
      awaiting_candidate: 0,
    }
    allRows.forEach((row) => {
      result[stateForRow(row)] += 1
    })
    return result
  }, [allRows])

  function selectRow(row) {
    setSelectedId(rowKey(row))
  }

  function toggleScreen(id) {
    const value = String(id)
    setScreenFilter((current) => (current === value ? 'all' : value))
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 px-5 py-6 text-white sm:px-7 sm:py-8 lg:px-9">
        <EvidenceNetwork className="opacity-65" theme="dark" density="sparse" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-brand-200">
              <span className="h-px w-8 bg-brand-300" /> Recruiter workspace
            </div>
            <h1 className="mt-4 max-w-xl font-sans text-3xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-4xl lg:text-[2.75rem]">
              Every decision connected to the work behind it.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">
              Scan active screens, isolate candidates who need review, and open the exact rubric evidence without leaving the ledger.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-5 sm:flex-row sm:items-end">
            <div className="grid grid-cols-3 gap-4 sm:gap-6">
              <Metric value={displayAssessments.length} label="Active screens" />
              <Metric value={counts.review_flagged} label="Needs review" accent />
              <Metric value={counts.evidence_ready} label="Packets ready" />
            </div>
            <Link
              to="/app/author"
              className="inline-flex shrink-0 items-center justify-center gap-2 bg-white px-5 py-3 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-800"
            >
              <Plus size={16} /> Create screen
            </Link>
          </div>
        </div>
      </section>

      <section className="border-x border-b border-stone-200 bg-white" aria-labelledby="active-screens-title">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <h2 id="active-screens-title" className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
              Active screens
            </h2>
            <span className="font-mono text-[0.68rem] text-stone-400">{displayAssessments.length}</span>
          </div>
          {screenFilter !== 'all' ? (
            <button
              type="button"
              onClick={() => setScreenFilter('all')}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900"
            >
              Clear filter <X size={12} />
            </button>
          ) : null}
        </div>

        {loading && !displayAssessments.length ? (
          <div className="grid grid-cols-2 divide-x divide-stone-200 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse bg-stone-100/70" />
            ))}
          </div>
        ) : displayAssessments.length ? (
          <div className="flex snap-x overflow-x-auto">
            {displayAssessments.map((assessment, index) => {
              const active = screenFilter === String(assessment.id)
              return (
                <div
                  key={assessment.id}
                  className={`relative min-w-[17rem] snap-start border-r border-stone-200 px-4 py-4 transition-colors sm:px-5 ${
                    active ? 'bg-brand-50' : 'bg-white hover:bg-stone-50'
                  }`}
                >
                  {active ? <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-500" /> : null}
                  <button type="button" onClick={() => toggleScreen(assessment.id)} className="block w-full text-left">
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-[0.65rem] text-stone-400">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{assessment.title}</p>
                        <p className="mt-0.5 truncate text-xs text-stone-500">{assessment.role}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 pl-7 text-[0.68rem] text-stone-500">
                      <span>{assessment.submissions || 0} submissions</span>
                      <span className="font-mono text-brand-700">
                        {finiteNumber(assessment.topScore) != null ? `Top ${Math.round(finiteNumber(assessment.topScore))}` : 'Open'}
                      </span>
                    </div>
                  </button>

                  {live ? <div className="mt-3 flex min-h-5 items-center justify-end border-t border-stone-200/80 pt-2">
                    {confirmingDelete === assessment.id ? (
                      <div className="flex items-center gap-2 text-[0.68rem]">
                        <span className="text-danger-700">Delete screen?</span>
                        <button
                          type="button"
                          onClick={() => onConfirmDelete?.(assessment.id)}
                          disabled={deletingId === assessment.id}
                          className="font-semibold text-danger-700 hover:opacity-75 disabled:opacity-50"
                        >
                          {deletingId === assessment.id ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button type="button" onClick={() => onCancelDelete?.()} className="text-stone-500 hover:text-ink">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRequestDelete?.(assessment.id)}
                        className="text-[0.68rem] text-stone-400 transition-colors hover:text-danger-700"
                      >
                        Delete
                      </button>
                    )}
                  </div> : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-stone-500">
            No active screens yet. Create one to start collecting candidate work.
          </div>
        )}
        {deleteError ? <p className="border-t border-danger-200 bg-danger-50 px-5 py-3 text-xs text-danger-700">{deleteError}</p> : null}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <section className="min-w-0" aria-labelledby="candidate-ledger-title">
          <div className="flex flex-col gap-4 border-y border-stone-200 bg-white px-4 py-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 id="candidate-ledger-title" className="font-sans text-sm font-semibold text-ink">
                Candidate ledger
              </h2>
              <p className="mt-1 font-mono text-[0.68rem] text-stone-400">
                {filteredRows.length} of {allRows.length} records
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,0.7fr)_minmax(10rem,0.7fr)] xl:w-[42rem]">
              <label>
                <span className="sr-only">Search candidate ledger</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search candidate, role, or task"
                  className="h-10 w-full border border-stone-300 bg-paper px-3 text-xs text-ink outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label>
                <span className="sr-only">Filter by screen</span>
                <select
                  value={screenFilter}
                  onChange={(event) => setScreenFilter(event.target.value)}
                  className="h-10 w-full border border-stone-300 bg-paper px-3 text-xs text-ink outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="all">All screens</option>
                  {Array.from(screenNames.entries()).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Filter by state</span>
                <select
                  value={stateFilter}
                  onChange={(event) => setStateFilter(event.target.value)}
                  className="h-10 w-full border border-stone-300 bg-paper px-3 text-xs text-ink outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                >
                  {STATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="hidden border-b border-stone-200 bg-white md:block" role="table" aria-label="Candidate evidence ledger">
            <div
              className="grid grid-cols-[5.5rem_minmax(13rem,1fr)_8.5rem_5rem_6.5rem] items-center gap-4 border-b border-stone-200 px-4 py-3 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-stone-400 sm:px-5"
              role="row"
            >
              <span role="columnheader">Candidate</span>
              <span role="columnheader">Screen and task</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Score</span>
              <span role="columnheader">Updated</span>
            </div>

            {loading && !allRows.length ? (
              <div className="divide-y divide-stone-200">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="grid h-[4.6rem] grid-cols-[5.5rem_1fr_8.5rem_5rem_6.5rem] items-center gap-4 px-5">
                    {[60, 86, 72, 52, 64].map((width, item) => (
                      <span key={item} className="h-3 animate-pulse rounded bg-stone-200/70" style={{ width: `${width}%` }} />
                    ))}
                  </div>
                ))}
              </div>
            ) : filteredRows.length ? (
              <div className="divide-y divide-stone-200" role="rowgroup">
                {filteredRows.map((row) => {
                  const key = rowKey(row)
                  const selected = key === rowKey(selectedRow)
                  const state = stateForRow(row)
                  return (
                    <motion.div
                      key={key}
                      role="row"
                      tabIndex={0}
                      aria-selected={selected}
                      onClick={() => selectRow(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectRow(row)
                        }
                      }}
                      layout={!reduceMotion}
                      className={`relative grid cursor-pointer grid-cols-[5.5rem_minmax(13rem,1fr)_8.5rem_5rem_6.5rem] items-center gap-4 px-4 py-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 sm:px-5 ${
                        selected ? 'bg-brand-50/80' : 'bg-white hover:bg-stone-50'
                      }`}
                    >
                      {selected ? <motion.span layoutId="ledger-selection" className="absolute inset-y-0 left-0 w-0.5 bg-brand-500" /> : null}
                      <span className="flex items-center gap-2 font-mono text-xs text-stone-600" role="cell">
                        {selected ? (
                          <motion.span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                            animate={reduceMotion ? undefined : { scale: [0.8, 1.25, 0.8], opacity: [0.55, 1, 0.55] }}
                            transition={reduceMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                            aria-hidden="true"
                          />
                        ) : <span className="h-1.5 w-1.5 shrink-0" />}
                        {row.id || '----'}
                      </span>
                      <span className="min-w-0" role="cell">
                        <span className="block truncate text-sm font-semibold text-ink">{row.task || 'Work sample'}</span>
                        <span className="mt-0.5 block truncate text-xs text-stone-500">{row.role || screenNames.get(screenKeyForRow(row)) || 'Role not set'}</span>
                      </span>
                      <span role="cell"><Status state={state} compact /></span>
                      <span className="font-mono text-base font-semibold tabular-nums text-ink" role="cell">{scoreLabel(row.score)}</span>
                      <span className="font-mono text-[0.68rem] text-stone-400" role="cell">{row.when || 'Recent'}</span>
                    </motion.div>
                  )
                })}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-semibold text-ink">No matching records</p>
                <p className="mt-1 text-xs text-stone-500">Clear a filter or try a broader search.</p>
              </div>
            )}
          </div>

          <div className="space-y-2 md:hidden">
            {loading && !allRows.length ? (
              Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse bg-stone-100" />)
            ) : filteredRows.length ? (
              filteredRows.map((row) => {
                const key = rowKey(row)
                const selected = key === rowKey(selectedRow)
                const state = stateForRow(row)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectRow(row)}
                    className={`w-full border px-4 py-4 text-left transition-colors ${
                      selected ? 'border-brand-300 bg-brand-50' : 'border-stone-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[0.68rem] text-brand-700">Candidate {row.id || '----'}</p>
                        <p className="mt-1 truncate text-sm font-semibold text-ink">{row.task || 'Work sample'}</p>
                        <p className="mt-0.5 truncate text-xs text-stone-500">{row.role || 'Role not set'}</p>
                      </div>
                      <span className="font-mono text-2xl font-semibold text-ink">{scoreLabel(row.score)}</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <Status state={state} compact />
                      <span className="font-mono text-[0.65rem] text-stone-400">{row.when || 'Recent'}</span>
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="border border-dashed border-stone-300 px-5 py-10 text-center text-sm text-stone-500">
                No matching records.
              </div>
            )}
          </div>
        </section>

        <EvidenceInspector
          row={selectedRow}
          detail={detail}
          detailState={detailState}
          OutcomeComponent={OutcomeComponent}
          reduceMotion={reduceMotion}
        />
      </div>

      {!live ? (
        <div className="mt-5 flex items-start gap-2 border-l-2 border-brand-300 pl-3 text-xs leading-relaxed text-stone-500">
          <CheckCircle size={14} className="mt-0.5 shrink-0 text-brand-600" />
          Preview data is illustrative. Sign in to connect this ledger to authored screens, candidate submissions, and scoring records.
        </div>
      ) : null}
    </div>
  )
}
