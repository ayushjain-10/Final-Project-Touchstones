import { useEffect, useMemo, useRef, useState } from 'react'
import { Pill } from '../../components/primitives.jsx'
import { api } from '../../services/api.js'
import Markdown from '../../components/Markdown.jsx'
import { InviteSentList } from '../../components/InviteSentList.jsx'
import { Plus, FileText, Code, Check, Sparkle, ArrowRight } from '../../components/icons.jsx'
import { track } from '../../services/analytics.js'

// Position taxonomy — mirrors the backend allow-list + the seeded library.
const POSITIONS = [
  { value: '', label: 'All' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'fullstack', label: 'Full-stack' },
  { value: 'data_ml', label: 'Data / ML' },
  { value: 'devops', label: 'DevOps' },
  { value: 'mobile', label: 'Mobile' },
]
const POSITION_LABEL = Object.fromEntries(POSITIONS.map((p) => [p.value, p.label]))

const EMPTY_FORM = {
  position: 'frontend',
  title: '',
  summary: '',
  prompt_md: '',
  languages: '',
  time_limit_min: 45,
  starter_files: '[]',
  rubric: '{\n  "criteria": [\n    { "id": "correctness", "requirement": "Solves the real problem", "points_possible": 60, "weight": 1 }\n  ]\n}',
  tests: '',
}

// Build the create/edit form state from an existing template.
function formFromTemplate(t) {
  return {
    position: t.position || 'frontend',
    title: t.title || '',
    summary: t.summary || '',
    prompt_md: t.prompt_md || '',
    languages: (t.languages || []).join(', '),
    time_limit_min: t.time_limit_min || 45,
    starter_files: JSON.stringify(t.starter_files || [], null, 2),
    rubric: JSON.stringify(t.rubric || { criteria: [] }, null, 2),
    tests: t.tests ? JSON.stringify(t.tests, null, 2) : '',
  }
}

