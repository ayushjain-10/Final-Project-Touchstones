import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import ScoreRing from '../../components/ScoreRing.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { Skeleton } from '../../components/states.jsx'
import { api } from '../../services/api.js'
import { ShieldCheck, Fingerprint, ArrowUpRight, Sparkle, Check } from '../../components/icons.jsx'

// PUBLIC Touchstones Passport — a candidate-owned, shareable proof-of-capability
// profile. Lives OUTSIDE the VITE_APP_ENABLED gate (like /verify) so a passport
// link works for anyone. Everything is rendered as DATA only — the API redacts to
// non-PII fields; we never inject model/candidate free-text as HTML.

function formatDate(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// percentile = share of screens at or below this score → "Top X%".
function topLabel(percentile) {
  if (percentile == null || !Number.isFinite(Number(percentile))) return null
  const top = Math.max(1, Math.min(99, 100 - Math.round(Number(percentile))))
  return `Top ${top}%`
}

function EntryCard({ entry }) {
  const score = entry.score != null ? Math.round(Number(entry.score)) : null
  const dir = entry.direction_score != null ? Math.round(Number(entry.direction_score)) : null
  const top = topLabel(entry.percentile)
  return (
    <li className="card overflow-hidden">
      <div className="flex items-start gap-5 p-5 sm:p-6">
        {score != null && (
          <div className="shrink-0">
            <ScoreRing value={score} size={96} stroke={9} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <VerifiedBadge state={entry.proof_of_human || 'review'} size="sm" />
            {top && (
              <span className="inline-flex items-center gap-1 rounded-full bg-clay-50 px-2.5 py-1 text-xs font-semibold text-clay-700 ring-1 ring-clay-200">
                <Sparkle size={12} className="text-clay-500" /> {top}
              </span>
            )}
          </div>
          <h3 className="mt-2 truncate font-serif text-lg font-semibold text-ink">
            {entry.title || 'Verified real-work screen'}
          </h3>
          {entry.role_family && <p className="text-sm text-stone-500">{entry.role_family}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
            {dir != null && (
              <span className="inline-flex items-center gap-1.5">
                <Sparkle size={13} className="text-clay-500" /> AI direction {dir}/100
              </span>
            )}
            {entry.issued_at && <span>Issued {formatDate(entry.issued_at)}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-stone-200 bg-canvas/70 px-5 py-3 sm:px-6">
        <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
          <Check size={14} className="text-clay-500" /> Scored in code · tamper-evident
        </span>
        {entry.token && (
          <Link
            to={`/verify/${entry.token}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
          >
            Verify <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
    </li>
  )
}

export default function PassportPublic() {
  const { handle } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [passport, setPassport] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await api.getPassport(handle)
        if (active) setPassport(res)
      } catch (e) {
        if (active) setError(e?.status === 404 ? 'notfound' : e?.message || 'Could not load this passport.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [handle])

  const entries = Array.isArray(passport?.entries) ? passport.entries : []
  const name = passport?.display_name || (handle ? `@${handle}` : 'Passport')

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Logo />
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
            <Fingerprint size={14} className="text-clay-500" /> Touchstones Passport
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : error === 'notfound' || !passport ? (
          <div className="card p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400">
              <Fingerprint size={22} />
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-ink">Passport not found</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
              No public passport exists at this link, or it isn’t shared publicly.
            </p>
            <Link to="/" className="btn-ghost mt-6 inline-flex px-4 py-2 text-sm">
              Go to Touchstones
            </Link>
          </div>
        ) : error ? (
          <div className="card p-8 text-center">
            <h1 className="text-2xl font-semibold text-ink">Couldn’t load this passport</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">{error}</p>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className="flex items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-clay-500 text-white shadow-card">
                <Fingerprint size={26} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate font-serif text-3xl font-semibold leading-tight text-ink">{name}</h1>
                {passport.headline && <p className="mt-1 text-stone-600">{passport.headline}</p>}
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-400">
                  <ShieldCheck size={13} className="text-clay-500" />
                  {entries.length} verified result{entries.length === 1 ? '' : 's'} · proof-of-human · tamper-evident
                </p>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
                <p className="font-serif text-lg font-semibold text-ink">No public results yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
                  This person hasn’t made any verified results public on their passport.
                </p>
              </div>
            ) : (
              <ul className="mt-8 space-y-4">
                {entries.map((e, i) => (
                  <EntryCard key={e.token || i} entry={e} />
                ))}
              </ul>
            )}
          </>
        )}

        <p className="mx-auto mt-8 max-w-md text-center text-xs leading-relaxed text-stone-400">
          A Touchstones Passport carries scored real-work results tied to proof-of-human — each one
          independently verifiable and tamper-evident. The candidate controls what’s public.
        </p>
      </main>
    </div>
  )
}
