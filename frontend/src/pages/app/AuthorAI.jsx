import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Container, Kicker, Pill } from '../../components/primitives.jsx'
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
  Bolt,
} from '../../components/icons.jsx'

// Stable, slug-like criterion id the backend rubric.criteria[] expects (same as Author).
const slug = (label, i) =>
  (label || `criterion-${i + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `criterion-${i + 1}`

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-card placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100'

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  )
}

const SAMPLE_JD = `Senior Backend Engineer — Payments

You'll own the reliability of our billing platform: idempotent payment processing,
webhook ingestion from Stripe, and the ledger that reconciles them. Our stack is
Node.js + Postgres. We care about engineers who can reproduce a production bug from a
vague report, fix the root cause (not the symptom), and harden the path against retries
and partial failure. You'll use AI tools daily — we want people who direct and verify
them well, not people who paste unread output.`

// Cycle a "real progress feel" while the model works.
const GEN_STEPS = [
  'Reading the role…',
  'Designing a messy, real-work task…',
  'Writing a rubric scored in code…',
  'Generating runnable hidden tests…',
  'Assembling your editable draft…',
]

function GenProgress() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % GEN_STEPS.length), 1400)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-clay-500 text-white">
          <Sparkle size={16} className="animate-pulse" />
        </span>
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">Generating your screen</h2>
          <p className="text-sm text-stone-500">Usually under a minute.</p>
        </div>
      </div>
      <ul className="mt-5 space-y-2.5">
        {GEN_STEPS.map((s, idx) => {
          const done = idx < i
          const active = idx === i
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[0.6rem] ${
                  done
                    ? 'bg-clay-500 text-white'
                    : active
                      ? 'bg-clay-100 text-clay-700 ring-2 ring-clay-200'
                      : 'bg-stone-100 text-stone-400'
                }`}
              >
                {done ? <Check size={11} /> : idx + 1}
              </span>
              <span className={active ? 'text-ink' : done ? 'text-stone-500' : 'text-stone-400'}>{s}</span>
              {active && (
                <span className="ml-auto flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-clay-400 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-clay-400 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-clay-400" />
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
        <div className="h-full animate-pulse rounded-full bg-clay-400" style={{ width: `${(i + 1) * 20}%` }} />
      </div>
    </div>
  )
}

