import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import ScoreRing from '../../components/ScoreRing.jsx'
import { Skeleton } from '../../components/states.jsx'
import { api } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { ShieldCheck, Check, ArrowRight, Link as LinkIcon, Sparkle, ArrowUpRight } from '../../components/icons.jsx'

// PUBLIC "Apply with Touchstones" — a candidate reuses an existing VERIFIED credential to apply
// to an employer's open req instead of re-screening. Lives OUTSIDE the VITE_APP_ENABLED gate
// (like /verify, /passport): no app chrome. The req context is redacted server-side (no PII);
// everything renders as DATA only. The candidate signs in to attach one of THEIR OWN
// credentials — ownership is enforced server-side by RLS, never trusted from this page.

function formatDate(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-card placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100'

// One selectable verified credential the candidate can apply with.
function CredentialOption({ cred, selected, onSelect }) {
  const score = cred.score != null ? Math.round(Number(cred.score)) : null
  return (
    <button
      type="button"
      onClick={() => onSelect(cred)}
      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-colors ${
        selected ? 'border-clay-400 bg-clay-50 ring-1 ring-clay-200' : 'border-stone-200 bg-white hover:border-clay-200'
      }`}
    >
      <span className="font-serif text-2xl font-semibold tabular-nums text-ink">
        {score != null ? score : '—'}
        <span className="ml-0.5 text-xs font-medium text-stone-400">/100</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{cred.title || 'Verified real-work screen'}</p>
        <p className="mt-0.5 text-xs text-stone-500">
          Issued {formatDate(cred.issued_at) || '—'}
          {cred.reuse_count > 0 && ` · accepted by ${cred.reuse_count} team${cred.reuse_count === 1 ? '' : 's'}`}
        </p>
      </div>
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
          selected ? 'border-clay-500 bg-clay-500 text-white' : 'border-stone-300'
        }`}
      >
        {selected && <Check size={12} />}
      </span>
    </button>
  )
}

