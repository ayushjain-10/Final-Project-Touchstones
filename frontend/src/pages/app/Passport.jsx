import { useCallback, useEffect, useState } from 'react'
import { Container, Pill } from '../../components/primitives.jsx'
import ScoreRing from '../../components/ScoreRing.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { Skeleton, ErrorState } from '../../components/states.jsx'
import { api } from '../../services/api.js'
import {
  Fingerprint,
  ShieldCheck,
  Sparkle,
  Check,
  Link as LinkIcon,
  ArrowRight,
  Eye,
  Plus,
  X,
} from '../../components/icons.jsx'

// Pull the opaque token out of a pasted verify link OR a raw token.
function tokenFromInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/([0-9a-zA-Z]+)\/?$/)
  return m ? m[1] : s
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-card placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100'

// ───────────────────────── My Passport (candidate controls) ─────────────────────────
function MyPassportTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [passport, setPassport] = useState(null)
  const [entries, setEntries] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getMyPassport()
      .then((res) => {
        setPassport(res?.passport || null)
        setEntries(Array.isArray(res?.entries) ? res.entries : [])
      })
      .catch((e) => setError(e?.message || 'Could not load your passport.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(), [load])

  // claim form state
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [headline, setHeadline] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimErr, setClaimErr] = useState(null)

  async function claim(e) {
    e?.preventDefault?.()
    setClaiming(true)
    setClaimErr(null)
    try {
      await api.createPassport({ handle, display_name: displayName, headline })
      load()
    } catch (err) {
      setClaimErr(err?.message || 'Could not claim that handle.')
    } finally {
      setClaiming(false)
    }
  }

  // add-entry + management state
  const [tokenInput, setTokenInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState(null)
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const shareUrl =
    passport && typeof window !== 'undefined' ? `${window.location.origin}/passport/${passport.handle}` : ''

  async function addEntry(e) {
    e?.preventDefault?.()
    const token = tokenFromInput(tokenInput)
    if (!token) return
    setAdding(true)
    setAddErr(null)
    try {
      await api.addPassportEntry({ token })
      setTokenInput('')
      load()
    } catch (err) {
      setAddErr(err?.message || 'Could not add that result.')
    } finally {
      setAdding(false)
    }
  }

  async function toggleVisible(entry) {
    setBusyId(entry.id)
    try {
      await api.updatePassportEntry(entry.id, { is_visible: !entry.is_visible })
      setEntries((es) => es.map((x) => (x.id === entry.id ? { ...x, is_visible: !x.is_visible } : x)))
    } catch {
      /* keep state; load() would re-sync */
    } finally {
      setBusyId(null)
    }
  }

  async function removeEntry(entry) {
    setBusyId(entry.id)
    const prev = entries
    setEntries((es) => es.filter((x) => x.id !== entry.id))
    try {
      await api.deletePassportEntry(entry.id)
    } catch {
      setEntries(prev)
    } finally {
      setBusyId(null)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function togglePublic() {
    if (!passport) return
    const next = !passport.is_public
    setPassport((p) => ({ ...p, is_public: next }))
    try {
      await api.updatePassport({ is_public: next })
    } catch {
      setPassport((p) => ({ ...p, is_public: !next }))
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    )
  }
  if (error) return <ErrorState title="Couldn’t load your passport" message={error} onRetry={load} />

  // ── No passport yet → claim form ──
  if (!passport) {
    return (
      <div className="max-w-xl">
        <div className="card p-6">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <Fingerprint size={18} className="text-clay-500" /> Claim your Passport
          </span>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            A portable, shareable profile of your verified results — scored real work tied to
            proof-of-human. You control what’s public; share one link with any employer.
          </p>
          <form onSubmit={claim} className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Handle</label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-stone-400">/passport/</span>
                <input
                  className={inputCls}
                  placeholder="jane-doe"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  required
                />
              </div>
              <p className="mt-1 text-xs text-stone-400">3–32 lowercase letters, numbers, or single hyphens.</p>
            </div>
            <input
              className={inputCls}
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder="Headline — e.g. Senior Backend Engineer (optional)"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
            {claimErr && <p className="text-sm text-flag-700">{claimErr}</p>}
            <button type="submit" disabled={claiming} className="btn-primary disabled:opacity-60">
              {claiming ? 'Claiming…' : 'Claim Passport'} <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Has a passport → management ──
  return (
    <div className="max-w-2xl space-y-6">
      {/* Header + share link */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 font-serif text-lg font-semibold text-ink">
              <Fingerprint size={18} className="text-clay-500" /> {passport.display_name || `@${passport.handle}`}
            </span>
            {passport.headline && <p className="mt-0.5 text-sm text-stone-500">{passport.headline}</p>}
          </div>
          <button
            type="button"
            onClick={togglePublic}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              passport.is_public
                ? 'border-clay-200 bg-clay-50 text-clay-700'
                : 'border-stone-200 bg-stone-100 text-stone-500'
            }`}
            title="Toggle whether your passport is publicly visible"
          >
            <Eye size={13} /> {passport.is_public ? 'Public' : 'Private'}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-xs`} />
          <button onClick={copyLink} className="btn-ghost shrink-0 px-3 py-2 text-xs">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="btn-quiet shrink-0 px-2 text-xs">
            View
          </a>
        </div>
      </div>

      {/* Add a result */}
      <div className="card p-6">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <Plus size={16} className="text-clay-500" /> Add a verified result
        </span>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">
          Paste a Touchstones credential link (or token) for a screen you completed. It must be a
          credential issued to you.
        </p>
        <form onSubmit={addEntry} className="mt-3 flex items-center gap-2">
          <input
            className={inputCls}
            placeholder="https://…/verify/abc123  or  abc123"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button type="submit" disabled={adding || !tokenInput.trim()} className="btn-primary shrink-0 disabled:opacity-60">
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
        {addErr && <p className="mt-2 text-sm text-flag-700">{addErr}</p>}
      </div>

      {/* Entries */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          Your results ({entries.length})
        </h3>
        {entries.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-canvas/40 p-8 text-center">
            <p className="text-sm font-medium text-ink">No results on your passport yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Add a credential link above and it’ll appear on your public passport.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {entries.map((e) => (
              <li key={e.id} className="card flex items-center gap-4 p-4">
                <span className="font-serif text-xl font-semibold tabular-nums text-ink">
                  {e.score != null ? Math.round(Number(e.score)) : '—'}
                  <span className="ml-0.5 text-xs font-medium text-stone-400">/100</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{e.title || 'Verified screen'}</p>
                  <p className="inline-flex items-center gap-2 text-xs text-stone-500">
                    <VerifiedBadge state={e.proof_of_human || 'review'} size="sm" />
                    {e.role_family || ''}
                  </p>
                </div>
                <button
                  onClick={() => toggleVisible(e)}
                  disabled={busyId === e.id}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                    e.is_visible
                      ? 'border-clay-200 bg-clay-50 text-clay-700'
                      : 'border-stone-200 bg-stone-100 text-stone-400'
                  }`}
                >
                  {e.is_visible ? 'Visible' : 'Hidden'}
                </button>
                <button
                  onClick={() => removeEntry(e)}
                  disabled={busyId === e.id}
                  aria-label="Remove result"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-stone-300 hover:bg-stone-100 hover:text-flag-700 disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Accept a credential (recruiter) ─────────────────────────
function AcceptTab() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [cred, setCred] = useState(null) // { valid, score, direction_score, digest_hash, issued_at, accepted_count }
  const [token, setToken] = useState('')

  const [reqLabel, setReqLabel] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [acceptErr, setAcceptErr] = useState(null)

  async function lookup(e) {
    e?.preventDefault?.()
    const t = tokenFromInput(input)
    if (!t) return
    setLoading(true)
    setError(null)
    setCred(null)
    setAccepted(false)
    setAcceptErr(null)
    setToken(t)
    try {
      const res = await api.verifyCredentialFull(t)
      setCred(res)
    } catch (err) {
      setError(err?.status === 404 ? 'No valid credential found at that link.' : err?.message || 'Could not verify.')
    } finally {
      setLoading(false)
    }
  }

  async function accept() {
    setAccepting(true)
    setAcceptErr(null)
    try {
      const res = await api.acceptCredential(token, reqLabel)
      setAccepted(true)
      if (res && res.accepted_count != null) setCred((c) => ({ ...c, accepted_count: res.accepted_count }))
    } catch (err) {
      setAcceptErr(err?.message || 'Could not accept this credential.')
    } finally {
      setAccepting(false)
    }
  }

  const score = cred?.score != null ? Math.round(Number(cred.score)) : null
  const dir = cred?.direction_score != null ? Math.round(Number(cred.direction_score)) : null

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <ShieldCheck size={18} className="text-clay-500" /> Accept an existing credential
        </span>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">
          Skip the re-screen. Paste a candidate’s Touchstones credential link — confirm it’s
          cryptographically verified, then accept it for one of your reqs.
        </p>
        <form onSubmit={lookup} className="mt-4 flex items-center gap-2">
          <input
            className={inputCls}
            placeholder="https://…/verify/abc123  or  abc123"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" disabled={loading || !input.trim()} className="btn-primary shrink-0 disabled:opacity-60">
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-flag-700">{error}</p>}
      </div>

      {loading && <Skeleton className="h-48 w-full rounded-2xl" />}

      {cred && cred.valid && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-6 py-4">
            {/* Only affirm "tamper-evident" when the audit chain was actually RE-VERIFIED live
                (chain_consistent === true). false = the bound score is gone/superseded or the
                chain didn't recompute → warn, never reassure. null = couldn't re-check right now. */}
            {cred.chain_consistent === false ? (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-flag-700">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-flag-100 text-[10px] font-bold text-flag-700">!</span>
                Audit chain could not be re-verified — may be tampered or superseded
              </span>
            ) : cred.chain_consistent === true ? (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-clay-700">
                <Check size={16} /> Genuine · audit chain re-verified live
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600">
                <ShieldCheck size={16} className="text-stone-400" /> Verified credential
              </span>
            )}
            <Pill tone="clay">
              <ShieldCheck size={12} /> Accepted by {cred.accepted_count ?? 0} team
              {(cred.accepted_count ?? 0) === 1 ? '' : 's'}
            </Pill>
          </div>
          <div className="flex flex-wrap items-center gap-6 px-6 py-6">
            {score != null && <ScoreRing value={score} size={120} stroke={10} />}
            <div className="min-w-0 flex-1">
              {dir != null && (
                <p className="text-sm text-stone-600">
                  AI direction <span className="font-semibold text-ink">{dir}/100</span>
                </p>
              )}
              {cred.digest_hash && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
                  <ShieldCheck size={13} className="text-clay-500" /> Bound to the audit chain ·{' '}
                  <span className="font-mono text-stone-400">{String(cred.digest_hash).slice(0, 16)}…</span>
                </p>
              )}
              <p className="mt-3 max-w-sm text-xs leading-relaxed text-stone-500">
                Verified against the immutable integrity chain — the score was computed in code from a
                rubric on a real-work screen, tied to proof-of-human.
              </p>
            </div>
          </div>

          {/* Accept action */}
          <div className="border-t border-stone-200 bg-canvas/40 px-6 py-5">
            {accepted ? (
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-clay-700">
                <Check size={16} /> Accepted{reqLabel ? ` for “${reqLabel}”` : ''}. No re-screen needed.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
                    Attach to a req (optional)
                  </label>
                  <input
                    className={`${inputCls} mt-1`}
                    placeholder="e.g. Senior Backend Engineer — Q3"
                    value={reqLabel}
                    onChange={(e) => setReqLabel(e.target.value)}
                  />
                </div>
                <button onClick={accept} disabled={accepting} className="btn-primary shrink-0 disabled:opacity-60">
                  {accepting ? 'Accepting…' : 'Accept credential'} <ArrowRight size={16} />
                </button>
              </div>
            )}
            {acceptErr && <p className="mt-2 text-sm text-flag-700">{acceptErr}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Page shell ─────────────────────────
export default function Passport() {
  const [tab, setTab] = useState('mine')
  const tabs = [
    { key: 'mine', label: 'My Passport', icon: Fingerprint },
    { key: 'accept', label: 'Accept a credential', icon: ShieldCheck },
  ]
  return (
    <Container className="py-8 lg:py-10">
      <div>
        <h1 className="inline-flex items-center gap-2 text-3xl font-semibold leading-tight">
          <LinkIcon size={24} className="text-clay-500" /> Passport
        </h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          A portable, verifiable proof-of-capability credential — and a two-sided network. Share your
          verified results, or accept a candidate’s existing credential instead of re-screening.
        </p>
      </div>

      <div className="mt-6 flex gap-1.5 border-b border-stone-200">
        {tabs.map((t) => {
          const Icon = t.icon
          const on = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                on ? 'border-clay-500 text-ink' : 'border-transparent text-stone-500 hover:text-ink'
              }`}
            >
              <Icon size={16} className={on ? 'text-clay-500' : 'text-stone-400'} /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="mt-8">{tab === 'mine' ? <MyPassportTab /> : <AcceptTab />}</div>
    </Container>
  )
}
