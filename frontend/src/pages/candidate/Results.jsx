import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../services/api.js'
import { Pill } from '../../components/primitives.jsx'
import { FileText, Check, ShieldCheck, ArrowRight } from '../../components/icons.jsx'
import { PortalSkeleton, PortalEmpty, PortalError } from '../../components/portal/PortalStates.jsx'
import { WakingNote } from '../../components/states.jsx'
import { useSlowLoading } from '../../hooks/useSlowLoading.js'
import { formatDate } from '../../lib/portalFormat.js'
import CandidatePortalPage from '../../components/candidate/CandidatePortalPage.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Candidate portal for completed screens. Outcome visibility is employer-controlled, so by default
// this shows "submitted / under review" and, when the company has issued one, the shareable
// credential. A screen can opt in to candidate-visible results (results_visibility === 'full'):
// then the candidate sees their score, the overall explanation, and the per-criterion reasoning.
const VERDICT_TONE = { MET: 'success', PARTIAL: 'warning', UNMET: 'danger' }
const VERDICT_TONE_LEGACY = { MET: 'clay', PARTIAL: 'amber', UNMET: 'flag' }
const VERDICT_LABEL = { MET: 'Met', PARTIAL: 'Partial', UNMET: 'Not met' }

function criterionLabel(id) {
  return String(id || '').replace(/[_-]+/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase())
}

