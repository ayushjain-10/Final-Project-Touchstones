import { useCallback, useEffect, useRef, useState } from 'react'
import { Pill } from './primitives.jsx'
import { Sparkle, ShieldCheck, Check, Flag, Eye, ArrowUpRight } from './icons.jsx'
import { api } from '../services/api.js'

// Recruiter-facing Live AI Probe panel. Self-contained: starts a probe, shows the candidate share
// link, polls while the candidate answers, then renders the scored transcript + per-dimension
// evidence + the consistency flag. Drop-in: <ProbePanel submissionId={id} /> (sibling to ResultCard).
const DIM_LABELS = {
  understanding: 'Understanding',
  defends_and_extends: 'Defends & extends',
  ownership: 'Ownership / authenticity',
}
const CONSISTENCY = {
  consistent: { tone: 'clay', label: 'Consistent with submission', Icon: Check },
  inconsistent: { tone: 'flag', label: 'Inconsistent with submission', Icon: Flag },
  unclear: { tone: 'amber', label: 'Consistency unclear', Icon: Eye },
}
const FRONTEND_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''

function CopyLink({ url }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg bg-stone-100 px-2.5 py-1.5 ring-1 ring-stone-200">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-stone-700">{url}</code>
      <button
        type="button"
        onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1400) } catch { /* blocked */ } }}
        className={`btn-quiet shrink-0 px-2.5 py-1 text-xs ${done ? 'text-clay-700' : 'text-stone-500'}`}
      >
        {done ? (<><Check size={13} /> Copied</>) : 'Copy link'}
      </button>
    </div>
  )
}

export default function ProbePanel({ submissionId }) {
  const [state, setState] = useState('loading') // loading | none | active | error
  const [probe, setProbe] = useState(null)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef(null)

  const load = useCallback(() => {
    if (!submissionId) return Promise.resolve()
    return api.getLatestProbe(submissionId)
      .then((p) => { setProbe(p); setState('active') })
      .catch((e) => {
        if (e?.status === 404) { setState('none'); setProbe(null) }
        else { setError(e?.message || 'Could not load the interview.'); setState('error') }
      })
  }, [submissionId])

  useEffect(() => { setState('loading'); load() }, [load])

  // Poll while a probe is in progress so the recruiter sees turns + the final score land.
  useEffect(() => {
    clearInterval(pollRef.current)
    if (probe && probe.status === 'in_progress') {
      pollRef.current = setInterval(() => { load() }, 5000)
    }
    return () => clearInterval(pollRef.current)
  }, [probe, load])

  async function start() {
    setStarting(true); setError(null)
    try {
      await api.startProbe(submissionId)
      await load()
    } catch (e) {
      setError(e?.status === 422 ? 'This submission has no work to interview yet.' : (e?.message || 'Could not start the interview.'))
    } finally {
      setStarting(false)
    }
  }

  const shareUrl = probe?.token ? `${FRONTEND_ORIGIN}/probe/${probe.token}` : null
  const answered = (probe?.turns || []).filter((t) => t.role === 'candidate').length

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200"><Sparkle size={15} /></span>
        <h3 className="font-serif text-xl font-semibold text-ink">Live AI Probe</h3>
        {probe?.status === 'done' && probe?.probe_score != null && (
          <span className="ml-auto font-serif text-2xl font-semibold text-ink">{probe.probe_score}<span className="text-sm text-stone-400">/100</span></span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-stone-600">
        An adaptive interview grounded in this candidate&apos;s submitted work, with scoring calculated in code.
      </p>

      {state === 'loading' && <div className="mt-4 h-20 animate-pulse rounded-xl bg-stone-200/50" />}

      {state === 'error' && (
        <div className="mt-4 rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">
          {error} <button onClick={load} className="font-semibold underline underline-offset-2">Retry</button>
        </div>
      )}

      {state === 'none' && (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-6 text-center">
          <p className="text-sm text-stone-600">No live interview yet for this candidate.</p>
          <button onClick={start} disabled={starting} className="btn-primary mt-3 disabled:opacity-50">
            <Sparkle size={15} /> {starting ? 'Starting…' : 'Start live probe'}
          </button>
          {error && <p className="mt-2 text-sm text-flag-700">{error}</p>}
        </div>
      )}

      {state === 'active' && probe && (
        <div className="mt-4 space-y-4">
          {/* Share link + status while in progress */}
          {probe.status === 'in_progress' && (
            <div className="rounded-xl border border-clay-200 bg-clay-50/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">Waiting for the candidate…</p>
                <Pill tone="amber"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" /> {answered}/{probe.max_turns} answered</Pill>
              </div>
              <p className="mt-1 text-xs text-stone-500">Share this private link with the candidate to start the interview:</p>
              {shareUrl && <div className="mt-2"><CopyLink url={shareUrl} /></div>}
              <a href={shareUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800">
                Open candidate view <ArrowUpRight size={13} />
              </a>
            </div>
          )}

          {/* Score summary + consistency when done */}
          {probe.status === 'done' && (
            <>
              {probe.consistency_flag && (() => {
                const c = CONSISTENCY[probe.consistency_flag] || CONSISTENCY.unclear
                return <Pill tone={c.tone}><c.Icon size={12} /> {c.label}</Pill>
              })()}
              {probe.dimensions && (
                <div className="space-y-2.5">
                  {Object.entries(DIM_LABELS).map(([key, label]) => {
                    const d = probe.dimensions[key]
                    if (!d) return null
                    return (
                      <div key={key}>
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm font-medium text-ink">{label}</span>
                          <span className="text-sm text-stone-500">{d.points}/100</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                          <div className="h-full rounded-full bg-clay-400" style={{ width: `${Math.max(2, d.points)}%` }} />
                        </div>
                        {d.evidence && <p className="mt-1 text-xs leading-relaxed text-stone-500">“{d.evidence}”</p>}
                      </div>
                    )
                  })}
                </div>
              )}
              {probe.reasoning && (
                <div className="rounded-xl bg-stone-50 p-3.5 ring-1 ring-stone-100">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Why this score</p>
                  <p className="mt-1 text-sm leading-relaxed text-stone-700">{probe.reasoning}</p>
                </div>
              )}
              {probe.status === 'done' && probe.probe_score == null && (
                <p className="text-sm text-stone-500">The interview finished but couldn't be scored automatically — review the transcript below.</p>
              )}
            </>
          )}

          {/* Transcript (recruiter sees the full Q&A) */}
          {(probe.turns || []).length > 0 && (
            <details open={probe.status === 'done'} className="group">
              <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-stone-400 hover:text-stone-600">
                <ShieldCheck size={13} /> Transcript ({(probe.turns || []).filter((t) => t.role === 'candidate').length} answers) · tamper-evident
              </summary>
              <div className="mt-3 space-y-2.5">
                {(probe.turns || []).map((t, i) => (
                  <div key={i} className={`flex ${t.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                      t.role === 'candidate' ? 'bg-stone-100 text-ink ring-1 ring-stone-200' : 'bg-clay-50 text-ink ring-1 ring-clay-200'
                    }`}>
                      <span className={`mb-0.5 block text-[11px] font-semibold uppercase tracking-wide ${t.role === 'candidate' ? 'text-stone-500' : 'text-clay-600'}`}>
                        {t.role === 'candidate' ? 'Candidate' : 'Interviewer'}
                      </span>
                      {t.content}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
