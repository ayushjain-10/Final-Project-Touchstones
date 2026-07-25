import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Container, Pill } from '../../components/primitives.jsx'
import ScoreRing from '../../components/ScoreRing.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { Skeleton, ErrorState } from '../../components/states.jsx'
import { api } from '../../services/api.js'
import {
  Link as LinkIcon,
  ShieldCheck,
  Check,
  ArrowRight,
  ArrowUpRight,
  Plus,
  X,
  Sparkle,
  Clock,
} from '../../components/icons.jsx'

// Candidate Network / "Apply with Touchstones" (CC3/v3) — the candidate's home base PLUS the
// employer inbox, so the whole reuse loop is demoable: a candidate applies to a req with a
// verified credential; the employer sees it cryptographically verified and accepts it without
// re-screening; the network counter reflects the acceptance.

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-card placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100'

function tokenFromInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/([0-9a-zA-Z]+)\/?$/)
  return m ? m[1] : s
}

function formatDate(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const statusTone = {
  submitted: 'border-stone-200 bg-stone-100 text-stone-600',
  accepted: 'border-clay-200 bg-clay-50 text-clay-700',
  declined: 'border-stone-200 bg-stone-100 text-stone-400',
  withdrawn: 'border-stone-200 bg-stone-100 text-stone-400',
}

// Honest verification signal: render the REAL proof-of-human snapshot (server-authoritative,
// migration 061) when we have it; otherwise a neutral "Touchstones-verified · tamper-evident"
// pill — true for any genuine credential. Never fabricate a "Verified human" verdict.
function VerifiedSignal({ proof }) {
  if (proof) return <VerifiedBadge state={proof} size="sm" />
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-2.5 py-1 text-xs font-medium text-clay-700">
      <ShieldCheck size={13} /> Touchstones-verified
    </span>
  )
}