export default function Apply() {
  const { token } = useParams()
  const { user, loading: authLoading, configured } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reqCtx, setReqCtx] = useState(null) // { title, role_family, company_label, is_open, created_at }

  // load the public, redacted req context
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api
      .getReqPublic(token)
      .then((res) => {
        if (active) setReqCtx(res?.req || null)
      })
      .catch((e) => {
        if (active) setError(e?.status === 404 ? 'notfound' : e?.message || 'Could not load this req.')
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [token])

  // candidate's own verified credentials (only when signed in)
  const [creds, setCreds] = useState(null)
  const [credsLoading, setCredsLoading] = useState(false)
  const [selected, setSelected] = useState(null) // selected credential
  const [verif, setVerif] = useState(null) // tamper-evident verification of the selected credential
  const [note, setNote] = useState('')

  const loadCreds = useCallback(() => {
    if (!user) return
    setCredsLoading(true)
    api
      .getNetworkCredentials()
      .then((res) => {
        const live = (res?.credentials || []).filter((c) => !c.revoked)
        setCreds(live)
        if (live.length === 1) setSelected(live[0])
      })
      .catch(() => setCreds([]))
      .finally(() => setCredsLoading(false))
  }, [user])
  useEffect(() => loadCreds(), [loadCreds])

  // when a credential is selected, fetch its tamper-evident verification (reuses the existing
  // public verify machinery — digest + audit-chain consistency + network counter).
  useEffect(() => {
    let active = true
    setVerif(null)
    if (!selected?.token) return
    api
      .verifyCredentialFull(selected.token)
      .then((res) => active && setVerif(res))
      .catch(() => active && setVerif(null))
    return () => {
      active = false
    }
  }, [selected])

  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState(null)
  const [applied, setApplied] = useState(false)

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setSubmitErr(null)
    try {
      await api.applyWithCredential({ reqToken: token, credentialId: selected.id, note })
      setApplied(true)
    } catch (e) {
      setSubmitErr(e?.message || 'Could not submit your application.')
    } finally {
      setSubmitting(false)
    }
  }

  const roleLine = [reqCtx?.role_family, reqCtx?.company_label].filter(Boolean).join(' · ')
  const score = selected?.score != null ? Math.round(Number(selected.score)) : null
  const dir = verif?.direction_score != null ? Math.round(Number(verif.direction_score)) : null

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Logo />
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
            <LinkIcon size={14} className="text-clay-500" /> Apply with Touchstones
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
          </div>
        ) : error === 'notfound' || !reqCtx ? (
          <div className="card p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400">
              <LinkIcon size={22} />
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-ink">Req not found</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
              This apply link is invalid or has been removed.
            </p>
            <Link to="/" className="btn-ghost mt-6 inline-flex px-4 py-2 text-sm">
              Go to Touchstones
            </Link>
          </div>
        ) : error ? (
          <div className="card p-8 text-center">
            <h1 className="text-2xl font-semibold text-ink">Couldn’t load this req</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">{error}</p>
          </div>
        ) : (
          <>
            {/* Req header */}
            <div className="flex items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-clay-500 text-white shadow-card">
                <LinkIcon size={26} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Open req</p>
                <h1 className="truncate font-serif text-3xl font-semibold leading-tight text-ink">{reqCtx.title}</h1>
                {roleLine && <p className="mt-1 text-stone-600">{roleLine}</p>}
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-400">
                  <ShieldCheck size={13} className="text-clay-500" />
                  Apply with a verified result — no re-screen.
                </p>
              </div>
            </div>

            {!reqCtx.is_open ? (
              <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
                <p className="font-serif text-lg font-semibold text-ink">This req is closed</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
                  It’s no longer accepting applications.
                </p>
              </div>
            ) : applied ? (
              <div className="card mt-8 p-8 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                  <Check size={24} />
                </span>
                <h2 className="mt-4 font-serif text-xl font-semibold text-ink">Applied with your verified result</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
                  The team receives your cryptographically verified score — tied to proof-of-human and the
                  immutable audit chain. They can accept it without asking you to re-screen.
                </p>
              </div>
            ) : authLoading ? (
              <div className="mt-8 space-y-3">
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-20 w-full rounded-2xl" />
              </div>
            ) : !configured || !user ? (
              <div className="card mt-8 p-8 text-center">
                <h2 className="font-serif text-xl font-semibold text-ink">Sign in to apply</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
                  Sign in to choose one of your verified Touchstones results and apply to this req with it.
                </p>
                <Link to="/login" className="btn-primary mt-6 inline-flex px-5 py-2.5 text-sm">
                  Sign in <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <div className="mt-8 space-y-5">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                    Choose a verified result to apply with
                  </h2>
                  {credsLoading ? (
                    <div className="mt-3 space-y-2.5">
                      <Skeleton className="h-16 w-full rounded-2xl" />
                      <Skeleton className="h-16 w-full rounded-2xl" />
                    </div>
                  ) : !creds || creds.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-canvas/40 p-8 text-center">
                      <p className="text-sm font-medium text-ink">No verified results yet</p>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
                        Complete a Touchstones real-work screen to earn a verifiable credential, then apply with it.
                      </p>
                    </div>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {creds.map((c) => (
                        <li key={c.id}>
                          <CredentialOption cred={c} selected={selected?.id === c.id} onSelect={setSelected} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Tamper-evident verification preview of the selected credential */}
                {selected && (
                  <div className="card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-6 py-4">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-clay-700">
                        <Check size={16} /> Genuine, tamper-evident result
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-2.5 py-1 text-xs font-medium text-clay-700">
                        <ShieldCheck size={13} /> Touchstones-verified
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-6 px-6 py-6">
                      {score != null && <ScoreRing value={score} size={104} stroke={9} />}
                      <div className="min-w-0 flex-1">
                        {dir != null && (
                          <p className="text-sm text-stone-600">
                            AI direction <span className="font-semibold text-ink">{dir}/100</span>
                          </p>
                        )}
                        {verif?.digest_hash && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
                            <ShieldCheck size={13} className="text-clay-500" /> Bound to the audit chain ·{' '}
                            <span className="font-mono text-stone-400">{String(verif.digest_hash).slice(0, 16)}…</span>
                          </p>
                        )}
                        {verif?.chain_consistent === true && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-clay-700">
                            <Check size={13} /> Audit chain re-verified live
                          </p>
                        )}
                        <Link
                          to={`/verify/${selected.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
                        >
                          Independently verify <ArrowUpRight size={13} />
                        </Link>
                      </div>
                    </div>
                    <div className="border-t border-stone-200 bg-canvas/40 px-6 py-5">
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
                        Add a note (optional)
                      </label>
                      <input
                        className={`${inputCls} mt-1`}
                        placeholder="A line for the hiring team (optional)"
                        value={note}
                        maxLength={280}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        onClick={submit}
                        disabled={submitting}
                        className="btn-primary mt-3 inline-flex disabled:opacity-60"
                      >
                        {submitting ? 'Applying…' : 'Apply with this credential'} <ArrowRight size={16} />
                      </button>
                      {submitErr && <p className="mt-2 text-sm text-flag-700">{submitErr}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <p className="mx-auto mt-8 max-w-md text-center text-xs leading-relaxed text-stone-400">
          <Sparkle size={12} className="mr-1 inline text-clay-500" />
          One verified screen, reused across employers. Each credential is independently verifiable and
          tamper-evident — the candidate controls where it’s used.
        </p>
      </main>
    </div>
  )
}