export default function Library() {
  const [position, setPosition] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selected, setSelected] = useState(null) // template being viewed
  const [editing, setEditing] = useState(false) // create/edit form open
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [published, setPublished] = useState(null) // { title, workSampleId } after "Use as a screen"
  const loadTokenRef = useRef(0) // B-21: latest-request wins (stale-response guard)

  async function load() {
    // B-21: guard against out-of-order responses when the position filter changes quickly — only the
    // latest request may write state (active-flag pattern, as in Insights.jsx).
    loadTokenRef.current += 1
    const token = loadTokenRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await api.listAssessments(position)
      if (token !== loadTokenRef.current) return
      const list = Array.isArray(res) ? res : res?.assessments || res?.templates || []
      setItems(list)
    } catch (e) {
      if (token !== loadTokenRef.current) return
      setError(e.message || 'Could not load assessments.')
    } finally {
      if (token === loadTokenRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  const library = useMemo(() => items.filter((t) => t.is_public), [items])
  const mine = useMemo(() => items.filter((t) => !t.is_public), [items])

  function startCreate() {
    setForm({ ...EMPTY_FORM, position: position || 'frontend' })
    setSelected(null)
    setEditing(true)
    setSaveError(null)
  }

  function startEdit(t) {
    setForm(formFromTemplate(t))
    setSelected(t)
    setEditing(true)
    setSaveError(null)
  }

  async function clone(t) {
    setBusyId(t.id)
    setError(null)
    try {
      const res = await api.cloneAssessment(t.id)
      const created = res?.assessment || res?.template || res
      await load()
      if (created?.id) startEdit(created)
    } catch (e) {
      setError(e.message || 'Could not clone this template.')
    } finally {
      setBusyId(null)
    }
  }

  // Turn a template into a live candidate screen (a work_sample) and surface a
  // shareable candidate link. The candidate opens it pre-loaded in the IDE.
  async function publishAsScreen(t) {
    setBusyId(t.id)
    setError(null)
    try {
      // A screen is a CODE screen only when the template ships auto-grading test cases;
      // written/design templates become markdown screens. Mirrors the backend inference in
      // POST /assessments/:id/use. Hardcoding 'code' here put design docs into a Java IDE
      // with no tests (launch dress-rehearsal finding, 2026-07-10).
      const hasTestCases = !!(t.tests && Array.isArray(t.tests.cases) && t.tests.cases.length)
      const ws = await api.authorWorkSample({
        title: t.title,
        prompt_md: t.prompt_md,
        rubric: t.rubric,
        response_type: hasTestCases ? 'code' : 'markdown',
        role_family: POSITION_LABEL[t.position] || t.position,
        duration_minutes: t.time_limit_min || 45,
        starter_files: t.starter_files || [],
        languages: t.languages || [],
        tests: hasTestCases ? t.tests : null,
      })
      const id = ws?.id || ws?.work_sample?.id
      setSelected(null)
      setEditing(false)
      setPublished({ title: t.title, workSampleId: id })
      track('screen_created', { position: t.position })
    } catch (e) {
      setError(e.message || 'Could not create the screen.')
    } finally {
      setBusyId(null)
    }
  }

  async function save() {
    setSaveError(null)
    if (!form.title.trim() || !form.prompt_md.trim()) {
      setSaveError('Title and prompt are required.')
      return
    }
    let starter_files
    let rubric
    try {
      starter_files = JSON.parse(form.starter_files || '[]')
      if (!Array.isArray(starter_files)) throw new Error('starter_files must be a JSON array')
    } catch (e) {
      setSaveError(`Starter files JSON is invalid: ${e.message}`)
      return
    }
    try {
      rubric = JSON.parse(form.rubric || '{}')
      if (!rubric || !Array.isArray(rubric.criteria)) {
        throw new Error('rubric must be an object with a "criteria" array')
      }
    } catch (e) {
      setSaveError(`Rubric JSON is invalid: ${e.message}`)
      return
    }
    let tests = null
    if (form.tests && form.tests.trim()) {
      try {
        tests = JSON.parse(form.tests)
      } catch (e) {
        setSaveError(`Tests JSON is invalid: ${e.message}`)
        return
      }
    }

    const body = {
      position: form.position,
      title: form.title.trim(),
      summary: form.summary.trim() || null,
      prompt_md: form.prompt_md,
      languages: form.languages
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      time_limit_min: Number(form.time_limit_min) || null,
      starter_files,
      rubric,
      tests,
    }

    setSaving(true)
    try {
      if (selected && !selected.is_public) {
        await api.updateAssessment(selected.id, body)
      } else {
        await api.createAssessment(body)
      }
      setEditing(false)
      setSelected(null)
      await load()
    } catch (e) {
      setSaveError(e.message || 'Could not save the assessment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Assessments</h1>
          <p className="mt-1 max-w-xl text-sm text-stone-600">
            Real-work screens by position. Clone a library template to customize it, or write your
            own. Every template scores against an explainable, in-code rubric — and candidates may
            use AI (how they direct it is the signal).
          </p>
        </div>
        <button onClick={startCreate} className="btn-primary shrink-0">
          <Plus size={16} /> New assessment
        </button>
      </div>

      {/* Position filter */}
      <div className="mt-6 flex flex-wrap gap-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPosition(p.value)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              position === p.value
                ? 'bg-clay-600 text-white'
                : 'border border-stone-200 bg-white text-stone-600 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-5 rounded-lg bg-flag-50 px-3 py-2 text-sm text-flag-700 ring-1 ring-flag-100">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-stone-200/50" />
          ))}
        </div>
      ) : !error && mine.length === 0 && library.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400">
            <FileText size={22} />
          </span>
          <p className="mt-4 font-medium text-ink">
            {position ? 'No templates for this position yet' : 'No assessments yet'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            {position
              ? 'Try another position, or write your own real-work screen for this role.'
              : 'Write your own real-work screen — a messy, realistic task scored against an in-code rubric.'}
          </p>
          <button onClick={startCreate} className="btn-primary mt-5 inline-flex">
            <Plus size={16} /> New assessment
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {mine.length > 0 && (
            <Section title="Your templates" count={mine.length}>
              {mine.map((t) => (
                <TemplateCard
                  key={t.id}
                  t={t}
                  busy={busyId === t.id}
                  onView={() => setSelected(t)}
                  onEdit={() => startEdit(t)}
                />
              ))}
            </Section>
          )}
          <Section title="Library" count={library.length}>
            {library.map((t) => (
              <TemplateCard
                key={t.id}
                t={t}
                busy={busyId === t.id}
                onView={() => setSelected(t)}
                onClone={() => clone(t)}
              />
            ))}
            {library.length === 0 && (
              <p className="text-sm text-stone-500">No templates for this position yet.</p>
            )}
          </Section>
        </div>
      )}

      {/* View drawer */}
      {selected && !editing && (
        <Drawer onClose={() => setSelected(null)}>
          <TemplateDetail
            t={selected}
            onClone={selected.is_public ? () => clone(selected) : undefined}
            onEdit={!selected.is_public ? () => startEdit(selected) : undefined}
            onUse={() => publishAsScreen(selected)}
            busy={busyId === selected.id}
          />
        </Drawer>
      )}

      {/* Create / edit form */}
      {editing && (
        <Drawer onClose={() => setEditing(false)}>
          <EditForm
            form={form}
            setForm={setForm}
            isEdit={Boolean(selected && !selected.is_public)}
            saving={saving}
            error={saveError}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        </Drawer>
      )}

      {/* Published screen — shareable candidate link */}
      {published && (
        <Drawer onClose={() => setPublished(null)}>
          <PublishedScreen published={published} onClose={() => setPublished(null)} />
        </Drawer>
      )}
    </div>
  )
}

