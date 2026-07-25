import { useEffect, useState } from 'react'
import { Check, Link as LinkIcon, Mail, Plus, X } from './icons.jsx'
import { api } from '../services/api.js'
import { track } from '../services/analytics.js'

function statusTone(status) {
  if (status === 'decided') return 'bg-clay-50 text-clay-700 ring-clay-200'
  if (status === 'viewed') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (status === 'expired' || status === 'revoked') return 'bg-flag-50 text-flag-700 ring-flag-100'
  return 'bg-stone-100 text-stone-600 ring-stone-200'
}

function decisionLabel(decision) {
  if (decision === 'advance') return 'Advance'
  if (decision === 'reject') return 'Reject'
  if (decision === 'needs_more_signal') return 'Needs more signal'
  return null
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ClientReviewCard({ submissionId, candidateName }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [createdLinks, setCreatedLinks] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [actionId, setActionId] = useState(null)
  const [draft, setDraft] = useState({ email: '', name: '', message: '' })
  const [commentDrafts, setCommentDrafts] = useState({})

  useEffect(() => {
    if (!submissionId) return
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await api.getClientReviews(submissionId)
        if (active) setReviews(data?.reviews || [])
      } catch (e) {
        if (active) setError(e.message || 'Could not load client reviews.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [submissionId])

  async function createInvite(event) {
    event.preventDefault()
    if (!draft.email.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.createClientReviewInvite(submissionId, {
        email: draft.email.trim(),
        name: draft.name.trim() || undefined,
        message: draft.message.trim() || undefined,
      })
      if (res?.invite) {
        setReviews((items) => [res.invite, ...items])
        if (res.review_url) setCreatedLinks((links) => ({ ...links, [res.invite.id]: res.review_url }))
      }
      setDraft({ email: '', name: '', message: '' })
      track('client_invited', { submissionId, email_sent: !!res?.email_sent })
      track('review_requested', { submissionId })
    } catch (e) {
      setError(e.message || 'Could not create the client review.')
    } finally {
      setSaving(false)
    }
  }

  async function copyLink(inviteId) {
    const link = createdLinks[inviteId]
    if (!link) return
    try {
      await navigator.clipboard?.writeText(link)
      setCopiedId(inviteId)
      setTimeout(() => setCopiedId(null), 1600)
    } catch {
      setError('Could not copy the review link.')
    }
  }

  function setCommentDraft(inviteId, patch) {
    setCommentDrafts((drafts) => ({
      ...drafts,
      [inviteId]: { body: '', internal: false, ...(drafts[inviteId] || {}), ...patch },
    }))
  }

  async function addComment(inviteId) {
    const commentDraft = commentDrafts[inviteId] || {}
    const body = String(commentDraft.body || '').trim()
    if (!body) return
    setError(null)
    try {
      const res = await api.createClientReviewComment(inviteId, {
        body,
        visibility: commentDraft.internal ? 'internal' : 'shared',
      })
      if (res?.comment) {
        setReviews((items) =>
          items.map((review) =>
            review.id === inviteId
              ? { ...review, comments: [...(review.comments || []), res.comment] }
              : review,
          ),
        )
      }
      setCommentDraft(inviteId, { body: '', internal: false })
      track('client_comment_created', {
        submissionId,
        source: 'recruiter',
        visibility: commentDraft.internal ? 'internal' : 'shared',
      })
    } catch (e) {
      setError(e.message || 'Could not add comment.')
    }
  }

  async function resendInvite(inviteId) {
    setActionId(`resend:${inviteId}`)
    setError(null)
    try {
      const res = await api.resendClientReview(inviteId)
      if (res?.invite) {
        setReviews((items) => items.map((review) => (review.id === inviteId ? { ...review, ...res.invite } : review)))
        if (res.review_url) setCreatedLinks((links) => ({ ...links, [inviteId]: res.review_url }))
      }
      track('client_review_resent', { submissionId, email_sent: !!res?.email_sent })
    } catch (e) {
      setError(e.message || 'Could not resend the review link.')
    } finally {
      setActionId(null)
    }
  }

  async function revokeInvite(inviteId) {
    setActionId(`revoke:${inviteId}`)
    setError(null)
    try {
      const res = await api.revokeClientReview(inviteId)
      if (res?.invite) {
        setReviews((items) => items.map((review) => (review.id === inviteId ? { ...review, ...res.invite } : review)))
      }
      setCreatedLinks((links) => {
        const next = { ...links }
        delete next[inviteId]
        return next
      })
      track('client_review_revoked', { submissionId })
    } catch (e) {
      setError(e.message || 'Could not revoke the review link.')
    } finally {
      setActionId(null)
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-base font-semibold text-ink">Client review</h3>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            Invite a client to review {candidateName || 'this candidate'} and leave a structured recommendation.
          </p>
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
          <Mail size={15} />
        </span>
      </div>

      <form onSubmit={createInvite} className="mt-4 space-y-2.5">
        <input
          type="email"
          value={draft.email}
          onChange={(event) => setDraft((d) => ({ ...d, email: event.target.value }))}
          placeholder="client@company.com"
          className="w-full rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
        />
        <input
          type="text"
          value={draft.name}
          onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
          placeholder="Client name"
          className="w-full rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
        />
        <textarea
          value={draft.message}
          onChange={(event) => setDraft((d) => ({ ...d, message: event.target.value }))}
          placeholder="Optional context"
          rows={3}
          className="w-full resize-none rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
        />
        <button type="submit" disabled={saving || !draft.email.trim()} className="btn-primary w-full px-3 py-2 text-xs disabled:opacity-50">
          <Plus size={14} /> {saving ? 'Sending...' : 'Invite client'}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-flag-50 px-3 py-2 text-xs leading-relaxed text-flag-700 ring-1 ring-flag-100">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {loading && <p className="text-xs text-stone-400">Loading client reviews...</p>}
        {!loading && reviews.length === 0 && (
          <p className="rounded-lg border border-dashed border-stone-200 px-3 py-3 text-xs leading-relaxed text-stone-500">
            No client reviews yet. Send the first invite when you want a hiring manager decision in the same place as the score.
          </p>
        )}
        {reviews.map((review) => {
          const commentDraft = commentDrafts[review.id] || {}
          const link = createdLinks[review.id]
          const decision = decisionLabel(review.decision?.decision)
          return (
            <div key={review.id} className="rounded-lg border border-stone-200 bg-canvas/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{review.client_name || review.client_email}</p>
                  <p className="mt-0.5 truncate text-xs text-stone-500">{review.client_email}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusTone(review.status)}`}>
                  {review.status}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                {formatDate(review.created_at) && <span>Sent {formatDate(review.created_at)}</span>}
                {decision && <span className="font-medium text-clay-700">{decision}</span>}
                {(review.comments || []).length > 0 && <span>{review.comments.length} comment{review.comments.length === 1 ? '' : 's'}</span>}
              </div>

              {link && (
                <button type="button" onClick={() => copyLink(review.id)} className="btn-ghost mt-2 w-full justify-start px-2 py-1.5 text-xs">
                  {copiedId === review.id ? <Check size={14} /> : <LinkIcon size={14} />}
                  {copiedId === review.id ? 'Copied review link' : 'Copy review link'}
                </button>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => resendInvite(review.id)}
                  disabled={actionId === `resend:${review.id}` || review.status === 'decided'}
                  className="btn-ghost justify-center px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  <Mail size={14} /> {actionId === `resend:${review.id}` ? 'Sending' : 'Resend'}
                </button>
                <button
                  type="button"
                  onClick={() => revokeInvite(review.id)}
                  disabled={actionId === `revoke:${review.id}` || review.status === 'revoked' || review.status === 'decided'}
                  className="btn-ghost justify-center px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  <X size={14} /> {actionId === `revoke:${review.id}` ? 'Revoking' : 'Revoke'}
                </button>
              </div>

              {(review.comments || []).slice(-2).map((comment) => (
                <div key={comment.id} className="mt-2 rounded-md bg-paper px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-stone-600">{comment.author_name || comment.author_type}</span>
                    <span className="text-[10px] uppercase text-stone-400">{comment.visibility}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">{comment.body}</p>
                </div>
              ))}

              <div className="mt-2 space-y-2">
                <textarea
                  value={commentDraft.body || ''}
                  onChange={(event) => setCommentDraft(review.id, { body: event.target.value })}
                  placeholder="Add a note"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-stone-200 bg-canvas px-2.5 py-2 text-xs text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
                    <input
                      type="checkbox"
                      checked={!!commentDraft.internal}
                      onChange={(event) => setCommentDraft(review.id, { internal: event.target.checked })}
                      className="h-3.5 w-3.5 rounded border-stone-300 text-clay-600 focus:ring-clay-200"
                    />
                    Internal
                  </label>
                  <button type="button" onClick={() => addComment(review.id)} className="btn-ghost px-2.5 py-1.5 text-xs">
                    Add note
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
