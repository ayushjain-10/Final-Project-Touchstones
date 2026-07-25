import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import ScoreRing from '../../components/ScoreRing.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { api } from '../../services/api.js'
import { ShieldCheck, Sparkle, Check, Flag } from '../../components/icons.jsx'

// PUBLIC credential verification page. No auth required — this route lives OUTSIDE
// the VITE_APP_ENABLED gate so anyone with a verify link can confirm a result.
//
// GET /credentials/verify/:token -> { valid, score, direction_score, issued_at }.
// Everything is rendered as DATA only — no model/candidate free-text is injected.
function formatIssuedAt(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function Verify() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [credential, setCredential] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      if (!token) {
        setError('No credential token provided.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        // Prefer the richer verification (live audit-chain re-check + acceptance count); fall back
        // to the minimal verify if the rich endpoint is unavailable, so the error UX is unchanged.
        let res
        try {
          res = await api.verifyCredentialFull(token)
        } catch {
          res = await api.verifyCredential(token)
        }
        if (active) setCredential(res)
      } catch (e) {
        if (active) setError(e?.message || 'This credential could not be verified.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [token])

  const valid = credential?.valid === true
  const score = credential?.score != null ? Math.round(Number(credential.score)) : null
  const directionScore =
    credential?.direction_score != null ? Math.round(Number(credential.direction_score)) : null
  const issuedAt = formatIssuedAt(credential?.issued_at)
  // Live tamper-evidence: the backend recomputed the audit-chain head and compared it to the
  // hash bound at issue (true = matches, false = diverged/superseded, null/undefined = unknown).
  const chainConsistent = credential?.chain_consistent
  const acceptedCount = Number(credential?.accepted_count) || 0

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Logo />
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
            <ShieldCheck size={14} className="text-clay-500" /> Public verification
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        {loading ? (
          <p className="text-center text-stone-500">Verifying credential…</p>
        ) : error || !credential ? (
          <div className="card p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-flag-50 text-flag-700 ring-1 ring-flag-100">
              <Flag size={22} />
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-ink">Credential not verified</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
              {error || 'This credential could not be found or is no longer valid.'}
            </p>
            <Link to="/" className="btn-ghost mt-6 inline-flex px-4 py-2 text-sm">
              Go to Touchstones
            </Link>
          </div>
        ) : (
          <div className="card overflow-hidden">
            {/* Validity header */}
            <div className="flex items-center justify-between gap-4 border-b border-stone-200 bg-canvas/70 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  Verified credential
                </p>
                <h1 className="mt-1 font-serif text-xl font-semibold text-ink">
                  Touchstones result
                </h1>
              </div>
              <VerifiedBadge state={valid ? 'verified' : 'flagged'} size="sm" />
            </div>

            {valid ? (
              <>
                {/* Score */}
                <div className="flex flex-wrap items-center gap-6 px-6 py-7">
                  {score != null && <ScoreRing value={score} size={140} stroke={11} />}
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-clay-50 px-3 py-1 text-sm font-semibold text-clay-700 ring-1 ring-clay-200">
                      <Check size={15} /> Genuine, tamper-evident result
                    </span>
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-stone-600">
                      This score was computed in code from a rubric on a verified real-work screen —
                      not asserted by a model.
                    </p>
                    {/* Live trust signals from the richer verify (best-effort; absent on the
                        minimal-verify fallback). */}
                    {(chainConsistent === true || chainConsistent === false || acceptedCount > 0) && (
                      <div className="mt-3 space-y-1.5">
                        {chainConsistent === true && (
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-clay-700">
                            <ShieldCheck size={14} className="text-clay-500" /> Integrity chain re-verified just now
                          </p>
                        )}
                        {chainConsistent === false && (
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                            <Flag size={14} /> Scoring record changed since issue — review before relying on it
                          </p>
                        )}
                        {acceptedCount > 0 && (
                          <p className="block text-xs text-stone-500">
                            Accepted by {acceptedCount} hiring {acceptedCount === 1 ? 'team' : 'teams'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* AI-direction sub-score */}
                {directionScore != null && (
                  <div className="border-t border-stone-200 px-6 py-5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                        <Sparkle size={16} className="text-clay-500" /> How they directed the AI
                      </span>
                      <span className="font-serif text-2xl font-semibold tabular-nums text-ink">
                        {directionScore}
                        <span className="ml-0.5 text-sm font-medium text-stone-400">/100</span>
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-stone-500">
                      A measure of prompt quality, error catching, and verification rigor when using
                      AI on the screen.
                    </p>
                  </div>
                )}

                {/* Metadata */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-canvas/70 px-6 py-4">
                  <span className="inline-flex items-center gap-2 text-xs text-stone-500">
                    <ShieldCheck size={15} className="text-clay-500" />
                    {issuedAt ? `Issued ${issuedAt}` : 'Issued credential'}
                  </span>
                  <Link to="/" className="text-xs font-medium text-clay-700 hover:text-clay-800">
                    What is this? →
                  </Link>
                </div>
              </>
            ) : (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-stone-600">
                  This credential is no longer valid. It may have been revoked or has expired.
                </p>
                {issuedAt && (
                  <p className="mt-2 text-xs text-stone-400">Originally issued {issuedAt}</p>
                )}
              </div>
            )}
          </div>
        )}

        <p className="mx-auto mt-6 max-w-md text-center text-xs leading-relaxed text-stone-400">
          Touchstones verifies real-work screens with explainable, in-code scoring. Credentials are
          public and tamper-evident.
        </p>
      </main>
    </div>
  )
}
