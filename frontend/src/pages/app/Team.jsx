import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pill } from '../../components/primitives.jsx'
import Reveal from '../../components/Reveal.jsx'
import { api } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { User, Mail, Plus, X, Check, Clock } from '../../components/icons.jsx'

const input =
  'w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100'

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())

function timeAgo(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

const STATUS = {
  active: { label: 'Active', tone: 'clay', Icon: Check },
  invited: { label: 'Invited', tone: 'neutral', Icon: Clock },
}

export default function Team() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')

  const [members, setMembers] = useState([])
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [notice, setNotice] = useState(null)

  const [removingId, setRemovingId] = useState(null)

  // Accept flow: when the page is opened from an invite email link.
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return api
      .getTeam()
      .then((res) => {
        setMembers(Array.isArray(res?.members) ? res.members : [])
        setIsOwner(!!res?.is_owner)
      })
      .catch((e) => setError(e.message || 'Could not load your team.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // If we landed here via an invite link, accept it once, then clear the param.
  useEffect(() => {
    if (!inviteToken) return
    let active = true
    setAccepting(true)
    setAcceptError(null)
    api
      .acceptTeamInvite(inviteToken)
      .then(() => {
        if (!active) return
        setNotice('You’ve joined the workspace.')
        load()
      })
      .catch((e) => active && setAcceptError(e.message || 'This invite could not be accepted.'))
      .finally(() => {
        if (!active) return
        setAccepting(false)
        // Strip the token from the URL so a refresh doesn't re-trigger it.
        const next = new URLSearchParams(searchParams)
        next.delete('invite')
        setSearchParams(next, { replace: true })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken])

  async function invite(e) {
    e?.preventDefault()
    setInviteError(null)
    setNotice(null)
    const value = email.trim().toLowerCase()
    if (!isEmail(value)) {
      setInviteError('Enter a valid email address.')
      return
    }
    if (user?.email && value === user.email.toLowerCase()) {
      setInviteError('You cannot invite yourself.')
      return
    }
    setInviting(true)
    try {
      const res = await api.inviteTeammate(value)
      setMembers((prev) => [res.member, ...prev.filter((m) => m.id !== res.member.id)])
      setEmail('')
      setNotice(
        res.emailed
          ? `Invite sent to ${value}.`
          : `Invited ${value}. (Email delivery isn’t configured, so share the link manually.)`,
      )
    } catch (err) {
      setInviteError(err.message || 'Could not send that invite.')
    } finally {
      setInviting(false)
    }
  }

  async function remove(member) {
    setNotice(null)
    setError(null)
    setRemovingId(member.id)
    try {
      await api.removeTeammate(member.id)
      setMembers((prev) => prev.filter((m) => m.id !== member.id))
    } catch (err) {
      setError(err.message || 'Could not remove that teammate.')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Reveal>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">Team</h1>
        <p className="mt-1 text-sm text-stone-600">
          {isOwner
            ? 'Invite teammates to share your workspace — screens, candidates, and activity.'
            : 'You’re part of this shared workspace — screens, candidates, and activity.'}
        </p>
      </Reveal>

      {/* Accept-invite banner (only when arriving from an invite link) */}
      {accepting && (
        <p className="mt-5 rounded-xl bg-stone-100 px-3.5 py-2.5 text-sm text-stone-600 ring-1 ring-stone-200">
          Accepting your invite…
        </p>
      )}
      {acceptError && (
        <p className="mt-5 rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">
          {acceptError}
        </p>
      )}

      {/* Invite form — only the workspace owner can invite. */}
      {isOwner && (
      <Reveal delay={60}>
        <form onSubmit={invite} className="card mt-6 p-5">
          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
            Invite by email
          </label>
          <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
                <Mail size={16} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className={`${input} pl-9`}
                disabled={inviting}
              />
            </div>
            <button
              type="submit"
              disabled={inviting || !email.trim()}
              className="btn-primary shrink-0 disabled:opacity-50"
            >
              <Plus size={16} /> {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          {inviteError && <p className="mt-2 text-sm text-flag-700">{inviteError}</p>}
          {notice && <p className="mt-2 text-sm text-clay-700">{notice}</p>}
        </form>
      </Reveal>
      )}

      {/* Members list */}
      {error && (
        <div className="mt-5 rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">
          {error}{' '}
          <button onClick={load} className="font-semibold underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-200/50" />
          ))}
        </div>
      ) : members.length === 0 && !error ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400">
            <User size={22} />
          </span>
          <p className="mt-4 font-medium text-ink">No teammates yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Invite a colleague by email above. They’ll get a link to join your workspace.
          </p>
        </div>
      ) : (
        members.length > 0 && (
          <ul className="mt-6 space-y-2.5">
            {members.map((m) => {
              const st = STATUS[m.status] || { label: m.status, tone: 'neutral', Icon: Clock }
              const StatusIcon = st.Icon
              return (
                <li key={m.id} className="card flex items-center gap-4 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                    <User size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {m.name || m.email || 'Teammate'}
                      {m.is_self && <span className="ml-1.5 text-xs font-normal text-stone-400">(you)</span>}
                    </p>
                    {m.name && m.email && <p className="truncate text-sm text-stone-500">{m.email}</p>}
                    <p className="mt-0.5 text-xs text-stone-400">
                      {m.is_owner
                        ? 'Workspace owner'
                        : m.status === 'active' && m.accepted_at
                          ? `Joined ${timeAgo(m.accepted_at)}`
                          : `Invited ${timeAgo(m.invited_at)}`}
                    </p>
                  </div>
                  <Pill tone={m.is_owner ? 'clay' : st.tone} className="shrink-0">
                    <StatusIcon size={12} /> {m.is_owner ? 'Owner' : st.label}
                  </Pill>
                  {/* Only the owner can remove teammates — never the owner row or yourself. */}
                  {isOwner && !m.is_owner && !m.is_self && (
                    <button
                      onClick={() => remove(m)}
                      disabled={removingId === m.id}
                      title={m.status === 'invited' ? 'Revoke invite' : 'Remove teammate'}
                      aria-label={m.status === 'invited' ? 'Revoke invite' : 'Remove teammate'}
                      className="btn-quiet shrink-0 px-2 text-stone-400 hover:text-flag-700 disabled:opacity-50"
                    >
                      <X size={16} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )
      )}
    </div>
  )
}
