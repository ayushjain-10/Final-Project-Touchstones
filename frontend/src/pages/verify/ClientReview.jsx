import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Container } from '../../components/primitives.jsx'
import { Skeleton } from '../../components/states.jsx'
import { Check, Clock, Mail, ShieldCheck } from '../../components/icons.jsx'
import { api } from '../../services/api.js'
import { track } from '../../services/analytics.js'

const DECISIONS = [
  { value: 'advance', label: 'Advance' },
  { value: 'needs_more_signal', label: 'Needs more signal' },
  { value: 'reject', label: 'Reject' },
]

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function scoreTone(score) {
  if (typeof score !== 'number') return 'text-stone-500'
  if (score >= 85) return 'text-clay-700'
  if (score >= 70) return 'text-amber-700'
  return 'text-flag-700'
}

export default function ClientReview() {
  const { token } = useParams()
  const [review, setReview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [comment, setComment] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [decision, setDecision] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [savingComment, setSavingComment] = useState(false)
  const [savingDecision, setSavingDecision] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await api.getPublicClientReview(token)
        if (!active) return
        setReview(data)
        setAuthorName(data?.review?.client_name || '')
        setDecision(data?.decision?.decision || '')
        setReasoning(data?.decision?.reasoning || '')
        track('client_review_opened', { status: data?.review?.status || null })
      } catch (e) {
        if (active) setError(e.message || 'Could not load this review.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [token])

  async function addComment(event) {
    event.preventDefault()
    if (!comment.trim() || savingComment) return
    setSavingComment(true)
    setNotice(null)
    try {
      const res = await api.createPublicClientReviewComment(token, {
        body: comment.trim(),
        author_name: authorName.trim() || undefined,
      })
      if (res?.comment) {
        setReview((data) => ({ ...data, comments: [...(data.comments || []), res.comment] }))
      }
      setComment('')
      setNotice('Comment added.')
      track('client_comment_created', { source: 'client' })
    } catch (e) {
      setNotice(e.message || 'Could not add comment.')
    } finally {
      setSavingComment(false)
    }
  }

  async function saveDecision(event) {
    event.preventDefault()
    if (!decision || savingDecision) return
    setSavingDecision(true)
    setNotice(null)
    try {
      const res = await api.submitPublicClientReviewDecision(token, {
        decision,
        reasoning: reasoning.trim() || undefined,
      })
      if (res?.decision) setReview((data) => ({ ...data, decision: res.decision, review: { ...data.review, status: 'decided' } }))
      setNotice('Decision saved.')
      track('client_decision_submitted', { decision })
    } catch (e) {
      setNotice(e.message || 'Could not save decision.')
    } finally {
      setSavingDecision(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-paper">
        <Container className="py-10">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-6 h-48 rounded-2xl" />
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Skeleton className="h-80 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        </Container>
      </main>
    )
  }

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper px-6">
        <section className="max-w-md text-center">
          <p className="font-serif text-2xl font-semibold text-ink">Review unavailable</p>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">{error}</p>
        </section>
      </main>
    )
  }

  const score = review?.score?.normalized_score
  const scoreCreated = formatDate(review?.score?.created_at)
  const submittedAt = formatDate(review?.submission?.submitted_at)
  const comments = review?.comments || []
  const criteria = review?.score?.criteria || []

  return (
    <main className="min-h-screen bg-paper">
      <Container className="py-8 lg:py-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-clay-700">Touchstones client review</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold text-ink">
              {review?.candidate?.label || 'Candidate'}
            </h1>
            <p className="mt-1 text-sm text-stone-600">{review?.screen?.title || 'Untitled screen'}</p>
          </div>
          <div className="text-right">
            <p className={`font-serif text-5xl font-semibold ${scoreTone(score)}`}>{score ?? 'Pending'}</p>
            {typeof score === 'number' && <p className="mt-1 text-xs text-stone-500">Score out of 100</p>}
          </div>
        </header>

        {review?.review?.message && (
          <section className="mt-5 rounded-lg border border-clay-200 bg-clay-50 px-4 py-3 text-sm leading-relaxed text-clay-900">
            {review.review.message}
          </section>
        )}

        {notice && (
          <p className="mt-5 rounded-lg bg-canvas px-3 py-2 text-sm text-stone-600 ring-1 ring-stone-200">
            {notice}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <section className="rounded-lg border border-stone-200 bg-canvas p-5">
              <div className="flex flex-wrap gap-3 text-xs text-stone-500">
                {submittedAt && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={14} className="text-clay-500" /> Submitted {submittedAt}
                  </span>
                )}
                {scoreCreated && (
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-clay-500" /> Scored {scoreCreated}
                  </span>
                )}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-stone-400">Raw points</p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {review?.score?.raw_points_awarded ?? '-'} / {review?.score?.raw_points_possible ?? '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-400">Outcome hint</p>
                  <p className="mt-1 text-sm font-medium text-ink">{review?.score?.outcome || 'Review'}</p>
                </div>
                <div>
                  <p className="text-xs text-stone-400">Role family</p>
                  <p className="mt-1 text-sm font-medium text-ink">{review?.screen?.role_family || 'General'}</p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-canvas p-5">
              <h2 className="font-serif text-lg font-semibold text-ink">Rubric reasoning</h2>
              <div className="mt-4 divide-y divide-stone-200">
                {criteria.length === 0 && <p className="text-sm text-stone-500">No rubric details are available for this score.</p>}
                {criteria.map((criterion) => (
                  <article key={criterion.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-ink">{criterion.label}</h3>
                      <span className="text-xs font-medium text-stone-500">
                        {criterion.points_awarded ?? '-'} / {criterion.points_possible ?? '-'}
                      </span>
                    </div>
                    {criterion.reasoning && (
                      <p className="mt-2 text-sm leading-relaxed text-stone-600">{criterion.reasoning}</p>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-canvas p-5">
              <h2 className="font-serif text-lg font-semibold text-ink">Shared comments</h2>
              <div className="mt-4 space-y-3">
                {comments.length === 0 && <p className="text-sm text-stone-500">No comments yet.</p>}
                {comments.map((item) => (
                  <article key={item.id} className="rounded-lg bg-paper px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-stone-600">{item.author_name || item.author_type}</span>
                      <span className="text-[11px] text-stone-400">{formatDate(item.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-stone-600">{item.body}</p>
                  </article>
                ))}
              </div>
              <form onSubmit={addComment} className="mt-4 space-y-3">
                <input
                  value={authorName}
                  onChange={(event) => setAuthorName(event.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
                />
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  placeholder="Add a shared comment"
                  className="w-full resize-none rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
                />
                <button type="submit" disabled={savingComment || !comment.trim()} className="btn-ghost px-4 py-2 text-xs disabled:opacity-50">
                  <Mail size={14} /> {savingComment ? 'Adding...' : 'Add comment'}
                </button>
              </form>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-lg border border-stone-200 bg-canvas p-5">
              <h2 className="font-serif text-lg font-semibold text-ink">Client decision</h2>
              <form onSubmit={saveDecision} className="mt-4 space-y-4">
                <div className="grid gap-2">
                  {DECISIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setDecision(item.value)}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                        decision === item.value
                          ? 'border-clay-300 bg-clay-50 text-clay-800'
                          : 'border-stone-200 bg-paper text-stone-600 hover:border-clay-200 hover:text-ink'
                      }`}
                    >
                      {item.label}
                      {decision === item.value && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <textarea
                  value={reasoning}
                  onChange={(event) => setReasoning(event.target.value)}
                  rows={5}
                  placeholder="Decision notes"
                  className="w-full resize-none rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-100"
                />
                <button type="submit" disabled={savingDecision || !decision} className="btn-primary w-full px-4 py-2 text-sm disabled:opacity-50">
                  {savingDecision ? 'Saving...' : 'Save decision'}
                </button>
              </form>
            </section>

            <section className="rounded-lg border border-stone-200 bg-canvas p-5">
              <p className="text-xs font-semibold uppercase text-stone-500">Reviewer</p>
              <p className="mt-2 text-sm font-medium text-ink">{review?.review?.client_name || 'Client reviewer'}</p>
              <p className="mt-4 text-xs font-semibold uppercase text-stone-500">Shared by</p>
              <p className="mt-2 text-sm font-medium text-ink">{review?.recruiter?.name || 'Touchstones recruiter'}</p>
              {review?.recruiter?.company && <p className="text-sm text-stone-500">{review.recruiter.company}</p>}
            </section>
          </aside>
        </div>
      </Container>
    </main>
  )
}