// The candidate-visible score block, shared by both skins. Score + reasoning only — no
// advance/reject wording: what happens next stays with the hiring team.
function ScoreDetail({ result, editorial = false }) {
  const tones = editorial ? VERDICT_TONE : VERDICT_TONE_LEGACY
  return (
    <div className={editorial ? 'mt-5 border-t border-stone-200 pt-4' : 'mt-4 border-t border-stone-200 pt-4 dark:border-[#25304D]'}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={editorial ? 'font-mono text-3xl font-semibold tabular-nums text-brand-700' : 'font-mono text-3xl font-semibold tabular-nums text-clay-600 dark:text-[#9DA9EF]'}>
          {result.score}
          <span className={editorial ? 'text-base font-normal text-stone-400' : 'text-base font-normal text-stone-400 dark:text-[#8490AE]'}> / 100</span>
        </p>
        {result.tests && (
          <p className={editorial ? 'text-sm text-stone-600' : 'text-sm text-stone-600 dark:text-[#AEB7D0]'}>
            Hidden tests: {result.tests.passed}/{result.tests.total} passed
          </p>
        )}
      </div>
      {result.explanation && (
        <p className={editorial ? 'mt-3 text-sm leading-relaxed text-stone-600' : 'mt-3 text-sm leading-relaxed text-stone-600 dark:text-[#AEB7D0]'}>
          {result.explanation}
        </p>
      )}
      {(result.per_criterion || []).length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {result.per_criterion.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={tones[c.verdict] || 'neutral'}>{VERDICT_LABEL[c.verdict] || c.verdict}</Pill>
                <span className={editorial ? 'font-medium text-ink' : 'font-medium text-ink dark:text-[#F4F6FF]'}>{criterionLabel(c.id)}</span>
                <span className={editorial ? 'font-mono text-xs tabular-nums text-stone-500' : 'font-mono text-xs tabular-nums text-stone-500 dark:text-[#8490AE]'}>
                  {c.points_awarded}/{c.points_possible}
                </span>
              </div>
              {c.explanation && (
                <p className={editorial ? 'mt-1 leading-relaxed text-stone-500' : 'mt-1 leading-relaxed text-stone-500 dark:text-[#8490AE]'}>{c.explanation}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Shown while the screen has opted into candidate-visible results but scoring hasn't landed yet.
function ScorePending({ status, editorial = false }) {
  const reviewing = status === 'needs_review'
  return (
    <div className={editorial ? 'mt-5 border-t border-stone-200 pt-4' : 'mt-4 border-t border-stone-200 pt-4 dark:border-[#25304D]'}>
      <p className={editorial ? 'text-sm text-stone-600' : 'text-sm text-stone-600 dark:text-[#AEB7D0]'}>
        {reviewing
          ? 'Your submission is with a human reviewer. Your score will appear here once the review completes.'
          : 'Scoring in progress. Your score and the reasoning behind it will appear here, usually within a minute.'}
      </p>
    </div>
  )
}

function ResultCard({ item, editorial = false, index = 0 }) {
  const s = item.screen || {}
  const cred = item.credential
  const showsScore = item.results_visibility === 'full'

  if (editorial) {
    return (
      <article className="grid border border-stone-200 bg-white/90 shadow-card transition duration-200 hover:border-brand-300 sm:grid-cols-[4.6rem_1fr]">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-4 sm:border-b-0 sm:border-r">
          <p className="font-mono text-lg font-semibold tabular-nums text-brand-700">
            {String(index + 1).padStart(2, '0')}
          </p>
          <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.15em] text-stone-400">
            Result
          </p>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Pill tone={showsScore && item.result ? 'success' : cred ? 'success' : 'warning'}>
                <Check size={12} />{' '}
                {showsScore && item.result ? 'Scored' : cred ? 'Credential issued' : 'Under review'}
              </Pill>
              <h2 className="mt-3 font-sans text-lg font-semibold text-ink">
                {s.title || 'Assessment'}
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                {s.company ? <span className="font-medium text-stone-700">{s.company}</span> : 'A hiring team'}
                {item.submitted_at && (
                  <span className="text-stone-400"> · Submitted {formatDate(item.submitted_at)}</span>
                )}
              </p>
            </div>
          </div>

          {showsScore &&
            (item.result ? (
              <ScoreDetail result={item.result} editorial />
            ) : (
              <ScorePending status={item.status} editorial />
            ))}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
            {cred ? (
              <p className="max-w-lg text-xs leading-relaxed text-stone-500">
                The issued record has its own public verification page.
              </p>
            ) : (
              <p className="max-w-lg text-sm leading-relaxed text-stone-500">
                {showsScore
                  ? 'The hiring team sees the same score and reasoning, and will follow up about next steps.'
                  : 'Your work is in. The hiring team reviews it and will communicate next steps.'}
              </p>
            )}
            {cred && (
              <a
                href={cred.verify_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-100"
              >
                <ShieldCheck size={15} /> Open credential <ArrowRight size={15} />
              </a>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-canvas/60 p-5 dark:border-[#25304D] dark:bg-[#0D1426]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink dark:text-[#F4F6FF]">{s.title || 'Assessment'}</p>
          <p className="mt-0.5 text-sm text-stone-600 dark:text-[#AEB7D0]">
            {s.company ? <span className="font-medium">{s.company}</span> : 'A hiring team'}
            {item.submitted_at && (
              <span className="text-stone-400 dark:text-[#8490AE]"> · Submitted {formatDate(item.submitted_at)}</span>
            )}
          </p>
        </div>
        <Pill tone={showsScore && item.result ? 'clay' : cred ? 'clay' : 'neutral'} className="shrink-0">
          <Check size={12} />{' '}
          {showsScore && item.result ? 'Scored' : cred ? 'Credential issued' : 'Under review'}
        </Pill>
      </div>

      {showsScore &&
        (item.result ? <ScoreDetail result={item.result} /> : <ScorePending status={item.status} />)}

      <div className="mt-4">
        {cred ? (
          <a
            href={cred.verify_url || '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-clay-300 hover:text-clay-700 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
          >
            <ShieldCheck size={15} className="text-clay-500" /> View your credential <ArrowRight size={15} />
          </a>
        ) : (
          <p className="text-sm text-stone-500 dark:text-[#8490AE]">
            {showsScore
              ? 'The hiring team sees the same score and reasoning, and will follow up about next steps.'
              : 'Your work is in. The hiring team reviews it and will follow up about next steps.'}
          </p>
        )}
      </div>
    </div>
  )
}

export default function Results() {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Cold-start resilience: the dev backend can 502 / time out while waking. Keep
  // loading (so the "waking…" hint stays) and auto-retry transient failures.
  const attemptRef = useRef(0)
  const retryTimer = useRef(null)
  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getMyResults()
      .then((res) => {
        attemptRef.current = 0
        setResults(res?.results || [])
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
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [load])

  // While a screen with candidate-visible results is still scoring, refresh quietly every 5s
  // (no loading flicker) so the score appears without a manual reload. Capped at ~5 minutes;
  // needs_review waits on a human, so it doesn't poll.
  const pollCount = useRef(0)
  useEffect(() => {
    const pending = (results || []).some(
      (r) => r.results_visibility === 'full' && !r.result && r.status !== 'needs_review',
    )
    if (!pending || pollCount.current >= 60) return undefined
    const t = setTimeout(() => {
      pollCount.current += 1
      api
        .getMyResults()
        .then((res) => setResults(res?.results || []))
        .catch(() => {})
    }, 5000)
    return () => clearTimeout(t)
  }, [results])

  const slow = useSlowLoading(loading)
  const isEmpty = !loading && !error && (results || []).length === 0

  if (EDITORIAL_UI_ENABLED) {
    const resultCount = (results || []).length
    const issuedCount = (results || []).filter((item) => Boolean(item.credential)).length

    return (
      <CandidatePortalPage
        label="Candidate record / submitted work"
        title="Know where each submission stands."
        description="Completed assignments appear here after submission. Outcome visibility stays with the inviting company, while any credential they issue becomes available to you."
        asideTitle="Record states"
        asideItems={[
          {
            title: 'Submitted',
            body: 'The work has been delivered to the inviting team.',
          },
          {
            title: 'Under review',
            body: 'The team owns the review process and communicates its decision.',
          },
          {
            title: 'Credential issued',
            body: 'An issued record can be opened and shared from this workspace.',
          },
        ]}
      >
        <section className="mt-8 grid border-y border-stone-300 bg-white/65 backdrop-blur-sm sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="px-5 py-4">
            <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Submission register
            </p>
            <p className="mt-1 text-sm text-stone-600">
              Status only. Detailed evaluation remains with the inviting team.
            </p>
          </div>
          <dl className="grid grid-cols-2 border-t border-stone-200 sm:border-l sm:border-t-0">
            <div className="border-r border-stone-200 px-5 py-4">
              <dt className="text-xs text-stone-500">Submitted</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{resultCount}</dd>
            </div>
            <div className="px-5 py-4">
              <dt className="text-xs text-stone-500">Credentials</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-brand-700">{issuedCount}</dd>
            </div>
          </dl>
        </section>

        {slow && loading && <WakingNote className="mt-6" />}
        {loading && <PortalSkeleton count={2} />}
        {error && <PortalError error={error} onRetry={load} />}

        {isEmpty && (
          <section className="mt-8 grid gap-6 border border-dashed border-brand-300 bg-white/70 px-6 py-8 sm:grid-cols-[auto_1fr] sm:items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
              <FileText size={22} />
            </span>
            <div>
              <h2 className="font-sans text-xl font-semibold text-ink">No submitted work yet</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
                After you submit an assignment, its review status appears here. Any credential issued
                for that work will be linked from the same record.
              </p>
            </div>
          </section>
        )}

        {!loading && !error && !isEmpty && (
          <div className="mt-8 space-y-3">
            {results.map((item, index) => (
              <ResultCard key={item.id} item={item} editorial index={index} />
            ))}
          </div>
        )}
      </CandidatePortalPage>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-serif text-3xl font-semibold text-ink dark:text-[#F4F6FF]">Results</h1>
      <p className="mt-2 text-stone-600 dark:text-[#AEB7D0]">
        Screens you’ve completed. When a company issues a credential record, it shows up here to share.
      </p>

      {slow && loading && <WakingNote className="mt-6" />}
      {loading && <PortalSkeleton count={2} />}
      {error && <PortalError error={error} onRetry={load} />}
      {isEmpty && (
        <PortalEmpty icon={FileText} title="No completed screens yet">
          Once you submit an assessment, it’ll appear here with its status and any credential you earn.
        </PortalEmpty>
      )}

      {!loading && !error && !isEmpty && (
        <div className="mt-6 space-y-3">
          {results.map((it) => (
            <ResultCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  )
}