export default function AuthorAI() {
  const { configured, user } = useAuth()

  // Input stage
  const [mode, setMode] = useState('jd') // 'jd' | 'repo'
  const [jd, setJd] = useState('')
  const [snippet, setSnippet] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [language, setLanguage] = useState('')
  const [difficulty, setDifficulty] = useState('mid')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(null)

  // Draft (editable)
  const [draft, setDraft] = useState(null) // carries non-edited fields (tests, starter_files, languages…)
  const [role, setRole] = useState('')
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const [duration, setDuration] = useState(45)
  const [aiAllowed, setAiAllowed] = useState(true)
  const [rubric, setRubric] = useState([]) // [{ label, points, requirement }]

  // Save + distribute
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null) // { id, link }
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

  const draftRef = useRef(null)
  const total = rubric.reduce((s, r) => s + (Number(r.points) || 0), 0)

  // Real free-tier meter (drives the send gate), same source as the manual builder.
  useEffect(() => {
    if (!configured || !user) return
    let on = true
    api
      .getPaymentsUsage()
      .then((u) => on && setUsage(u))
      .catch(() => {})
    return () => {
      on = false
    }
  }, [configured, user])

  function hydrate(d) {
    setDraft(d)
    setRole(d.role || '')
    setTitle(d.title || '')
    setTask(d.task || '')
    setDuration(d.duration_minutes || 45)
    setAiAllowed(d.ai_allowed !== false)
    setRubric(
      (d.rubric || []).map((r) => ({
        label: r.label || '',
        points: Number(r.points) || 0,
        requirement: r.requirement || '',
      })),
    )
    setCreated(null)
    setSentInvites([])
    setInviteState('idle')
    setError(null)
  }

  function describeGenError(e) {
    const reason = e?.body?.reason
    if (e?.status === 429)
      return 'The AI author is busy or you’ve hit today’s generation limit — give it a moment and try again.'
    // A transient provider hiccup (overload/5xx) is retryable — distinct from "not configured"
    // (both are 503), and never a "tweak your input" problem.
    if (reason === 'ai_transient')
      return 'The AI is temporarily busy — give it a moment and try again.'
    if (e?.status === 503) return 'AI generation isn’t configured for this deployment yet.'
    if (e?.status === 502)
      return 'Couldn’t shape a usable screen from that — add a little more detail and regenerate.'
    return e?.message || 'Could not generate a screen. Try again.'
  }

  async function handleGenerate() {
    setGenError(null)
    if (mode === 'jd' && jd.trim().length < 20) {
      setGenError('Paste a job description (a sentence or two is enough) to generate from.')
      return
    }
    if (mode === 'repo' && snippet.trim().length < 8 && repoUrl.trim().length < 8) {
      setGenError('Paste a code snippet or a repo URL to generate from.')
      return
    }
    setGenerating(true)
    setDraft(null)
    setCreated(null)
    try {
      const opts = {
        language: language || undefined,
        difficulty: difficulty || undefined,
      }
      const res =
        mode === 'jd'
          ? await api.generateScreenFromJD({ jd: jd.trim(), ...opts })
          : await api.generateScreenFromRepo({
              snippet: snippet.trim() || undefined,
              repo_url: repoUrl.trim() || undefined,
              ...opts,
            })
      hydrate(res.draft)
      // Bring the freshly-generated draft into view.
      setTimeout(() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    } catch (e) {
      setGenError(describeGenError(e))
    } finally {
      setGenerating(false)
    }
  }

  function updateCriterion(i, patch) {
    setRubric((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addCriterion() {
    setRubric((prev) => [...prev, { label: '', points: 10, requirement: '' }])
  }
  function removeCriterion(i) {
    setRubric((prev) => prev.filter((_, idx) => idx !== i))
  }

  function startOver() {
    setDraft(null)
    setCreated(null)
    setGenError(null)
    setError(null)
  }

  async function handleCreate() {
    setError(null)
    if (!task.trim()) {
      setError('Add a task before sending.')
      return
    }
    const criteria = rubric
      .filter((r) => r.label.trim())
      .map((r, i) => ({
        id: slug(r.label, i),
        requirement: (r.requirement || r.label).trim(),
        points_possible: Math.max(0, Number(r.points) || 0),
        weight: 1,
      }))
    if (!criteria.length) {
      setError('Add at least one rubric criterion.')
      return
    }

    setSubmitting(true)
    try {
      const ws = await api.authorWorkSample({
        title: (title.trim() || task.split('\n')[0]).slice(0, 120) || role || 'Real-work screen',
        prompt_md: task,
        role_family: draft?.role_family || role || null,
        response_type: draft?.response_type || 'markdown',
        languages: Array.isArray(draft?.languages) ? draft.languages : [],
        starter_files: Array.isArray(draft?.starter_files) ? draft.starter_files : [],
        tests: draft?.hidden_tests || null,
        duration_minutes: Number(duration) || 60,
        scoring_strategy: 'weighted_sum',
        rubric: { criteria, ai_allowed: aiAllowed },
      })
      const link = `${window.location.origin}/candidate?ws=${ws.id}`
      setCreated({ id: ws.id, link })
    } catch (e) {
      setError(e.message || 'Could not create the screen.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(created.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable */
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

  const showLimit = limitReached || (usage && usage.plan === 'free' && Number(usage.remaining) <= 0)
  const testSummary = draft?.test_summary
  const hasTests = testSummary?.kind === 'unit_function' && testSummary.case_count > 0

  return (
    <Container className="py-8 lg:py-10">
      <div className="max-w-2xl">
        <Kicker>Author with AI</Kicker>
        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.1] sm:text-4xl">
          Paste a job description. Get a real-work screen.
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-stone-600">
          Touchstones generates a tailored, messy, AI-allowed task — with a rubric scored in code and
          runnable hidden tests — in under a minute. Edit anything, then send through the normal flow.
        </p>
        <Link
          to="/app/author"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-ink"
        >
          Prefer to start from scratch? Use the manual builder <ArrowRight size={14} />
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Left: input → loading → editable draft */}
        <div className="space-y-6">
          {/* 1. Input */}
          <Reveal className="card p-6">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                1
              </span>
              <h2 className="font-serif text-lg font-semibold text-ink">Give it a signal</h2>
            </div>

            <div className="mt-4 inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">
              <button
                onClick={() => setMode('jd')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === 'jd' ? 'bg-white text-ink shadow-card' : 'text-stone-500 hover:text-ink'
                }`}
              >
                <FileText size={14} className="mr-1 inline" /> Job description
              </button>
              <button
                onClick={() => setMode('repo')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === 'repo' ? 'bg-white text-ink shadow-card' : 'text-stone-500 hover:text-ink'
                }`}
              >
                <Code size={14} className="mr-1 inline" /> Repo / snippet
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {mode === 'jd' ? (
                <Field
                  label="Job description"
                  hint="Paste the JD (or a rough sketch of the role). The messier and more real, the better the task."
                >
                  <textarea
                    className={`${inputCls} min-h-[160px] resize-y`}
                    placeholder="Paste a job description…"
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setJd(SAMPLE_JD)}
                    className="btn-quiet mt-2 px-0 text-xs text-clay-700 hover:text-clay-800"
                  >
                    <Sparkle size={13} /> Try an example
                  </button>
                </Field>
              ) : (
                <>
                  <Field
                    label="Code snippet"
                    hint="A representative file or excerpt — the generated task mirrors this stack and idioms."
                  >
                    <textarea
                      className={`${inputCls} min-h-[140px] resize-y font-mono text-xs`}
                      placeholder="Paste a code snippet…"
                      value={snippet}
                      onChange={(e) => setSnippet(e.target.value)}
                    />
                  </Field>
                  <Field label="Repo URL (optional)" hint="Used as a signal for the stack/role — the repo is not fetched.">
                    <input
                      className={inputCls}
                      placeholder="https://github.com/org/repo"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                    />
                  </Field>
                </>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Language (optional)">
                  <input
                    className={inputCls}
                    placeholder="javascript"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  />
                </Field>
                <Field label="Difficulty">
                  <select className={inputCls} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                    <option value="junior">Junior</option>
                    <option value="mid">Mid</option>
                    <option value="senior">Senior</option>
                    <option value="staff">Staff</option>
                  </select>
                </Field>
              </div>

              {genError && (
                <p className="rounded-lg bg-flag-50 px-3 py-2 text-xs leading-relaxed text-flag-700 ring-1 ring-flag-100">
                  {genError}
                </p>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating || !configured || !user}
                className="btn-primary w-full disabled:opacity-60"
              >
                <Sparkle size={16} /> {generating ? 'Generating…' : draft ? 'Regenerate' : 'Generate screen'}
              </button>
              {(!configured || !user) && (
                <p className="text-center text-xs text-stone-400">Sign in to generate a screen.</p>
              )}
            </div>
          </Reveal>

          {/* 2. Loading */}
          {generating && (
            <Reveal>
              <GenProgress />
            </Reveal>
          )}

          {/* 3. Editable draft */}
          {draft && !generating && (
            <div ref={draftRef} className="space-y-6">
              <Reveal delay={60} className="card p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                      2
                    </span>
                    <h2 className="font-serif text-lg font-semibold text-ink">Tweak the task</h2>
                  </div>
                  <Pill tone="clay">
                    <Sparkle size={12} /> AI draft
                  </Pill>
                </div>
                <div className="mt-4 space-y-4">
                  <Field label="Screen title">
                    <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
                  </Field>
                  <Field label="Role title">
                    <input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} />
                  </Field>
                  <Field label="The real-work task" hint="Generated to be messy and role-specific. Edit freely.">
                    <textarea
                      className={`${inputCls} min-h-[200px] resize-y`}
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
                </div>
              </Reveal>

              {/* Rubric */}
              <Reveal delay={100} className="card p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-clay-500 text-xs font-semibold text-white">
                      3
                    </span>
                    <h2 className="font-serif text-lg font-semibold text-ink">Tune the rubric</h2>
                  </div>
                  <Pill tone={total === 100 ? 'clay' : 'amber'}>{total} points</Pill>
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  Scored in code from these criteria — never asserted by the model.
                </p>
                <div className="mt-4 divide-y divide-stone-200">
                  {rubric.map((r, i) => (
                    <div key={i} className="py-3">
                      <div className="flex items-center gap-3">
                        <input
                          className={`${inputCls} flex-1`}
                          placeholder="Criterion"
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
                      {r.requirement && (
                        <p className="mt-1.5 pl-1 text-xs leading-relaxed text-stone-500">{r.requirement}</p>
                      )}
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

              {/* Tests + starter files (generated, carried through on save) */}
              <Reveal delay={140} className="card p-6">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 text-stone-500">
                    <Bolt size={16} />
                  </span>
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-ink">
                      {hasTests ? 'Runnable hidden tests' : 'Tests'}
                    </h2>
                    <p className="text-sm text-stone-500">
                      {hasTests
                        ? `${testSummary.case_count} hidden test${testSummary.case_count === 1 ? '' : 's'} run against the candidate’s code in an isolated sandbox.`
                        : 'This is a written task — scored from the rubric, no automated tests.'}
                    </p>
                  </div>
                </div>

                {hasTests && (
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {testSummary.case_names.map((name, i) => (
                      <li
                        key={i}
                        className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-canvas/60 px-3 py-2 text-xs text-ink"
                      >
                        <Check size={13} className="shrink-0 text-clay-500" /> {name}
                      </li>
                    ))}
                  </ul>
                )}

                {Array.isArray(draft.starter_files) && draft.starter_files.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">
                      Starter files
                    </p>
                    <div className="mt-2 space-y-3">
                      {draft.starter_files.map((f, i) => (
                        <details key={i} className="rounded-xl border border-stone-200 bg-white">
                          <summary className="cursor-pointer px-3 py-2 font-mono text-xs text-ink">
                            {f.path}
                          </summary>
                          <pre className="max-h-64 overflow-auto border-t border-stone-200 bg-stone-50 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-stone-700">
                            {f.content}
                          </pre>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-4 text-xs leading-relaxed text-stone-500">
                  Tests and starter files are saved with the screen — fine-tune them anytime from the screen’s
                  edit view.
                </p>
              </Reveal>

              <div className="flex flex-wrap gap-3">
                <button onClick={handleGenerate} disabled={generating} className="btn-ghost text-sm disabled:opacity-60">
                  <Sparkle size={15} /> Regenerate
                </button>
                <button onClick={startOver} className="btn-quiet text-sm text-stone-500 hover:text-ink">
                  Start over
                </button>
              </div>
            </div>
          )}

          {/* Empty hint before first generation */}
          {!draft && !generating && (
            <Reveal delay={80} className="rounded-2xl border border-dashed border-stone-300 bg-canvas/40 p-6 text-center">
              <Sparkle size={22} className="mx-auto text-clay-400" />
              <p className="mt-2 text-sm font-medium text-ink">Your generated screen will appear here</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-stone-500">
                Paste a job description above and hit Generate. You’ll get an editable task, a rubric that sums
                to 100, and — when the role is codeable — runnable hidden tests.
              </p>
            </Reveal>
          )}
        </div>

        {/* Right rail: ready-to-send summary + create/invite */}
        <div className="space-y-6">
          <Reveal delay={120} className="card sticky top-20 p-5">
            <h3 className="font-serif text-base font-semibold text-ink">Ready to send</h3>
            {!draft ? (
              <p className="mt-3 text-sm leading-relaxed text-stone-500">
                Generate a screen to preview and send it. Nothing is saved until you create the link.
              </p>
            ) : (
              <>
                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-stone-500">Role</dt>
                    <dd className="truncate font-medium text-ink">{role || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Format</dt>
                    <dd className="font-medium text-ink">
                      {draft.response_type === 'code' ? 'Code' : 'Written'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Tests</dt>
                    <dd className="font-medium text-ink">{hasTests ? `${testSummary.case_count} hidden` : 'Rubric-only'}</dd>
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
                      <button onClick={copyLink} className="btn-ghost shrink-0 px-3 py-2 text-xs">
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <Link
                      to={`/candidate?ws=${created.id}`}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-clay-700 hover:text-clay-800"
                    >
                      Open candidate view <ArrowRight size={14} />
                    </Link>

                    <div className="mt-4 border-t border-clay-200 pt-4">
                      {showLimit ? (
                        <div className="rounded-xl border border-flag-100 bg-flag-50 p-3">
                          <p className="text-xs font-semibold text-flag-700">Free plan limit reached</p>
                          <p className="mt-1 text-[0.7rem] leading-relaxed text-flag-700/90">
                            You’ve used all {usage?.limit ?? 5} verified screens this month. The link still
                            previews — upgrade to invite more candidates.
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
                    {Math.max(0, Number(usage.remaining) || 0)} of {usage.limit} free verified screens left
                    this month.
                  </p>
                )}
              </>
            )}
          </Reveal>

          <Reveal delay={180} className="rounded-2xl border border-stone-200 bg-canvas/60 p-5">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
              <FileText size={16} className="text-clay-500" /> Generative, per role
            </span>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">
              Every screen is written for this role — not pulled from a static bank. Edit anything, then send
              through the same verified flow.
            </p>
          </Reveal>
        </div>
      </div>
    </Container>
  )
}