// ───────────────────────── Candidate side ─────────────────────────
function CandidateTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creds, setCreds] = useState([])
  const [apps, setApps] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([api.getNetworkCredentials(), api.getMyApplications()])
      .then(([c, a]) => {
        setCreds(Array.isArray(c?.credentials) ? c.credentials : [])
        setApps(Array.isArray(a?.applications) ? a.applications : [])
      })
      .catch((e) => setError(e?.message || 'Could not load your network.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(), [load])

  // apply flow
  const [selected, setSelected] = useState(null) // credential being applied with
  const [reqInput, setReqInput] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState(null)
  const [applyOk, setApplyOk] = useState(false)

  function startApply(cred) {
    setSelected(cred)
    setApplyErr(null)
    setApplyOk(false)
    setReqInput('')
  }

  async function submitApply(e) {
    e?.preventDefault?.()
    const reqToken = tokenFromInput(reqInput)
    if (!reqToken || !selected) return
    setApplying(true)
    setApplyErr(null)
    try {
      await api.applyWithCredential({ reqToken, credentialId: selected.id })
      setApplyOk(true)
      setSelected(null)
      load()
    } catch (err) {
      setApplyErr(err?.message || 'Could not apply with that credential.')
    } finally {
      setApplying(false)
    }
  }

  async function withdraw(app) {
    const prev = apps
    setApps((xs) => xs.filter((x) => x.id !== app.id))
    try {
      await api.withdrawApplication(app.id)
    } catch {
      setApps(prev)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }
  if (error) return <ErrorState title="Couldn’t load your network" message={error} onRetry={load} />

  return (
    <div className="max-w-2xl space-y-6">
      {/* Passport hint */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkle size={16} className="text-clay-500" /> Reuse your verified work
          </p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            One screen, reused across employers. Manage your public profile on your Passport.
          </p>
        </div>
        <RouterLink to="/app/passport" className="btn-ghost shrink-0 px-3 py-2 text-xs">
          Open Passport <ArrowUpRight size={14} />
        </RouterLink>
      </div>

      {applyOk && (
        <p className="inline-flex items-center gap-2 rounded-xl border border-clay-200 bg-clay-50 px-3 py-2 text-sm font-medium text-clay-700">
          <Check size={16} /> Applied. The team will see your cryptographically verified result.
        </p>
      )}

      {/* My verified results */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          Your verified results ({creds.length})
        </h3>
        {creds.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-canvas/40 p-8 text-center">
            <p className="text-sm font-medium text-ink">No verified results yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Complete a Touchstones real-work screen to earn a verifiable credential you can reuse.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {creds.map((c) => {
              const score = c.score != null ? Math.round(Number(c.score)) : null
              return (
                <li key={c.id} className="card p-4">
                  <div className="flex items-center gap-4">
                    <span className="font-serif text-xl font-semibold tabular-nums text-ink">
                      {score != null ? score : '—'}
                      <span className="ml-0.5 text-xs font-medium text-stone-400">/100</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="inline-flex flex-wrap items-center gap-2 text-xs text-stone-500">
                        <VerifiedSignal proof={c.proof_of_human} />
                        {c.reuse_count > 0 && (
                          <Pill tone="clay">
                            <ShieldCheck size={11} /> Accepted by {c.reuse_count} team{c.reuse_count === 1 ? '' : 's'}
                          </Pill>
                        )}
                        {c.on_passport && <span className="text-stone-400">· On your Passport</span>}
                      </p>
                      <p className="mt-1 text-xs text-stone-400">
                        Issued {formatDate(c.issued_at) || '—'}
                        {c.application_count > 0 && ` · applied to ${c.application_count} req${c.application_count === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    {c.revoked ? (
                      <span className="shrink-0 rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-xs text-stone-400">
                        Revoked
                      </span>
                    ) : (
                      <button onClick={() => startApply(c)} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
                        Apply with this
                      </button>
                    )}
                  </div>

                  {/* inline apply form for the selected credential */}
                  {selected?.id === c.id && (
                    <form onSubmit={submitApply} className="mt-3 border-t border-stone-200 pt-3">
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
                        Paste the employer’s apply link
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          autoFocus
                          className={inputCls}
                          placeholder="https://…/apply/abc123  or  abc123"
                          value={reqInput}
                          onChange={(e) => setReqInput(e.target.value)}
                        />
                        <button
                          type="submit"
                          disabled={applying || !reqInput.trim()}
                          className="btn-primary shrink-0 disabled:opacity-60"
                        >
                          {applying ? 'Applying…' : 'Apply'} <ArrowRight size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelected(null)}
                          aria-label="Cancel"
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-stone-300 hover:bg-stone-100 hover:text-ink"
                        >
                          <X size={15} />
                        </button>
                      </div>
                      {applyErr && <p className="mt-2 text-sm text-flag-700">{applyErr}</p>}
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* My applications */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          Your applications ({apps.length})
        </h3>
        {apps.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            You haven’t applied to any reqs yet. Paste an employer’s apply link above to reuse a verified result.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {apps.map((a) => (
              <li key={a.id} className="card flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {a.req?.title || 'Open req'}
                    {a.req?.company_label && <span className="text-stone-400"> · {a.req.company_label}</span>}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-stone-400">
                    <Clock size={12} /> {formatDate(a.created_at) || ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${
                    statusTone[a.status] || statusTone.submitted
                  }`}
                >
                  {a.status}
                </span>
                {a.status === 'submitted' && (
                  <button
                    onClick={() => withdraw(a)}
                    aria-label="Withdraw application"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-stone-300 hover:bg-stone-100 hover:text-flag-700"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Employer side (req owner) ─────────────────────────
function ReqInbox({ reqId }) {
  const [loading, setLoading] = useState(true)
  const [apps, setApps] = useState([])
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .getReqApplications(reqId)
      .then((res) => setApps(Array.isArray(res?.applications) ? res.applications : []))
      .catch(() => setApps([]))
      .finally(() => setLoading(false))
  }, [reqId])
  useEffect(() => load(), [load])

  async function accept(app) {
    setBusyId(app.id)
    try {
      const res = await api.acceptApplication(app.id)
      setApps((xs) =>
        xs.map((x) =>
          x.id === app.id
            ? { ...x, status: 'accepted', accepted_count: res?.accepted_count ?? x.accepted_count }
            : x,
        ),
      )
    } catch {
      /* keep state */
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <Skeleton className="mt-3 h-20 w-full rounded-2xl" />
  if (apps.length === 0) {
    return <p className="mt-3 text-sm text-stone-500">No applications yet. Share the apply link to receive verified results.</p>
  }

  return (
    <ul className="mt-3 space-y-2.5">
      {apps.map((a) => {
        const score = a.score != null ? Math.round(Number(a.score)) : null
        return (
          <li key={a.id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-4">
              {score != null && <ScoreRing value={score} size={64} stroke={7} />}
              <div className="min-w-0 flex-1">
                <p className="inline-flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <VerifiedSignal proof={a.proof_of_human} />
                  {a.accepted_count > 0 && (
                    <Pill tone="clay">
                      <ShieldCheck size={11} /> {a.accepted_count} team{a.accepted_count === 1 ? '' : 's'}
                    </Pill>
                  )}
                  {a.candidate_handle && (
                    <RouterLink
                      to={`/passport/${a.candidate_handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-clay-700 hover:text-clay-800"
                    >
                      @{a.candidate_handle}
                    </RouterLink>
                  )}
                </p>
                {a.digest_hash && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-400">
                    <ShieldCheck size={12} className="text-clay-500" /> Tamper-evident ·{' '}
                    <span className="font-mono">{String(a.digest_hash).slice(0, 14)}…</span>
                  </p>
                )}
                {a.note && <p className="mt-1 max-w-md text-xs italic text-stone-500">“{a.note}”</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RouterLink to={`/verify/${a.token}`} target="_blank" rel="noreferrer" className="btn-quiet px-2 text-xs">
                  Verify
                </RouterLink>
                {a.status === 'accepted' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-3 py-1.5 text-xs font-semibold text-clay-700">
                    <Check size={14} /> Accepted
                  </span>
                ) : a.revoked ? (
                  <span className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1.5 text-xs text-stone-400">
                    Revoked
                  </span>
                ) : (
                  <button
                    onClick={() => accept(a)}
                    disabled={busyId === a.id}
                    className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
                  >
                    {busyId === a.id ? 'Accepting…' : 'Accept — no re-screen'}
                  </button>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function EmployerTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reqs, setReqs] = useState([])
  const [openReq, setOpenReq] = useState(null) // req id whose inbox is expanded
  const [copiedId, setCopiedId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getMyReqs()
      .then((res) => setReqs(Array.isArray(res?.reqs) ? res.reqs : []))
      .catch((e) => setError(e?.message || 'Could not load your reqs.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(), [load])

  // create form
  const [title, setTitle] = useState('')
  const [roleFamily, setRoleFamily] = useState('')
  const [companyLabel, setCompanyLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState(null)

  async function create(e) {
    e?.preventDefault?.()
    if (!title.trim()) return
    setCreating(true)
    setCreateErr(null)
    try {
      await api.createReq({ title, role_family: roleFamily || null, company_label: companyLabel || null })
      setTitle('')
      setRoleFamily('')
      setCompanyLabel('')
      load()
    } catch (err) {
      setCreateErr(err?.message || 'Could not create that req.')
    } finally {
      setCreating(false)
    }
  }

  async function copyLink(req) {
    try {
      await navigator.clipboard?.writeText(req.apply_url)
      setCopiedId(req.id)
      setTimeout(() => setCopiedId(null), 1800)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function toggleOpen(req) {
    const next = !req.is_open
    setReqs((xs) => xs.map((x) => (x.id === req.id ? { ...x, is_open: next } : x)))
    try {
      await api.updateReq(req.id, { is_open: next })
    } catch {
      setReqs((xs) => xs.map((x) => (x.id === req.id ? { ...x, is_open: !next } : x)))
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }
  if (error) return <ErrorState title="Couldn’t load your reqs" message={error} onRetry={load} />

  return (
    <div className="max-w-2xl space-y-6">
      {/* Create a req */}
      <div className="card p-6">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <Plus size={16} className="text-clay-500" /> Open a req
        </span>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">
          Get a shareable apply link. Candidates apply with an existing verified result — accept it without
          re-screening.
        </p>
        <form onSubmit={create} className="mt-3 space-y-2.5">
          <input
            className={inputCls}
            placeholder="Role title — e.g. Senior Backend Engineer"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2.5">
            <input
              className={`${inputCls} flex-1`}
              placeholder="Role family (optional)"
              value={roleFamily}
              maxLength={80}
              onChange={(e) => setRoleFamily(e.target.value)}
            />
            <input
              className={`${inputCls} flex-1`}
              placeholder="Team / company label (optional)"
              value={companyLabel}
              maxLength={80}
              onChange={(e) => setCompanyLabel(e.target.value)}
            />
          </div>
          <button type="submit" disabled={creating || !title.trim()} className="btn-primary disabled:opacity-60">
            {creating ? 'Creating…' : 'Create req'} <ArrowRight size={16} />
          </button>
          {createErr && <p className="text-sm text-flag-700">{createErr}</p>}
        </form>
      </div>

      {/* My reqs */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Your reqs ({reqs.length})</h3>
        {reqs.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No reqs yet. Open one above to start receiving verified applications.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reqs.map((r) => (
              <li key={r.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-serif text-lg font-semibold text-ink">{r.title}</p>
                    <p className="text-xs text-stone-500">
                      {[r.role_family, r.company_label].filter(Boolean).join(' · ') || 'Open req'}
                    </p>
                    <p className="mt-1 text-xs text-stone-400">
                      {r.application_count} application{r.application_count === 1 ? '' : 's'}
                      {r.accepted_count > 0 && ` · ${r.accepted_count} accepted`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleOpen(r)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                      r.is_open
                        ? 'border-clay-200 bg-clay-50 text-clay-700'
                        : 'border-stone-200 bg-stone-100 text-stone-400'
                    }`}
                  >
                    {r.is_open ? 'Open' : 'Closed'}
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input readOnly value={r.apply_url} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-xs`} />
                  <button onClick={() => copyLink(r)} className="btn-ghost shrink-0 px-3 py-2 text-xs">
                    {copiedId === r.id ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenReq(openReq === r.id ? null : r.id)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-clay-700 hover:text-clay-800"
                >
                  {openReq === r.id ? 'Hide applications' : 'View applications'}
                  <ArrowRight size={13} className={openReq === r.id ? 'rotate-90 transition-transform' : 'transition-transform'} />
                </button>
                {openReq === r.id && <ReqInbox reqId={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Page shell ─────────────────────────
export default function Apply() {
  const [tab, setTab] = useState('apply')
  const tabs = [
    { key: 'apply', label: 'Apply with Touchstones', icon: LinkIcon },
    { key: 'reqs', label: 'My reqs', icon: ShieldCheck },
  ]
  return (
    <Container className="py-8 lg:py-10">
      <div>
        <h1 className="inline-flex items-center gap-2 text-3xl font-semibold leading-tight">
          <LinkIcon size={24} className="text-clay-500" /> Network
        </h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          The candidate side of the accept-prior network. Reuse a verified result across employers — or open a
          req and accept a candidate’s existing credential without re-screening.
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

      <div className="mt-8">{tab === 'apply' ? <CandidateTab /> : <EmployerTab />}</div>
    </Container>
  )
}
