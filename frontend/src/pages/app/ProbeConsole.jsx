import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Reveal from '../../components/Reveal.jsx'
import { Pill } from '../../components/primitives.jsx'
import ProbePanel from '../../components/ProbePanel.jsx'
import { Sparkle, User, Clock } from '../../components/icons.jsx'
import { api } from '../../services/api.js'

// Recruiter surface for the Live AI Probe: pick a candidate's submission and run / review an
// adaptive interview grounded in their work. Self-contained so the feature is demo-complete; the
// same <ProbePanel submissionId={...} /> can also be dropped onto the result view.
const STATUS_TONE = { scored: 'clay', submitted: 'amber', assigned: 'neutral' }

function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (Number.isNaN(s)) return ''
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ProbeConsole() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('submission')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    return api.getActivity()
      .then((res) => {
        const list = (Array.isArray(res?.activity) ? res.activity : [])
          .filter((a) => a.submission_id && a.status !== 'assigned')
        setRows(list)
        // Preselect the most recent if nothing chosen.
        if (!selected && list.length) setParams({ submission: list[0].submission_id }, { replace: true })
      })
      .catch((e) => setError(e?.message || 'Could not load your candidates.'))
      .finally(() => setLoading(false))
  }, [selected, setParams])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(id) { setParams({ submission: id }, { replace: true }) }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Reveal>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-clay-600">
          <Sparkle size={13} /> Live AI Probe
        </span>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">Interview them on what they built</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          A short adaptive interview grounded in the candidate's submitted work, with rubric-linked evidence scored in code.
          The only live interview that knows what the candidate did and proves who's answering.
        </p>
      </Reveal>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(260px,320px)_1fr]">
        {/* Candidate / submission picker */}
        <Reveal delay={50}>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Candidates</h2>
            {loading ? (
              <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-200/50" />)}</div>
            ) : error ? (
              <div className="mt-3 rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">
                {error} <button onClick={load} className="font-semibold underline underline-offset-2">Retry</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-6 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-stone-400"><User size={20} /></span>
                <p className="mt-3 text-sm font-medium text-ink">No submissions yet</p>
                <p className="mt-1 text-xs text-stone-500">Once a candidate completes a screen, you can interview them on it here.</p>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((r) => (
                  <li key={r.submission_id}>
                    <button
                      onClick={() => pick(r.submission_id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        selected === r.submission_id ? 'border-clay-300 bg-clay-50 ring-1 ring-clay-200' : 'border-stone-200 bg-white hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-ink">{r.candidate || 'Candidate'}</p>
                        <Pill tone={STATUS_TONE[r.status] || 'neutral'} className="shrink-0 capitalize">{r.status}</Pill>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-stone-500">{r.screen_title}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-stone-400"><Clock size={11} /> {timeAgo(r.submitted_at || r.started_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Reveal>

        {/* The probe panel for the selected submission */}
        <Reveal delay={100}>
          {selected ? (
            <ProbePanel key={selected} submissionId={selected} />
          ) : (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400"><Sparkle size={22} /></span>
              <p className="mt-4 font-medium text-ink">Pick a candidate to interview</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">Select a submission on the left to start or review a live probe.</p>
            </div>
          )}
        </Reveal>
      </div>
    </div>
  )
}
