import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Kicker, Pill } from '../../components/primitives.jsx'
import Markdown from '../../components/Markdown.jsx'
import Reveal from '../../components/Reveal.jsx'
import { InviteSentList } from '../../components/InviteSentList.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import {
  Code,
  FileText,
  Sparkle,
  Mail,
  Link as LinkIcon,
  Plus,
  Check,
  ArrowRight,
  Clock,
  X,
  Camera,
} from '../../components/icons.jsx'

// Role templates — spin up a messy, AI-allowed, real-work task in <10 min.
const templates = [
  {
    id: 'backend',
    label: 'Backend',
    role: 'Senior Backend Engineer',
    task: 'Debug a failing payments service',
    prompt:
      'A payments service intermittently double-charges on retries. Here is the repo and a failing test. Reproduce the issue, fix the root cause, and add tests. You have ~30 minutes.',
    icon: Code,
  },
  {
    id: 'frontend',
    label: 'Frontend',
    role: 'Frontend Engineer',
    task: 'Fix a flaky checkout component',
    prompt:
      'A checkout component intermittently submits twice under slow networks. Reproduce it, fix the root cause, and harden it against double-submits.',
    icon: Code,
  },
  {
    id: 'fullstack',
    label: 'Full-stack',
    role: 'Full-stack Engineer',
    task: 'Add an idempotent webhook endpoint',
    prompt:
      'Add a webhook endpoint that is safe to retry: it must process each event exactly once and tolerate out-of-order delivery. Include tests.',
    icon: Code,
  },
  {
    id: 'data',
    label: 'Data',
    role: 'Data Engineer',
    task: 'Find the bug in a revenue pipeline',
    prompt:
      'A revenue pipeline reports the wrong daily totals after a timezone change. Find the bug, fix it, and add a regression test.',
    icon: Code,
  },
  {
    id: 'ml',
    label: 'ML',
    role: 'ML Engineer',
    task: 'Diagnose a drifting model in prod',
    prompt:
      'A production model has started drifting. Investigate the likely causes, propose a fix, and outline how you would monitor it going forward.',
    icon: Code,
  },
  {
    id: 'debug',
    label: 'Debug a real service',
    role: 'Backend Engineer',
    task: 'Reproduce and fix a race condition',
    prompt:
      'A background worker occasionally processes the same job twice under load. Reproduce the race condition, fix the root cause, and add a test.',
    icon: Code,
  },
]

const defaultRubric = [
  { label: 'Problem decomposition', points: 25 },
  { label: 'Correctness under edge cases', points: 25 },
  { label: 'Code quality & tests', points: 25 },
  { label: 'Debugging & root cause', points: 25 },
]

