import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api.js'
import { Pill } from '../../components/primitives.jsx'
import { ShieldCheck, Check } from '../../components/icons.jsx'
import { formatDate } from '../../lib/portalFormat.js'

// Founder-only: the recruiter-access approval queue. A candidate who requested hiring-team access
// shows up here; approving flips them to a verified recruiter (and emails them). Non-founders get a
// clean 403 from the API, which we render as "no access".
export default function RecruiterRequests() {
  const [requests, setRequests] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // id currently being actioned

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getRecruiterRequests()
      .then((res) => setRequests(res?.requests || []))
      .catch((err) => setError(err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(userId, decision) {
    setBusy(userId)
    try {
      await api.approveRecruiter(userId, decision)
      setRequests((rs) => (rs || []).filter((r) => r.id !== userId))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  const forbidden = error && error.status === 403

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-clay-500" />
        <h1 className="font-serif text-2xl font-semibold text-ink">Recruiter access requests</h1>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        People who asked to use Touchstones as a hiring team. Approve to make them a verified recruiter.
      </p>

      {loading && <p className="mt-8 text-sm text-stone-400">Loading…</p>}

      {forbidden && (
        <div className="mt-8 rounded-2xl border border-stone-200 bg-canvas/60 p-6 text-sm text-stone-600">
          You don’t have access to the approval queue.
        </div>
      )}

      {error && !forbidden && (
        <div className="mt-8 rounded-2xl border border-flag-100 bg-flag-50/50 p-5 text-sm">
          <p className="font-medium text-flag-700">Couldn’t load requests</p>
          <p className="mt-1 text-stone-600">{error.message || 'Please try again.'}</p>
          <button onClick={load} className="mt-3 rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-700 hover:border-clay-300">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && (requests || []).length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-canvas/40 px-6 py-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-clay-50 text-clay-500 ring-1 ring-clay-200">
            <Check size={22} />
          </span>
          <p className="mt-4 font-medium text-ink">No pending requests</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-stone-600">You’re all caught up.</p>
        </div>
      )}

      {!loading && !error && (requests || []).length > 0 && (
        <div className="mt-6 space-y-3">
          {requests.map((r) => {
            const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-canvas/60 p-5">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{name}</p>
                  <p className="mt-0.5 text-sm text-stone-600">
                    {r.email}
                    {r.company && <span className="text-stone-400"> · {r.company}</span>}
                    {r.updated_at && <span className="text-stone-400"> · {formatDate(r.updated_at)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone="amber">Pending</Pill>
                  <button
                    onClick={() => act(r.id, 'reject')}
                    disabled={busy === r.id}
                    className="rounded-xl border border-stone-200 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-600 hover:border-stone-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => act(r.id, 'verify')}
                    disabled={busy === r.id}
                    className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
                  >
                    {busy === r.id ? '…' : 'Approve'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
