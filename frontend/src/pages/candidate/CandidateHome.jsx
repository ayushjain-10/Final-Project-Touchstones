import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import { Pill } from '../../components/primitives.jsx'
import { Sparkle, ShieldCheck, FileText, Clock, ArrowRight, Camera } from '../../components/icons.jsx'
import { PortalSkeleton, PortalEmpty, PortalError } from '../../components/portal/PortalStates.jsx'
import { WakingNote } from '../../components/states.jsx'
import { useSlowLoading } from '../../hooks/useSlowLoading.js'
import { deadlineLabel } from '../../lib/portalFormat.js'
import CandidatePortalPage from '../../components/candidate/CandidatePortalPage.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Candidate portal home + dashboard. The post-login landing for non-recruiter accounts
// (the security boundary routes candidates here, never to /app). Fetches the candidate's
// assigned screens and groups them Pending / In-progress / Completed (+ Expired if any),
// each with a primary CTA. Keeps the recruiter-access pending banner + "Here to hire?" link.

// One assignment card. CTA reads the submission state: never started (status assigned, no
// deadline stamped) gets "Start assessment", which opens the start gate; a running timer
// (deadline_at set, including legacy rows stamped at assign time) gets "Continue";
// completed keeps View result.
function AssignmentCard({ item, editorial = false, index = 0 }) {
  const s = item.screen || {}
  const status = item.status
  const completed = status === 'completed' || status === 'submitted' || status === 'scored'
  const expired = status === 'expired'
  const inProgress =
    status === 'in_progress' || status === 'started' || Boolean(item.deadline_at)

  const dl = deadlineLabel(item.deadline_at)
  const meta = [s.role_family, s.duration_minutes ? `${s.duration_minutes} min` : null].filter(
    Boolean,
  )

  if (editorial) {
    const statusLabel = expired
      ? 'Expired'
      : completed
        ? 'Submitted'
        : inProgress
          ? 'In progress'
          : 'Ready to start'
    const statusTone = expired ? 'neutral' : completed ? 'success' : inProgress ? 'warning' : 'brand'

    return (
      <article className="group overflow-hidden border border-stone-200 bg-white/90 shadow-card transition duration-200 hover:border-brand-300 hover:shadow-lift">
        <div className="grid sm:grid-cols-[4.6rem_1fr]">
          <div className="border-b border-stone-200 bg-stone-50 px-4 py-4 sm:border-b-0 sm:border-r">
            <p className="font-mono text-lg font-semibold tabular-nums text-brand-700">
              {String(index + 1).padStart(2, '0')}
            </p>
            <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.15em] text-stone-400">
              Record
            </p>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone={statusTone}>{statusLabel}</Pill>
                  <Pill tone={typeof s.ai_allowed === 'boolean' && s.ai_allowed ? 'brand' : 'neutral'}>
                    <Sparkle size={12} />{' '}
                    {typeof s.ai_allowed === 'boolean'
                      ? s.ai_allowed
                        ? 'AI allowed'
                        : 'AI not allowed'
                      : 'AI policy in instructions'}
                  </Pill>
                </div>
                <h3 className="mt-3 font-sans text-lg font-semibold text-ink">
                  {s.title || 'Assessment'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  {s.company ? <span className="font-medium text-stone-700">{s.company}</span> : 'A hiring team'}
                  {meta.length > 0 && <span className="text-stone-400"> · {meta.join(' · ')}</span>}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {s.av_required && !completed && !expired && (
                  <span title="This screen asks for camera and microphone access at start. Nothing is recorded.">
                    <Pill tone="neutral">
                      <Camera size={12} /> Camera + mic request
                    </Pill>
                  </span>
                )}
                {!completed && !expired && dl.text && (
                  <Pill tone={dl.urgent ? 'warning' : 'neutral'}>
                    <Clock size={12} /> {dl.text}
                  </Pill>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
              <p className="text-xs leading-relaxed text-stone-500">
                The task policy and any permission request appear before work starts.
              </p>
              {expired ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-stone-400">
                  <Clock size={14} /> Invitation expired
                </span>
              ) : completed ? (
                <Link
                  to="/candidate/results"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-100"
                >
                  View record <ArrowRight size={15} />
                </Link>
              ) : (
                <Link
                  to={`/candidate?submission=${encodeURIComponent(item.id)}`}
                  className="btn-primary inline-flex px-4 py-2 text-sm"
                >
                  {inProgress ? 'Continue' : 'Review and start'} <ArrowRight size={15} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-canvas/60 p-5 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#0D1426] dark:hover:border-clay-500/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink dark:text-[#F4F6FF]">{s.title || 'Assessment'}</p>
          <p className="mt-0.5 text-sm text-stone-600 dark:text-[#AEB7D0]">
            {s.company ? <span className="font-medium">{s.company}</span> : 'A hiring team'}
            {meta.length > 0 && <span className="text-stone-400 dark:text-[#8490AE]"> · {meta.join(' · ')}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {/* Camera + mic requirement (TOU-147): flagged before opening, so the consent gate is
              never a surprise. Presence signal only; nothing is recorded. */}
          {s.av_required && !completed && !expired && (
            <span title="This screen asks for camera and microphone access at start. Nothing is recorded.">
              <Pill tone="neutral">
                <Camera size={12} /> Camera + mic
              </Pill>
            </span>
          )}
          {!completed && !expired && dl.text && (
            <Pill tone={dl.urgent ? 'amber' : 'neutral'}>
              <Clock size={12} /> {dl.text}
            </Pill>
          )}
        </div>
      </div>

      <div className="mt-4">
        {expired ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-stone-400 dark:text-[#8490AE]">
            <Clock size={14} /> This invitation has expired.
          </span>
        ) : completed ? (
          <Link
            to="/candidate/results"
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-clay-300 hover:text-clay-700 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
          >
            View result <ArrowRight size={15} />
          </Link>
        ) : (
          <Link
            to={`/candidate?submission=${encodeURIComponent(item.id)}`}
            className="btn-primary inline-flex px-4 py-2 text-sm"
          >
            {inProgress ? 'Continue' : 'Start assessment'} <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </div>
  )
}

// A titled group of assignment cards (rendered only when non-empty).
function Group({ title, tone, items, editorial = false, number = '01' }) {
  if (!items || items.length === 0) return null
  if (editorial) {
    return (
      <section className="mt-10 border-t border-stone-300 pt-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[0.66rem] tabular-nums text-brand-600">{number}</span>
            <h2 className="font-sans text-xl font-semibold text-ink">{title}</h2>
          </div>
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-stone-400">
            {items.length} {items.length === 1 ? 'record' : 'records'}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {items.map((it, index) => (
            <AssignmentCard key={it.id} item={it} editorial index={index} />
          ))}
        </div>
      </section>
    )
  }
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-lg font-semibold text-ink dark:text-[#F4F6FF]">{title}</h2>
        <Pill tone={tone}>{items.length}</Pill>
      </div>
      <div className="mt-3 space-y-3">
        {items.map((it) => (
          <AssignmentCard key={it.id} item={it} />
        ))}
      </div>
    </section>
  )
}

export default function CandidateHome() {
  const { user, profile, configured } = useAuth()
  const [params] = useSearchParams()
  const firstName = user?.user_metadata?.first_name || ''
  // Recruiter access awaiting review. RequireRecruiter bounces pending users here with ?pending=1;
  // we also read the profile so a calm reload (no query string) still shows the status.
  const recruiterPending =
    params.get('pending') === '1' || profile?.recruiter_status === 'pending'

  const [groups, setGroups] = useState(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // The dev backend cold-starts (~30–50s) and can 502 / time out on the first hit.
  // We keep loading (so the "waking…" hint stays up) and auto-retry transient
  // failures a few times before surfacing a real error.
  const attemptRef = useRef(0)
  const retryTimer = useRef(null)
  const load = useCallback(() => {
    if (!configured || !user) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    api
      .getMyAssignments()
      .then((res) => {
        attemptRef.current = 0
        setGroups(res?.groups || {})
        setTotal(res?.total ?? 0)
        setLoading(false)
      })
      .catch((err) => {
        const transient = !err?.status || err.status >= 500 || err.status === 429
        if (transient && attemptRef.current < 3) {
          attemptRef.current += 1
          retryTimer.current = setTimeout(load, 3000)
        } else {
          attemptRef.current = 0
          setError(err)
          setLoading(false)
        }
      })
  }, [configured, user])

  useEffect(() => {
    load()
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [load])

  const slow = useSlowLoading(loading)

  // Declined rows may arrive as a dedicated groups.declined bucket or (defensively) as
  // declined-status rows inside another group. Collect them into one list and keep them
  // out of the active buckets so Pending never shows a declined screen.
  const notDeclined = (list) => (list || []).filter((it) => it.status !== 'declined')
  const pending = notDeclined(groups?.pending)
  const inProgress = notDeclined(groups?.in_progress)
  const completed = notDeclined(groups?.completed)
  const expired = notDeclined(groups?.expired)
  const declined = [
    ...(groups?.declined || []),
    ...['pending', 'in_progress', 'completed', 'expired'].flatMap((k) =>
      (groups?.[k] || []).filter((it) => it.status === 'declined'),
    ),
  ]
  const isEmpty = !loading && !error && total === 0

  if (EDITORIAL_UI_ENABLED) {
    const statusCounts = [
      ['Ready', pending.length],
      ['In progress', inProgress.length],
      ['Submitted', completed.length],
      ['Expired', expired.length],
    ]

    return (
      <CandidatePortalPage
        label="Candidate record / private workspace"
        title={`A clear record of every assignment${firstName ? `, ${firstName}` : ''}.`}
        description="See new invitations, return to active sessions, and find completed work. Each task states its own tool policy and session requirements before you begin."
        asideTitle="What stays clear"
        asideItems={[
          {
            title: 'Policy before work',
            body: 'Every assignment states the allowed tools and review criteria in its instructions.',
          },
          {
            title: 'Permission before access',
            body: 'Any camera or microphone request is shown before the task starts.',
          },
          {
            title: 'Human follow-up',
            body: 'The inviting team reviews the submitted work and communicates next steps.',
          },
        ]}
      >
        {recruiterPending && (
          <div className="mt-8 grid gap-3 border border-warning-200 bg-warning-50 px-5 py-4 text-sm text-warning-700 sm:grid-cols-[auto_1fr]">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-warning-200 bg-white text-warning-600">
              <Clock size={15} />
            </span>
            <p className="leading-relaxed">
              <span className="font-semibold">Your recruiter access is pending review.</span> We will
              email you when it is approved. Your candidate assignments remain available here.
            </p>
          </div>
        )}

        <section className="mt-8 border-y border-stone-300 bg-white/65 backdrop-blur-sm" aria-label="Assignment status index">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-5">
            <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Assignment index
            </p>
            <p className="font-mono text-[0.66rem] tabular-nums text-stone-400">
              {total} {total === 1 ? 'assignment' : 'assignments'} on record
            </p>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-y divide-stone-200 sm:grid-cols-4 sm:divide-y-0">
            {statusCounts.map(([label, value]) => (
              <div key={label} className="px-4 py-4 sm:px-5">
                <dt className="text-xs text-stone-500">{label}</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {slow && loading && <WakingNote className="mt-6" />}
        {loading && <PortalSkeleton count={3} />}
        {error && <PortalError error={error} onRetry={load} />}

        {isEmpty && (
          <section className="mt-8 grid gap-6 border border-dashed border-brand-300 bg-white/70 px-6 py-8 sm:grid-cols-[1fr_15rem] sm:items-center">
            <div>
              <span className="grid h-11 w-11 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
                <FileText size={20} />
              </span>
              <h2 className="mt-4 font-sans text-xl font-semibold text-ink">No assignments yet</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
                When a company invites you, the assignment will appear here with its timing, policy,
                and start action. Invitation links also open the correct record directly.
              </p>
            </div>
            <div className="border-l border-stone-200 pl-5">
              <p className="font-mono text-[0.64rem] uppercase tracking-[0.15em] text-brand-600">
                Until then
              </p>
              <p className="mt-2 text-xs leading-relaxed text-stone-500">
                Keep this page bookmarked. New invitations are tied to the account that received them.
              </p>
            </div>
          </section>
        )}

        {!loading && !error && !isEmpty && (
          <>
            <Group title="Ready to start" tone="brand" items={pending} editorial number="01" />
            <Group title="In progress" tone="warning" items={inProgress} editorial number="02" />
            <Group title="Submitted" tone="success" items={completed} editorial number="03" />
            <Group title="Expired" tone="neutral" items={expired} editorial number="04" />
            {declined.length > 0 && (
              <section className="mt-10 border-t border-stone-300 pt-5">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[0.66rem] text-brand-600">05</span>
                  <h2 className="font-sans text-xl font-semibold text-ink">Declined</h2>
                </div>
                <ul className="mt-4 divide-y divide-stone-200 border border-stone-200 bg-white/80">
                  {declined.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-3 px-5 py-4">
                      <span className="min-w-0 truncate text-sm text-stone-600">
                        {it.screen?.title || 'Assessment'}
                      </span>
                      <Pill tone="danger" className="shrink-0">
                        Declined
                      </Pill>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <section className="mt-12 grid border border-stone-200 bg-white/80 md:grid-cols-2">
          <div className="border-b border-stone-200 p-5 md:border-b-0 md:border-r">
            <ShieldCheck size={18} className="text-brand-600" />
            <h2 className="mt-3 font-sans text-base font-semibold text-ink">Your workspace stays private</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Assignment records are available to you and the company that invited you, not to other
              candidates.
            </p>
          </div>
          <div className="p-5">
            <p className="font-mono text-[0.64rem] uppercase tracking-[0.15em] text-brand-600">
              Need a different workspace?
            </p>
            {!recruiterPending && (
              <Link
                to="/recruiter-access"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-brand-300 underline-offset-4 hover:text-brand-700"
              >
                Request recruiter access <ArrowRight size={14} />
              </Link>
            )}
            <p className="mt-3 text-sm text-stone-500">
              Have a question?{' '}
              <Link to="/contact" className="font-semibold text-brand-700 hover:underline">
                Contact us
              </Link>
              .
            </p>
          </div>
        </section>
      </CandidatePortalPage>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      {recruiterPending && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-clay-200 bg-clay-50 px-4 py-3.5 text-sm text-clay-800 dark:border-clay-500/30 dark:bg-clay-500/10 dark:text-[#C8CEFA]">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-clay-600 ring-1 ring-clay-200 dark:bg-[#0D1426] dark:ring-clay-500/30">
            <Clock size={15} />
          </span>
          <p className="leading-relaxed">
            <span className="font-semibold">Your recruiter access is pending review.</span> We’ll
            email you as soon as you’re approved. Meanwhile, you can use your candidate dashboard
            below.
          </p>
        </div>
      )}

      <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-3 py-1 text-xs font-medium text-clay-700 dark:border-clay-500/30 dark:bg-clay-500/10 dark:text-[#9DA9EF]">
        <Sparkle size={13} /> Candidate portal
      </span>
      <h1 className="mt-4 font-serif text-3xl font-semibold text-ink dark:text-[#F4F6FF]">
        Welcome{firstName ? `, ${firstName}` : ''}.
      </h1>
      <p className="mt-3 text-stone-600 dark:text-[#AEB7D0]">
        Your assessments live here. Each task explains the allowed tools, review criteria, and any
        session requirements before you begin.
      </p>

      {slow && loading && <WakingNote className="mt-6" />}
      {loading && <PortalSkeleton count={3} />}

      {error && <PortalError error={error} onRetry={load} />}

      {isEmpty && (
        <PortalEmpty icon={FileText} title="No assessments yet">
          When a company invites you, it’ll show up here with its deadline and a Start button. You
          can also open the link directly from your invitation email.
        </PortalEmpty>
      )}

      {!loading && !error && !isEmpty && (
        <>
          <Group title="Pending" tone="clay" items={pending} />
          <Group title="In progress" tone="amber" items={inProgress} />
          <Group title="Completed" tone="neutral" items={completed} />
          <Group title="Expired" tone="neutral" items={expired} />
          {/* Declined screens keep a minor, CTA-less record below everything: the candidate
              opted out, so there is nothing to do here unless the team re-invites them. */}
          {declined.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-[#8490AE]">
                Declined
              </h2>
              <ul className="mt-3 space-y-2">
                {declined.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-canvas/40 px-4 py-2.5 dark:border-[#25304D] dark:bg-[#0D1426]"
                  >
                    <span className="min-w-0 truncate text-sm text-stone-500 dark:text-[#AEB7D0]">
                      {it.screen?.title || 'Assessment'}
                    </span>
                    <Pill tone="flag" className="shrink-0">
                      Declined
                    </Pill>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="mt-10 flex flex-col gap-2 rounded-2xl border border-stone-200 bg-canvas/60 p-5 text-sm text-stone-600 dark:border-[#25304D] dark:bg-[#0D1426] dark:text-[#AEB7D0]">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck size={16} className="text-clay-500" /> Your work is private to you and the
          company that invited you. It is never visible to other candidates.
        </span>
      </div>

      {!recruiterPending && (
        <Link
          to="/recruiter-access"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-5 py-4 text-left transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:hover:border-clay-500/50"
        >
          <span className="text-sm text-stone-600 dark:text-[#AEB7D0]">
            <span className="font-medium text-ink dark:text-[#F4F6FF]">
              Here to hire, not to be screened?
            </span>{' '}
            Request recruiter access for your team.
          </span>
          <ShieldCheck size={16} className="shrink-0 text-clay-500" />
        </Link>
      )}

      <p className="mt-6 text-sm text-stone-500 dark:text-[#8490AE]">
        Have a question?{' '}
        <Link
          to="/contact"
          className="font-medium text-clay-700 underline-offset-2 hover:underline dark:text-[#9DA9EF]"
        >
          Contact us
        </Link>
        .
      </p>
    </div>
  )
}
