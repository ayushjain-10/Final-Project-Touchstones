import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { Sparkle, Check } from './icons.jsx'

// Recruiter-facing timestamped activity report: a summary header ("what happened") + a chronological
// timeline of the candidate's session — start, AI prompts, paste / tab-focus signals, and submit.
// Loads on demand. Times are shown as local clock times; everything is rendered as TEXT.
function clock(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-canvas/70 px-3 py-2 text-center ring-1 ring-stone-200/70">
      <div className="font-serif text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-stone-500">{label}</div>
    </div>
  )
}

const DOT = {
  milestone: 'bg-clay-500',
  ai: 'bg-amber-500',
  integrity: 'bg-stone-400',
}

export default function ActivityTimeline({ submissionId }) {
  const [state, setState] = useState('idle') // idle | loading | done | error
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!submissionId) return
    let active = true
    setState('loading')
    api
      .getActivityTimeline(submissionId)
      .then((res) => {
        if (!active) return
        setData(res)
        setState('done')
      })
      .catch((e) => {
        if (!active) return
        setError(e?.message || 'Could not load the activity timeline.')
        setState('error')
      })
    return () => {
      active = false
    }
  }, [submissionId])

  const s = data?.summary || {}
  const items = data?.items || []

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-ink">Activity report</h3>
        {s.duration_min != null && <span className="text-xs text-stone-500">{s.duration_min} min on task</span>}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-stone-500">
        Timestamped session activity — server-observed signals, AI prompts, and milestones.
      </p>

      {state === 'loading' && <p className="mt-4 text-sm text-stone-400">Loading activity…</p>}
      {state === 'error' && (
        <p className="mt-4 rounded-lg bg-flag-50 px-3 py-2 text-sm text-flag-700 ring-1 ring-flag-100">{error}</p>
      )}

      {state === 'done' && (
        <>
          {/* Summary header — the "report" at a glance. */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Stat label="AI prompts" value={s.ai_prompts ?? 0} />
            <Stat label="Pastes" value={s.pastes ?? 0} />
            <Stat label="Tab switches" value={s.tab_switches ?? 0} />
            <Stat label="Events" value={s.events ?? 0} />
          </div>

          {/* Chronological timeline. */}
          {items.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">No timestamped activity was captured for this session.</p>
          ) : (
            <ol className="mt-5 space-y-3.5">
              {items.map((it, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 flex w-16 shrink-0 justify-end font-mono text-[11px] text-stone-400">
                    {clock(it.ts)}
                  </span>
                  <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[it.kind] || 'bg-stone-400'}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm text-ink">
                      {it.kind === 'ai' && <Sparkle size={13} className="text-amber-500" />}
                      {it.kind === 'milestone' && <Check size={13} className="text-clay-500" />}
                      <span className="font-medium">{it.label}</span>
                      {it.attested && (
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">self-reported</span>
                      )}
                    </div>
                    {it.detail && <p className="mt-0.5 break-words text-xs text-stone-500">{it.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
