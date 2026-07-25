import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pill } from '../../components/primitives.jsx'
import { api } from '../../services/api.js'
import { ErrorState } from '../../components/states.jsx'
import { Clock, FileText, ArrowRight, Check, User, Mail } from '../../components/icons.jsx'

const STATUS = {
  assigned: { label: 'In progress', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'clay' },
  scored: { label: 'Scored', tone: 'clay' },
  expired: { label: 'Expired', tone: 'neutral' },
}

// Invite funnel states (see api.getInvitesOverview). Same tones as STATUS:
// pre-submission stays neutral, submitted/scored get the clay accent, and declined
// gets the flag tone so it reads as a drop-off, not progress.
const INVITE_STATUS = {
  invited: { label: 'Invited', tone: 'neutral' },
  started: { label: 'Started', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'clay' },
  scored: { label: 'Scored', tone: 'clay' },
  declined: { label: 'Declined', tone: 'flag' },
}

// Relative "x ago" label (browser-side; coarse is fine for a feed).
function timeAgo(iso) {
  if (!iso) return null
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return null
  const s = Math.floor((Date.now() - d) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// Funnel stages are cumulative (a scored candidate also started), so a stage filter means
// "reached at least this stage" and the filtered rows always add up to the tile's count.
// 'declined' is the exception: it is terminal, not a stage candidates pass through, so its
// filter is exact-match: clicking Declined shows only rows whose status is 'declined'.
// (Declined rows aren't in STAGE_RANK, so they also never match a cumulative stage filter.)
const STAGE_RANK = { invited: 0, started: 1, submitted: 2, scored: 3 }

function matchesStage(status, filter) {
  if (!filter) return true
  if (filter === 'declined') return status === 'declined'
  return (STAGE_RANK[status] ?? 0) >= STAGE_RANK[filter]
}

// One screen's invite funnel: title + counts, expandable per-email list. When a stage
// filter is active the list opens itself and shows only candidates who reached that stage.
function ScreenInvites({ screen, filter }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (filter) setOpen(true)
  }, [filter])
  const all = Array.isArray(screen.invites) ? screen.invites : []
  const invites = filter ? all.filter((i) => matchesStage(i.status, filter)) : all
  return (
    <li className="card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 text-left"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
          <Mail size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{screen.title}</span>
          <span className="mt-0.5 block text-sm text-stone-500">
            {Number(screen.sent) || 0} sent, {Number(screen.started) || 0} started,{' '}
            {Number(screen.submitted) || 0} submitted, {Number(screen.scored) || 0} scored
            {Number(screen.declined) > 0 && `, ${Number(screen.declined)} declined`}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-clay-700">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open &&
        (invites.length === 0 ? (
          <p className="mt-3 border-t border-stone-200 pt-3 text-sm text-stone-500">
            {filter === 'declined'
              ? 'Nobody has declined this screen.'
              : filter
                ? `Nobody has reached ${filter} on this screen yet.`
                : 'No invites for this screen yet.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2 border-t border-stone-200 pt-3">
            {invites.map((inv, i) => {
              const st = INVITE_STATUS[inv.status] || { label: inv.status, tone: 'neutral' }
              const when = [
                inv.invited_at && `Invited ${timeAgo(inv.invited_at)}`,
                inv.submitted_at && `Submitted ${timeAgo(inv.submitted_at)}`,
              ]
                .filter(Boolean)
                .join(', ')
              return (
                <li
                  key={`${inv.email}-${i}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{inv.email}</span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {when && <span className="text-xs text-stone-400">{when}</span>}
                </li>
              )
            })}
          </ul>
        ))}
    </li>
  )
}

export default function Activity() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [overview, setOverview] = useState(null)
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [invitesError, setInvitesError] = useState(null)
  // Stage filter driven by the totals tiles: null shows everyone, a stage shows candidates
  // who reached at least that stage. Clicking the active tile (or Sent) clears it.
  const [stageFilter, setStageFilter] = useState(null)

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    api
      .getActivity()
      .then((res) => {
        if (!active) return
        setItems(Array.isArray(res) ? res : res?.activity || [])
      })
      .catch((e) => active && setError(e.message || 'Could not load activity.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const loadInvites = useCallback(() => {
    let active = true
    setInvitesLoading(true)
    setInvitesError(null)
    api
      .getInvitesOverview()
      .then((res) => active && setOverview(res || null))
      .catch((e) => active && setInvitesError(e.message || 'Could not load invites.'))
      .finally(() => active && setInvitesLoading(false))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => load(), [load])
  useEffect(() => loadInvites(), [loadInvites])

  // Refresh when the tab regains focus: recruiters send invites from another page or tab and
  // come back here expecting the funnel to be current, not a snapshot from first mount.
  useEffect(() => {
    const onFocus = () => {
      load()
      loadInvites()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, loadInvites])

  const totals = overview?.totals || {}
  const screens = Array.isArray(overview?.screens) ? overview.screens : []
  const noInvites = (Number(totals.sent) || 0) === 0

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Activity</h1>
        <p className="mt-1 text-sm text-stone-600">
          Every candidate who's working on, or has completed, one of your screens.
        </p>
      </div>

      {/* Invites: the send-side funnel (who was invited, per screen, and how far they got). */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          Invites
        </h2>
        {invitesLoading ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-stone-200/50" />
            ))}
          </div>
        ) : invitesError ? (
          <ErrorState
            className="mt-3"
            title="Couldn’t load invites"
            message={invitesError}
            onRetry={loadInvites}
          />
        ) : noInvites ? (
          <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-8 text-center">
            <p className="text-sm text-stone-500">No invites sent yet.</p>
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['Sent', totals.sent, null],
                ['Started', totals.started, 'started'],
                ['Submitted', totals.submitted, 'submitted'],
                ['Scored', totals.scored, 'scored'],
                ['Declined', totals.declined, 'declined'],
              ].map(([label, n, stage]) => {
                // Sent is the "everyone" tile: it reads as selected whenever no narrower
                // stage filter is active, so exactly one tile always carries the outline.
                const active = stage === null ? stageFilter === null : stageFilter === stage
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStageFilter(active || stage === null ? null : stage)}
                    className={`card p-4 text-left transition-shadow hover:shadow-md ${
                      active ? 'border-clay-400 bg-clay-50 ring-1 ring-clay-300' : ''
                    }`}
                  >
                    <p className="font-serif text-2xl font-semibold text-ink">{Number(n) || 0}</p>
                    <p
                      className={`mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                        active ? 'text-clay-700' : 'text-stone-400'
                      }`}
                    >
                      {label}
                    </p>
                  </button>
                )
              })}
            </div>
            {stageFilter && (
              <p className="mt-3 text-sm text-stone-600">
                {stageFilter === 'declined' ? (
                  <>Showing candidates who <span className="font-medium text-ink">declined</span>.</>
                ) : (
                  <>
                    Showing candidates who reached{' '}
                    <span className="font-medium text-ink">{stageFilter}</span>.
                  </>
                )}{' '}
                <button
                  type="button"
                  onClick={() => setStageFilter(null)}
                  className="font-medium text-clay-700 underline-offset-2 hover:underline"
                >
                  Clear filter
                </button>
              </p>
            )}
            <ul className="mt-3 space-y-2.5">
              {(stageFilter
                ? screens.filter((s) =>
                    (Array.isArray(s.invites) ? s.invites : []).some((i) =>
                      matchesStage(i.status, stageFilter),
                    ),
                  )
                : screens
              ).map((s) => (
                <ScreenInvites key={s.work_sample_id} screen={s} filter={stageFilter} />
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Submissions: the existing candidate-side feed. */}
      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          Submissions
        </h2>
        {error ? (
          <ErrorState
            className="mt-3"
            title="Couldn’t load activity"
            message={error}
            onRetry={load}
          />
        ) : loading ? (
          <div className="mt-3 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-200/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400">
              <Clock size={22} />
            </span>
            <p className="mt-4 font-medium text-ink">No activity yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Create a screen from the Assessments library and invite a candidate: submissions show up
              here.
            </p>
            <Link to="/app/library" className="btn-primary mt-5 inline-flex">
              Browse assessments <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {items.map((a) => {
              const st = STATUS[a.status] || { label: a.status, tone: 'neutral' }
              const when = a.submitted_at || a.started_at
              const done = a.status === 'submitted' || a.status === 'scored'
              return (
                <li key={a.submission_id}>
                  <Link
                    to={`/app/result?submission=${a.submission_id}`}
                    className="card flex items-center gap-4 p-4 transition-colors hover:border-clay-200"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                      {done ? <Check size={18} /> : <FileText size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{a.screen_title}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-stone-500">
                        <User size={13} /> {a.candidate || 'Candidate'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {when && <span className="text-xs text-stone-400">{timeAgo(when)}</span>}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