// Stable, slug-like criterion id the backend rubric.criteria[] expects.
const slug = (label, i) =>
  (label || `criterion-${i + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `criterion-${i + 1}`

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  )
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-card placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100'

export default function Author() {
  const { configured, user } = useAuth()
  const [tpl, setTpl] = useState('backend')
  const [aiAllowed, setAiAllowed] = useState(true)
  const active = templates.find((t) => t.id === tpl)

  const [role, setRole] = useState(active.role)
  const [task, setTask] = useState(active.prompt)
  const [rubric, setRubric] = useState(defaultRubric)
  const [duration, setDuration] = useState(30)
  // Deliverables checklist (TOU-146): up to 8 concrete asks the candidate can tick off while
  // working. Optional; shown in their workspace and back in your review.
  const [deliverables, setDeliverables] = useState([])
  // Camera + mic requirement (TOU-147): consent-gated start. Nothing is ever recorded.
  const [avRequired, setAvRequired] = useState(false)
  // Code screens get the 3-pane IDE (editor + AI); written screens get a Markdown response box.
  // Default to Code — most engineering screens are coding tasks (the old hardcoded 'markdown'
  // default made code tasks render the stacked written layout).
  const [responseType, setResponseType] = useState('code')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null) // { id, link }

  // Adaptive variant preview — each candidate gets a fresh, non-shareable task.
  const [variant, setVariant] = useState(null) // { prompt_md, variant_seed }
  const [variantLoading, setVariantLoading] = useState(false)
  const [variantError, setVariantError] = useState(null)

  // Copy feedback + email invite (the real "send") + free-tier meter.
  const [copied, setCopied] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteState, setInviteState] = useState('idle') // idle | sending | error
  const [inviteError, setInviteError] = useState(null)
  // Everyone invited this session, as [{ email, emailSent, link }], so the
  // recruiter keeps a persistent "Sent to" list while sending more.
  const [sentInvites, setSentInvites] = useState([])
  const [limitReached, setLimitReached] = useState(false)
  const [usage, setUsage] = useState(null)
  const [upgrading, setUpgrading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState(null)

  const total = rubric.reduce((s, r) => s + (Number(r.points) || 0), 0)

  function applyTemplate(id) {
    const t = templates.find((x) => x.id === id)
    if (!t) return
    setTpl(id)
    setRole(t.role)
    setTask(t.prompt)
    setCreated(null)
    setError(null)
    setVariant(null)
    setVariantError(null)
  }

  // Mint a fresh adaptive variant of the created work sample and show its prompt.
  async function handlePreviewVariant() {
    if (!created?.id) return
    setVariantLoading(true)
    setVariantError(null)
    try {
      const v = await api.makeVariant(created.id)
      setVariant({ prompt_md: v.prompt_md || '', variant_seed: v.variant_seed || '' })
    } catch (e) {
      setVariantError(e.message || 'Could not generate a variant.')
    } finally {
      setVariantLoading(false)
    }
  }

  function updateCriterion(i, patch) {
    setRubric((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addCriterion() {
    setRubric((prev) => [...prev, { label: '', points: 10 }])
  }
  function removeCriterion(i) {
    setRubric((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateDeliverable(i, value) {
    setDeliverables((prev) => prev.map((d, idx) => (idx === i ? value.slice(0, 200) : d)))
  }
  function addDeliverable() {
    setDeliverables((prev) => (prev.length >= 8 ? prev : [...prev, '']))
  }
  function removeDeliverable(i) {
    setDeliverables((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleCreate() {
    setError(null)
    if (!role.trim() || !task.trim()) {
      setError('Add a role title and a task before sending.')
      return
    }
    const criteria = rubric
      .filter((r) => r.label.trim())
      .map((r, i) => ({
        id: slug(r.label, i),
        requirement: r.label.trim(),
        points_possible: Math.max(0, Number(r.points) || 0),
        weight: 1,
      }))
    if (!criteria.length) {
      setError('Add at least one rubric criterion.')
      return
    }

    setSubmitting(true)
    try {
      const cleanDeliverables = deliverables.map((d) => d.trim()).filter(Boolean).slice(0, 8)
      const ws = await api.authorWorkSample({
        title: task.split('\n')[0].slice(0, 120) || role,
        prompt_md: task,
        role_family: role,
        response_type: responseType,
        duration_minutes: Number(duration) || 60,
        scoring_strategy: 'weighted_sum',
        rubric: { criteria, ai_allowed: aiAllowed },
        // Only sent when actually used, so plain screens keep the pre-111/112 payload.
        ...(cleanDeliverables.length ? { deliverables: cleanDeliverables } : {}),
        ...(avRequired ? { av_required: true } : {}),
      })
      // Shareable candidate link carries the work-sample id; the candidate screen
      // assigns + opens it. (No public list endpoint exists — id is the handle.)
      const link = `${window.location.origin}/candidate?ws=${ws.id}`
      setCreated({ id: ws.id, link })
    } catch (e) {
      setError(e.message || 'Could not create the screen.')
    } finally {
      setSubmitting(false)
    }
  }

  // Load the real free-tier meter so the footer + limit gate reflect actual usage.
  useEffect(() => {
    if (!configured || !user) return
    let active = true
    api
      .getPaymentsUsage()
      .then((u) => active && setUsage(u))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [configured, user])

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(created.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable (insecure context) — the field stays selectable */
    }
  }

  async function handleInvite(e) {
    e?.preventDefault?.()
    if (!created?.id || !inviteEmail.trim()) return
    setInviteState('sending')
    setInviteError(null)
    try {
      const email = inviteEmail.trim()
      const res = await api.inviteCandidate(created.id, email)
      setSentInvites((list) => [
        ...list,
        { email, emailSent: Boolean(res?.email_sent), link: res?.link || created.link },
      ])
      setInviteEmail('')
      setInviteState('idle')
      api.getPaymentsUsage().then(setUsage).catch(() => {})
    } catch (err) {
      // The free-tier gate is metered at send (HTTP 402, { upgrade:true }).
      if (err?.status === 402 || err?.body?.upgrade) {
        setLimitReached(true)
        setInviteState('idle')
      } else {
        setInviteError(err.message || 'Could not send the invite.')
        setInviteState('error')
      }
    }
  }

  async function handleUpgrade() {
    setUpgrading(true)
    try {
      const { url } = await api.createCheckoutSession('startup')
      window.location.assign(url || '/pricing')
    } catch {
      window.location.assign('/pricing')
    }
  }

  async function handleDeleteScreen() {
    if (!created?.id) return
    setDeleting(true)
    setDeleteErr(null)
    try {
      await api.deleteWorkSample(created.id)
      // Back to the builder, clean slate.
      setCreated(null)
      setVariant(null)
      setSentInvites([])
      setInviteState('idle')
      setDeleteConfirm(false)
    } catch (e) {
      setDeleteErr(
        e?.status === 404
          ? 'Deleting isn’t available yet — it lights up after the next deploy.'
          : e?.message || 'Could not delete the screen.',
      )
    } finally {
      setDeleting(false)
    }
  }

  const showLimit =
    limitReached || (usage && usage.plan === 'free' && Number(usage.remaining) <= 0)

  return (
    <Container className="py-8 lg:py-10">
      <div className="max-w-2xl">
        <Kicker>New screen</Kicker>
        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.1] sm:text-4xl">
          Build a role-specific evidence screen
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-stone-600">
          Give candidates a realistic task, score the submitted work against your rubric, and keep
          session signals separate as context for a human reviewer.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Builder */}
        <div className="space-y-6">
          {/* 1. Template */}
          <Reveal className="card p-6">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                1
              </span>
              <h2 className="font-serif text-lg font-semibold text-ink">Pick a role template</h2>
            </div>
            <p className="mt-1 text-sm text-stone-500">
              Start from a real task for the role. You can edit everything.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {templates.map((t) => {
                const Icon = t.icon
                const on = t.id === tpl
                return (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t.id)}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                      on
                        ? 'border-clay-300 bg-clay-50 ring-1 ring-clay-200'
                        : 'border-stone-200 bg-white hover:border-stone-300'
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-8 w-8 place-items-center rounded-lg ${
                        on ? 'bg-clay-500 text-white' : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{t.label}</span>
                      <span className="block text-xs text-stone-500">{t.task}</span>
                    </span>
                    {on && <Check size={16} className="ml-auto text-clay-500" />}
                  </button>
                )
              })}
            </div>
          </Reveal>

          {/* 2. Task */}
          <Reveal delay={80} className="card p-6">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                2
              </span>
              <h2 className="font-serif text-lg font-semibold text-ink">Shape the task</h2>
            </div>
            <div className="mt-4 space-y-4">
              <Field label="Role title">
                <input
                  className={inputCls}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </Field>
              <Field
                label="The real-work task"
                hint="Messy and realistic beats clean and abstract. Give them a service to fix, not a puzzle."
              >
                <textarea
                  className={`${inputCls} min-h-[120px] resize-y`}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                />
              </Field>
              <Field label="Time limit (minutes)">
                <input
                  type="number"
                  min={5}
                  max={240}
                  className={`${inputCls} max-w-[10rem]`}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
              <Field label="Response type">
                <div className="inline-flex rounded-xl border border-stone-200 bg-canvas/60 p-1">
                  {[
                    { key: 'code', label: 'Code (IDE)' },
                    { key: 'markdown', label: 'Written' },
                  ].map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setResponseType(o.key)}
                      aria-pressed={responseType === o.key}
                      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        responseType === o.key ? 'bg-clay-500 text-white' : 'text-stone-600 hover:text-ink'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-stone-400">
                  Code gives candidates the in-browser IDE (editor + language picker + AI). Written
                  gives a Markdown response box.
                </p>
              </Field>
              <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-canvas/60 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm text-ink">
                  <Sparkle size={16} className="text-clay-500" /> AI is allowed
                </span>
                <button
                  onClick={() => setAiAllowed((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    aiAllowed ? 'bg-clay-500' : 'bg-stone-300'
                  }`}
                  aria-pressed={aiAllowed}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      aiAllowed ? 'left-[1.4rem]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <p className="-mt-1 text-xs leading-relaxed text-stone-500">
                Recommended on. AI use becomes part of the signal — we measure how well they direct
                and verify it, like the real job.
              </p>

              <Field
                label="Deliverables checklist (optional)"
                hint="Up to 8 concrete asks (e.g. a rollout plan, stated assumptions). Candidates tick them off while working; you see the checklist in the review. Never a gate."
              >
                <div className="space-y-2">
                  {deliverables.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        maxLength={200}
                        placeholder={`Deliverable ${i + 1} (e.g. Include a rollout plan)`}
                        value={d}
                        onChange={(e) => updateDeliverable(i, e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeDeliverable(i)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-ink"
                        aria-label="Remove deliverable"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {deliverables.length < 8 && (
                    <button
                      type="button"
                      onClick={addDeliverable}
                      className="btn-quiet px-0 text-xs text-clay-700 hover:text-clay-800"
                    >
                      <Plus size={14} /> Add deliverable
                    </button>
                  )}
                </div>
              </Field>

              <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-canvas/60 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm text-ink">
                  <Camera size={16} className="text-clay-500" /> Require camera and microphone
                </span>
                <button
                  onClick={() => setAvRequired((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    avRequired ? 'bg-clay-500' : 'bg-stone-300'
                  }`}
                  aria-pressed={avRequired}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      avRequired ? 'left-[1.4rem]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <p className="-mt-1 text-xs leading-relaxed text-stone-500">
                Candidates must consent at the start gate before the screen unlocks. Presence
                signal only: no video or audio is ever recorded or stored, and camera/mic
                on-off moments surface as review notes for you, never automated pass/fail.
              </p>
            </div>
          </Reveal>

          {/* 3. Rubric */}
          <Reveal delay={140} className="card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                  3
                </span>
                <h2 className="font-serif text-lg font-semibold text-ink">Set the rubric</h2>
              </div>
              <Pill tone="clay">{total} points</Pill>
            </div>
            <p className="mt-1 text-sm text-stone-500">
              The score is computed in code from these criteria — never asserted by the model.
            </p>
            <div className="mt-4 divide-y divide-stone-200">
              {rubric.map((r, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <input
                    className={`${inputCls} flex-1`}
                    placeholder="Criterion (e.g. Correctness under edge cases)"
                    value={r.label}
                    onChange={(e) => updateCriterion(i, { label: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={`${inputCls} w-20 text-right`}
                    value={r.points}
                    onChange={(e) => updateCriterion(i, { points: e.target.value })}
                  />
                  <span className="text-xs text-stone-400">pts</span>
                  <button
                    onClick={() => removeCriterion(i)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-ink"
                    aria-label="Remove criterion"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addCriterion}
              className="btn-quiet mt-2 px-0 text-xs text-clay-700 hover:text-clay-800"
            >
              <Plus size={14} /> Add criterion
            </button>
          </Reveal>
        </div>

        {/* Summary / distribute rail */}
        <div className="space-y-6">
          <Reveal delay={120} className="card sticky top-20 p-5">
            <h3 className="font-serif text-base font-semibold text-ink">Ready to send</h3>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-stone-500">Template</dt>
                <dd className="font-medium text-ink">{active?.label}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">AI</dt>
                <dd className="font-medium text-ink">{aiAllowed ? 'Allowed' : 'Not allowed'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">Rubric</dt>
                <dd className="font-medium text-ink">
                  {total} pts · {rubric.filter((r) => r.label.trim()).length} criteria
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">Est. time</dt>
                <dd className="inline-flex items-center gap-1 font-medium text-ink">
                  <Clock size={14} /> ~{duration} min
                </dd>
              </div>
            </dl>

            {!configured && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100">
                Connect Supabase (VITE_SUPABASE_URL / ANON_KEY) and sign in to publish a real screen.
              </p>
            )}
            {configured && !user && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100">
                Sign in to publish a screen to your account.
              </p>
            )}

            {error && (
              <p className="mt-4 rounded-lg bg-flag-50 px-3 py-2 text-xs leading-relaxed text-flag-700 ring-1 ring-flag-100">
                {error}
              </p>
            )}

            {created ? (
              <div className="mt-5 rounded-xl border border-clay-200 bg-clay-50 p-4">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-clay-800">
                  <Check size={16} /> Screen created
                </span>
                <p className="mt-2 text-xs text-clay-700">Share this link with your candidate:</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    readOnly
                    value={created.link}
                    onFocus={(e) => e.target.select()}
                    className="w-full truncate rounded-lg border border-clay-200 bg-white px-2.5 py-2 font-mono text-xs text-ink"
                  />
                  <button
                    onClick={copyLink}
                    className="btn-ghost shrink-0 px-3 py-2 text-xs"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <Link
                  to={`/candidate?ws=${created.id}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
                >
                  Open candidate view <ArrowRight size={14} />
                </Link>

                {/* Invite by email — the real "send", metered by the free-tier gate */}
                <div className="mt-4 border-t border-clay-200 pt-4">
                  {showLimit ? (
                    <div className="rounded-xl border border-flag-100 bg-flag-50 p-3">
                      <p className="text-xs font-semibold text-flag-700">Free plan limit reached</p>
                      <p className="mt-1 text-[0.7rem] leading-relaxed text-flag-700/90">
                        You’ve used all {usage?.limit ?? 5} candidate screens this month. The link above
                        still works to preview. Upgrade to invite more candidates.
                      </p>
                      <button
                        type="button"
                        onClick={handleUpgrade}
                        disabled={upgrading}
                        className="btn-primary mt-2 px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {upgrading ? 'Opening checkout…' : 'Upgrade to send'}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleInvite}>
                      <label className="text-xs font-semibold text-clay-800">Or invite by email</label>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="email"
                          required
                          placeholder="candidate@email.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="w-full rounded-lg border border-clay-200 bg-white px-2.5 py-2 text-xs text-ink placeholder:text-stone-400 focus:border-clay-400 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={inviteState === 'sending'}
                          className="btn-primary shrink-0 px-3 py-2 text-xs disabled:opacity-60"
                        >
                          <Mail size={14} /> {inviteState === 'sending' ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                      {inviteState === 'error' && inviteError && (
                        <p className="mt-2 text-[0.7rem] text-flag-700">{inviteError}</p>
                      )}
                    </form>
                  )}
                  <InviteSentList invites={sentInvites} />
                </div>

                {/* Adaptive variant preview */}
                <div className="mt-4 border-t border-clay-200 pt-4">
                  <button
                    onClick={handlePreviewVariant}
                    disabled={variantLoading}
                    className="btn-ghost w-full text-xs disabled:opacity-60"
                  >
                    <Sparkle size={15} />{' '}
                    {variantLoading
                      ? 'Generating variant…'
                      : variant
                        ? 'Generate another variant'
                        : 'Preview a candidate variant'}
                  </button>
                  <p className="mt-2 text-[0.7rem] leading-relaxed text-clay-700">
                    Each candidate gets a fresh task variant, which makes simple answer sharing less useful.
                  </p>

                  {variantError && (
                    <p className="mt-2 rounded-lg bg-flag-50 px-3 py-2 text-[0.7rem] leading-relaxed text-flag-700 ring-1 ring-flag-100">
                      {variantError}
                    </p>
                  )}

                  {variant && (
                    <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-stone-400">
                          Variant preview
                        </span>
                        <span className="font-mono text-[0.7rem] text-stone-400">
                          seed {variant.variant_seed}
                        </span>
                      </div>
                      <div className="mt-2 max-h-72 overflow-auto">
                        <Markdown source={variant.prompt_md} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Delete this screen */}
                <div className="mt-4 border-t border-clay-200 pt-4">
                  {deleteErr && <p className="mb-2 text-[0.7rem] text-flag-700">{deleteErr}</p>}
                  {deleteConfirm ? (
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span className="text-clay-800">Delete this screen?</span>
                      <button
                        onClick={handleDeleteScreen}
                        disabled={deleting}
                        className="font-semibold text-flag-700 hover:opacity-80 disabled:opacity-50"
                      >
                        {deleting ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button onClick={() => setDeleteConfirm(false)} className="text-stone-500 hover:text-ink">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setDeleteErr(null)
                        setDeleteConfirm(true)
                      }}
                      className="text-xs text-stone-400 hover:text-flag-700"
                    >
                      Delete this screen
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <button
                  onClick={handleCreate}
                  disabled={submitting || !configured || !user}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  <LinkIcon size={16} /> {submitting ? 'Creating…' : 'Create shareable link'}
                </button>
              </div>
            )}
            {usage && usage.plan === 'free' && (
              <p className="mt-3 text-center text-xs text-stone-400">
                {Math.max(0, Number(usage.remaining) || 0)} of {usage.limit} free candidate screens
                left this month.
              </p>
            )}
          </Reveal>

          <Reveal delay={180} className="rounded-2xl border border-stone-200 bg-canvas/60 p-5">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
              <FileText size={16} className="text-clay-500" /> What the candidate sees
            </span>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">
              A calm, respectful screen with “AI is allowed” stated up front — candidate goodwill is
              part of the product.
            </p>
            <Link
              to={created ? `/candidate?ws=${created.id}` : '/candidate'}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
            >
              Preview candidate view <ArrowRight size={14} />
            </Link>
          </Reveal>
        </div>
      </div>
    </Container>
  )
}