function PublishedScreen({ published, onClose }) {
  const link =
    typeof window !== 'undefined' && published.workSampleId
      ? `${window.location.origin}/candidate?ws=${published.workSampleId}`
      : ''
  const [copied, setCopied] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState('idle') // idle | sending | error
  // Everyone invited from this drawer, as [{ email, emailSent, link }], so the
  // recruiter keeps a persistent "Sent to" list while sending more.
  const [sentInvites, setSentInvites] = useState([])
  async function invite() {
    const email = inviteEmail.trim()
    if (!email || !published.workSampleId) return
    setInviteStatus('sending')
    try {
      const res = await api.inviteCandidate(published.workSampleId, email)
      track('candidate_invited')
      setSentInvites((list) => [
        ...list,
        { email, emailSent: Boolean(res?.email_sent), link: res?.link || link },
      ])
      setInviteEmail('')
      setInviteStatus('idle')
    } catch {
      setInviteStatus('error')
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the field is selectable as a fallback */
    }
  }
  return (
    <div>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200">
        <Check size={24} />
      </span>
      <h2 className="mt-4 font-serif text-2xl font-semibold text-ink">Screen is live</h2>
      <p className="mt-2 text-sm text-stone-600">
        "{published.title}" is ready. Share this link with a candidate — it opens pre-loaded in the
        in-browser editor with the AI assistant, and you'll be emailed the moment they submit.
      </p>
      <div className="mt-5">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
          Candidate link
        </span>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            className="w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 font-mono text-xs text-ink outline-none"
          />
          <button onClick={copy} className="btn-primary shrink-0 text-sm">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="mt-5">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
          Or invite by email
        </span>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="candidate@email.com"
            className="w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
          />
          <button onClick={invite} disabled={inviteStatus === 'sending'} className="btn-quiet shrink-0 text-sm">
            {inviteStatus === 'sending' ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        {inviteStatus === 'error' && (
          <p className="mt-1.5 text-xs text-flag-700">Couldn't send — check the email and try again.</p>
        )}
        <InviteSentList invites={sentInvites} />
      </div>

      <div className="mt-5 flex items-center gap-2">
        <a href={link} target="_blank" rel="noreferrer" className="btn-quiet">
          Preview as candidate <ArrowRight size={16} />
        </a>
        <button onClick={onClose} className="btn-quiet">
          Done
        </button>
      </div>
    </div>
  )
}

function Section({ title, count, children }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{title}</h2>
        <span className="text-xs text-stone-400">{count}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function TemplateCard({ t, onView, onClone, onEdit, busy }) {
  return (
    <div className="card flex h-full flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <Pill tone="clay">{POSITION_LABEL[t.position] || t.position}</Pill>
        {t.time_limit_min && (
          <span className="text-xs text-stone-400">~{t.time_limit_min} min</span>
        )}
      </div>
      <h3 className="mt-3 font-serif text-lg font-semibold leading-snug text-ink">{t.title}</h3>
      {t.summary && <p className="mt-1.5 line-clamp-2 text-sm text-stone-600">{t.summary}</p>}
      {Array.isArray(t.languages) && t.languages.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.languages.slice(0, 4).map((l) => (
            <span
              key={l}
              className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
            >
              <Code size={11} /> {l}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 pt-4">
        <button onClick={onView} className="btn-quiet text-sm">
          View
        </button>
        {onClone && (
          <button onClick={onClone} disabled={busy} className="btn-primary text-sm">
            {busy ? 'Cloning…' : 'Clone & edit'}
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} className="btn-primary text-sm">
            Edit
          </button>
        )}
      </div>
    </div>
  )
}

function TemplateDetail({ t, onClone, onEdit, onUse, busy }) {
  const criteria = t.rubric?.criteria || []
  return (
    <div>
      <div className="flex items-center gap-2">
        <Pill tone="clay">{POSITION_LABEL[t.position] || t.position}</Pill>
        {t.is_public ? (
          <Pill tone="neutral">Library</Pill>
        ) : (
          <Pill tone="neutral">Yours</Pill>
        )}
      </div>
      <h2 className="mt-3 font-serif text-2xl font-semibold leading-tight text-ink">{t.title}</h2>
      {t.summary && <p className="mt-2 text-sm text-stone-600">{t.summary}</p>}

      <div className="mt-5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          The brief
        </span>
        <Markdown className="mt-2" source={t.prompt_md} />
      </div>

      {Array.isArray(t.starter_files) && t.starter_files.length > 0 && (
        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Starter files
          </span>
          <ul className="mt-2 space-y-1">
            {t.starter_files.map((f) => (
              <li key={f.path} className="inline-flex items-center gap-2 text-sm text-stone-700">
                <FileText size={14} className="text-stone-400" /> <span className="font-mono">{f.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {criteria.length > 0 && (
        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Rubric — scored in code
          </span>
          <ul className="mt-2 space-y-2">
            {criteria.map((c, i) => (
              <li key={c.id || i} className="flex items-start justify-between gap-3 text-sm">
                <span className="flex items-start gap-2 text-stone-700">
                  <Check size={15} className="mt-0.5 shrink-0 text-clay-500" />
                  {c.requirement || c.id}
                </span>
                <span
                  className={`shrink-0 tabular-nums ${
                    (c.weight ?? 1) < 0 ? 'text-flag-700' : 'text-stone-500'
                  }`}
                >
                  {(c.weight ?? 1) < 0 ? '−' : ''}
                  {c.points_possible} pts
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {onUse && (
          <button onClick={onUse} disabled={busy} className="btn-primary">
            {busy ? 'Creating…' : 'Use as a screen'} <ArrowRight size={16} />
          </button>
        )}
        {onClone && (
          <button onClick={onClone} disabled={busy} className="btn-quiet">
            Clone &amp; customize
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} className="btn-quiet">
            Edit
          </button>
        )}
      </div>
    </div>
  )
}

function EditForm({ form, setForm, isEdit, saving, error, onSave, onCancel }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const input =
    'mt-1 w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100'
  const label = 'text-xs font-semibold uppercase tracking-[0.12em] text-stone-400'
  return (
    <div>
      <h2 className="font-serif text-2xl font-semibold text-ink">
        {isEdit ? 'Edit assessment' : 'New assessment'}
      </h2>
      <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-stone-500">
        <Sparkle size={14} className="text-clay-500" /> Saved as your own private template.
      </p>

      <div className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <span className={label}>Title</span>
            <input value={form.title} onChange={set('title')} className={input} placeholder="e.g. Fix a flaky React data-table" />
          </div>
          <div>
            <span className={label}>Position</span>
            <select value={form.position} onChange={set('position')} className={input}>
              {POSITIONS.filter((p) => p.value).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className={label}>Summary</span>
          <input value={form.summary} onChange={set('summary')} className={input} placeholder="One line shown on the card" />
        </div>

        <div>
          <span className={label}>The brief (prompt)</span>
          <textarea
            value={form.prompt_md}
            onChange={set('prompt_md')}
            rows={6}
            className={`${input} font-normal`}
            placeholder="Describe the real task. AI is allowed — what matters is how the candidate directs it and catches its mistakes."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={label}>Languages (comma-separated)</span>
            <input value={form.languages} onChange={set('languages')} className={input} placeholder="javascript, jsx" />
          </div>
          <div>
            <span className={label}>Time limit (min)</span>
            <input type="number" value={form.time_limit_min} onChange={set('time_limit_min')} className={input} />
          </div>
        </div>

        <div>
          <span className={label}>Starter files (JSON: [{'{ path, content, language }'}])</span>
          <textarea value={form.starter_files} onChange={set('starter_files')} rows={5} className={`${input} font-mono text-xs`} />
        </div>

        <div>
          <span className={label}>Rubric (JSON: {'{ criteria: [{ id, requirement, points_possible, weight }] }'})</span>
          <textarea value={form.rubric} onChange={set('rubric')} rows={6} className={`${input} font-mono text-xs`} />
          <p className="mt-1 text-xs text-stone-400">
            Positive criteria should sum to 100. Use a negative weight for penalties (e.g. unverified
            AI output). The score is computed in code from these points.
          </p>
        </div>

        <div>
          <span className={label}>
            Hidden tests (optional JSON: {'{ command, files: [{ path, content }] }'})
          </span>
          <textarea
            value={form.tests}
            onChange={set('tests')}
            rows={5}
            className={`${input} font-mono text-xs`}
            placeholder='{ "command": "node test.js", "files": [{ "path": "test.js", "content": "…" }] }'
          />
          <p className="mt-1 text-xs text-stone-400">
            If set, the candidate's code runs against these tests in an isolated sandbox — objective
            pass/fail in the review. Exit code 0 = pass.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-flag-50 px-3 py-2 text-sm text-flag-700 ring-1 ring-flag-100">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-2">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create assessment'}
        </button>
        <button onClick={onCancel} className="btn-quiet">
          Cancel
        </button>
      </div>
    </div>
  )
}

// Lightweight right-side drawer for view + edit.
function Drawer({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-stone-200 bg-paper p-6 shadow-2xl sm:p-8">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  )
}
