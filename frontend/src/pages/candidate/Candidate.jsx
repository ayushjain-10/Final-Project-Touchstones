import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { Pill } from '../../components/primitives.jsx'
import AiAssistPanel from '../../components/AiAssistPanel.jsx'
import AiEditReview from '../../components/AiEditReview.jsx'
import Markdown from '../../components/Markdown.jsx'
// CodeMirror is heavy (~400 kB) — lazy-load it so the marketing/waitlist bundle
// stays lean and it's only fetched when a candidate actually opens a code task.
const CodeEditor = lazy(() => import('../../components/CodeEditor.jsx'))
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import { track } from '../../services/analytics.js'
import { useBehavioralSignals } from '../../hooks/useBehavioralSignals.js'
import { useActivityTracker } from '../../hooks/useActivityTracker.js'
import {
  Clock,
  Code,
  Check,
  ArrowRight,
  FileText,
  Sparkle,
  ShieldCheck,
  Lock,
  Play,
  RotateCcw,
  Camera,
  Mic,
} from '../../components/icons.jsx'
import EditorThemeMenu from '../../components/EditorThemeMenu.jsx'
import { coverageReport as buildCoverageReport, COVERAGE_LABEL } from '../../lib/deliverablesCoverage.js'
import LanguagePicker from '../../components/LanguagePicker.jsx'
import TestCaseResults from '../../components/TestCaseResults.jsx'
import {
  DEFAULT_EDITOR_THEME,
  EDITOR_THEME_STORAGE_KEY,
  isEditorThemeDark,
  normalizeEditorTheme,
} from '../../lib/editorThemes.js'
import {
  LANGUAGE_STORAGE_KEY,
  languageByKey,
  languageKeyFromHint,
  resolveLanguageOptions,
} from '../../lib/languages.js'
import { loadDrafts, saveDrafts, clearDrafts } from '../../lib/draftStore.js'
import { useMediaQuery } from '../../hooks/useMediaQuery.js'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import VerifiedSession from './VerifiedSession.jsx'

// Optional verified-session layer (ADR-001 Phase 2). OFF by default; when this build-time flag is
// unset the post-submit offer never renders and the candidate flow is byte-identical to today.
const VERIFIED_SESSION_ENABLED = import.meta.env.VITE_ENABLE_VERIFIED_SESSION === 'true'

// Cursor-style review of AI edits (diff + accept/deny before anything touches the editor).
// OFF by default per the flag idiom; when unset the panel keeps today's instant Apply button.
const AI_EDIT_REVIEW_ENABLED = import.meta.env.VITE_AI_EDIT_REVIEW === 'true'

// Draggable divider between IDE panes (LeetCode-style). Thin hairline that thickens with an
// accent on hover/drag; col-resize between side-by-side panes, row-resize between stacked ones.
function IdeResizeHandle({ direction }) {
  const horizontal = direction === 'horizontal'
  return (
    <PanelResizeHandle
      className={`group relative flex shrink-0 items-center justify-center bg-stone-200/70 transition-colors hover:bg-clay-400/70 data-[resize-handle-state=drag]:bg-clay-500 dark:bg-[#25304D] dark:hover:bg-clay-500/50 ${
        horizontal ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
      }`}
    >
      <span
        className={`pointer-events-none rounded-full bg-stone-400/80 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-[#53607F] ${
          horizontal ? 'h-7 w-0.5' : 'h-0.5 w-7'
        }`}
      />
    </PanelResizeHandle>
  )
}

// Demo fallback so the route never crashes when opened without a real id. Only
// used when no ?ws / ?submission is present — i.e. someone previewing /candidate.
const fallbackTask = {
  title: 'Fix a double-charging payments service',
  prompt_md:
    'Our payments service intermittently double-charges customers when a request is retried. Below is a stripped-down version of the failing code. Reproduce the issue, fix the root cause, and add tests. Work the way you would on the job.',
  duration_minutes: 30,
  role_family: 'Senior Backend Engineer',
  response_type: 'code',
  ai_allowed: true,
}

const codeStarter = `// payments/retry.js: intermittently double-charges on retry
async function charge(order, idempotencyKey) {
  // TODO: make this safe under retries
  const res = await gateway.charge(order.amount, order.card)
  await db.markPaid(order.id, res.id)
  return res
}
`

// Default single-file model for code tasks that don't ship starter files.
function defaultCodeFiles(isDemo) {
  return [{ path: 'solution.js', content: isDemo ? codeStarter : '', language: 'javascript' }]
}

// Serialize the editor's files into one response_code string for scoring +
// recruiter review. One file → just its content; multiple → readable headers.
// keepPath: multi-language screens keep the header even for a single file — the backend's
// single-file fallback assumes starter_files[0].path, which would mislabel (and mis-grade)
// a candidate who solved in the screen's OTHER language.
function serializeFiles(files, keepPath = false) {
  if (!files || files.length === 0) return ''
  if (files.length === 1 && !keepPath) return files[0].content || ''
  return files.map((f) => `/* ===== ${f.path} ===== */\n${f.content || ''}`).join('\n\n')
}

// Per-language starter variants: when a screen declares multiple languages and ships exactly one
// starter file per language, the workspace shows only the selected language's starter and swaps
// between them on language change. Returns { langKey: starterFile } or null when the starters
// aren't 1:1 distinct language variants (multi-file authored projects keep their full stack).
function starterVariants(task) {
  const starters = Array.isArray(task?.starter_files) ? task.starter_files : []
  if (starters.length < 2) return null
  const map = {}
  for (const f of starters) {
    const key =
      languageKeyFromHint(f.language) ||
      languageKeyFromHint(String(f.path || '').split('.').pop() || '')
    if (!key || map[key]) return null
    map[key] = f
  }
  return map
}

// Elapsed timer (counts up). Used as a gentle "time on task" cue.
function useElapsed() {
  const [s, setS] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setS((v) => v + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return s
}

function fmtClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const mm = String(Math.floor(safe / 60)).padStart(2, '0')
  const ss = String(safe % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// Live countdown to a deadline_at ISO timestamp. Returns remaining ms (>= 0),
// or null when there is no deadline. Ticks once a second.
function useRemaining(deadlineAt) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadlineAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadlineAt])
  if (!deadlineAt) return null
  const end = new Date(deadlineAt).getTime()
  if (Number.isNaN(end)) return null
  return Math.max(0, end - now)
}

export default function Candidate() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const wsId = params.get('ws')
  const subParam = params.get('submission') || params.get('sub')
  const { user, configured, loading: authLoading } = useAuth()
  // Where to send the candidate back after they sign in / create an account (e.g. /candidate?ws=…).
  const returnTo = location.pathname + location.search

  const elapsedS = useElapsed()
  // Desktop gets the draggable pane group. Below lg, a compact tab workspace keeps
  // the prompt, work, console, and allowed AI tools within one viewport.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [mobilePane, setMobilePane] = useState('problem')
  const [response, setResponse] = useState('')
  const [files, setFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [responseTouched, setResponseTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Editor theme preset (Touchstones + the popular published themes). Persisted; chosen from the
  // top-bar dropdown. Engineers default to dark; whether the preset is dark drives the IDE chrome.
  const [editorTheme, setEditorTheme] = useState(() => {
    try {
      return normalizeEditorTheme(
        localStorage.getItem(EDITOR_THEME_STORAGE_KEY) || localStorage.getItem('ts_ide_theme'),
      )
    } catch {
      return DEFAULT_EDITOR_THEME
    }
  })
  const changeEditorTheme = (key) => {
    setEditorTheme(key)
    try {
      localStorage.setItem(EDITOR_THEME_STORAGE_KEY, key)
    } catch {
      /* ignore */
    }
  }

  const [loading, setLoading] = useState(Boolean(wsId || subParam))
  const [loadError, setLoadError] = useState(null)
  const [workSample, setWorkSample] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [submissionId, setSubmissionId] = useState(subParam || null)
  const [retryNonce, setRetryNonce] = useState(0)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Start gate: the deliberate "Start assessment" click that stamps started_at + deadline.
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  // Decline (pre-start only): a quiet opt-out under the gate's primary actions. Clicking
  // reveals an inline confirm with an optional reason; the server 409s once started.
  const [declineOpen, setDeclineOpen] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const [declineError, setDeclineError] = useState(null)

  // Deliverables self-check (TOU-146): the checked item indexes. Persisted with the draft so
  // ticked boxes survive a reload; stamped into submission metadata at submit. A soft confirm
  // lists any unchecked items before a manual submit; it NEVER blocks submitting.
  const [deliverablesCheck, setDeliverablesCheck] = useState([])
  const [submitConfirm, setSubmitConfirm] = useState(null) // { unchecked: string[] } | null

  // Camera + mic requirement (TOU-147): presence signal only. The granted stream lives in a
  // ref and is NEVER attached to a recorder, canvas, media element, or network path; every
  // track is stopped on submit and unmount. Track on/off transitions become debounced
  // client-attested integrity events (review flags for humans, never pass/fail).
  const [avGranted, setAvGranted] = useState(false)
  const [avRequesting, setAvRequesting] = useState(false)
  const [avError, setAvError] = useState(null)
  const avStreamRef = useRef(null)
  const avLastSent = useRef({})

  // Candidate "Run": execute the CURRENT editor code against the screen's hidden
  // tests (command is server-side; only files are sent). Pre-submit feedback.
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [runError, setRunError] = useState(null)
  // Optional custom stdin a candidate can feed the program when they Run (no-hidden-tests screens).
  const [customInput, setCustomInput] = useState('')
  const [showInput, setShowInput] = useState(false)

  const signals = useBehavioralSignals()
  const activity = useActivityTracker()
  const flushTimer = useRef(null)

  const isDemo = !wsId && !subParam
  const task = workSample || (isDemo ? fallbackTask : null)
  const aiAllowed = task?.ai_allowed ?? task?.rubric?.ai_allowed ?? true
  const responseType = task?.response_type || 'markdown'
  const isCode = responseType === 'code'
  // Scope for persisting drafts to localStorage (never lose work on reload). Canonical key: the
  // WORK SAMPLE id, which is the same whether the page was opened via ?ws or ?submission and
  // never changes mid-session. (The old submissionId-first key stranded ?ws drafts: restore ran
  // under ws:<id> before the eager self-assign resolved, then saves switched to the submission
  // uuid.) Demo previews aren't persisted (null scope).
  const scopeId = workSample?.id ? `ws:${workSample.id}` : wsId ? `ws:${wsId}` : null
  // Screen-level AV requirement (112). Demo previews never require AV.
  const avRequired = !isDemo && task?.av_required === true
  const deliverables = Array.isArray(task?.deliverables) ? task.deliverables : []

  useEffect(() => {
    if (isDesktop) return
    if (mobilePane === 'ai' && !aiAllowed) setMobilePane('work')
  }, [aiAllowed, isDesktop, mobilePane])

  // Drive a global `.dark` class from the chosen editor theme so the surrounding layout chrome
  // darkens with it. Owner directive 2026-07-14: EVERY assessment type gets the same workspace,
  // so written screens honour the theme picker too rather than being pinned to the light theme.
  useEffect(() => {
    const on = isEditorThemeDark(editorTheme)
    document.documentElement.classList.toggle('dark', on)
    return () => document.documentElement.classList.remove('dark')
  }, [editorTheme])

  // Per-language editor buffers, kept for the session so switching language and back restores the
  // candidate's work instead of clobbering it with a fresh starter (LeetCode keeps your code too).
  const langBuffers = useRef({})
  // Draft autosave plumbing: a live ref to the files (so the debounced writer reads the latest),
  // the debounce timer, and a "saved" flag that drives the header indicator.
  const filesRef = useRef([])
  filesRef.current = files
  // Live ref of the free-text answer so the debounced writer captures the latest keystrokes too.
  const responseRef = useRef('')
  responseRef.current = response
  // Live ref of the deliverables self-check so the debounced writer persists the latest ticks.
  const checksRef = useRef([])
  checksRef.current = deliverablesCheck
  const draftTimer = useRef(null)
  const [draftSaved, setDraftSaved] = useState(true)

  // Initialize the code editor's files for code tasks: a saved draft (never lose work on reload)
  // takes precedence; else the task's starter files when provided; else, for a single-file task, the
  // chosen/default language's starter stub (demo keeps its bespoke payments starter). Runs once.
  const filesInit = useRef(false)
  useEffect(() => {
    if (!isCode || filesInit.current) return
    if (!task && !isDemo) return
    // (0) Restore a saved draft first — a refresh/crash must never lose in-progress code.
    if (!isDemo && scopeId) {
      // Fall back to the legacy submission-keyed draft so work saved before the key change
      // (canonical ws:<id> scope) isn't orphaned. loadDrafts(null) is a safe no-op.
      const draft = loadDrafts(scopeId) || loadDrafts(submissionId)
      if (draft && Array.isArray(draft.files) && draft.files.length) {
        setFiles(draft.files)
        setActiveFile(draft.files[0]?.path || null)
        if (draft.buffers && typeof draft.buffers === 'object') {
          langBuffers.current = { ...draft.buffers }
        }
        filesInit.current = true
        return
      }
    }
    let starter
    if (Array.isArray(task?.starter_files) && task.starter_files.length) {
      starter = task.starter_files.map((f) => ({
        path: f.path,
        content: f.content || '',
        language: f.language,
      }))
      // Per-language starter variants: show ONLY the preferred language's starter (persisted
      // choice when it's offered here, else the first offered language with a variant).
      const variants = starterVariants(task)
      if (variants) {
        const opts = resolveLanguageOptions(task?.languages)
        let key = null
        try {
          key = languageKeyFromHint(localStorage.getItem(LANGUAGE_STORAGE_KEY))
        } catch {
          /* ignore */
        }
        if (!(key && variants[key] && opts.some((o) => o.key === key))) {
          key = opts.find((o) => variants[o.key])?.key || Object.keys(variants)[0]
        }
        const f = variants[key]
        starter = [{ path: f.path, content: f.content || '', language: f.language }]
      }
    } else if (isDemo) {
      starter = defaultCodeFiles(true)
    } else {
      // No authored starter files → seed a stub in the preferred language (persisted choice if it's
      // an option for this screen, else the first supported language).
      const opts = resolveLanguageOptions(task?.languages)
      let initialKey = null
      try {
        initialKey = languageKeyFromHint(localStorage.getItem(LANGUAGE_STORAGE_KEY))
      } catch {
        /* ignore */
      }
      if (!opts.some((o) => o.key === initialKey)) initialKey = opts[0]?.key || 'python'
      const lang = languageByKey(initialKey) || languageByKey('python')
      starter = [{ path: lang.filename, content: lang.starter, language: lang.language }]
    }
    setFiles(starter)
    setActiveFile(starter[0]?.path || null)
    filesInit.current = true
  }, [isCode, task, isDemo, scopeId])

  // Restore a saved free-text draft for markdown answers, mirroring the code path above: the
  // written response autosaves (same debounce) and survives a refresh or crash. Runs once.
  const textInit = useRef(false)
  useEffect(() => {
    if (isCode || textInit.current) return
    if (!task || isDemo || !scopeId) return
    const draft = loadDrafts(scopeId) || loadDrafts(submissionId)
    if (draft && typeof draft.text === 'string' && draft.text) setResponse(draft.text)
    textInit.current = true
  }, [isCode, task, isDemo, scopeId, submissionId])

  // Restore the deliverables self-check state (TOU-146), same never-lose-progress guarantee as
  // the code/text drafts above. Indexes outside the current checklist are dropped. Runs once.
  const checksInit = useRef(false)
  useEffect(() => {
    if (checksInit.current) return
    if (!task || isDemo || !scopeId) return
    if (deliverables.length) {
      const draft = loadDrafts(scopeId) || loadDrafts(submissionId)
      if (draft && Array.isArray(draft.checks) && draft.checks.length) {
        setDeliverablesCheck(
          draft.checks.filter((i) => Number.isInteger(i) && i >= 0 && i < deliverables.length),
        )
      }
    }
    checksInit.current = true
  }, [task, isDemo, scopeId, submissionId, deliverables])

  // Load the assigned task (by submission id) or the work-sample preview (by ws id).
  useEffect(() => {
    let active = true
    async function load() {
      if (!wsId && !subParam) return
      // Authed screens require a session. Wait for auth to resolve, and never fire the (authed)
      // request for a logged-out visitor — the StartGate below prompts them to sign in first. This
      // also removes the old race where the load fired before the saved session restored and 401'd
      // with "No authorization token" (which made "Try again" look like it bypassed login).
      if (authLoading) return // wait for the session to resolve — skeleton stays up
      if (!user) {
        // Logged out: don't fire an authed request; clear the initial loading state so the sign-in
        // gate renders instead of a stuck "Loading your screen…" skeleton.
        if (active) setLoading(false)
        return
      }
      setLoading(true)
      setLoadError(null)
      try {
        if (subParam) {
          const { submission: sub, work_sample } = await api.getSubmission(subParam)
          if (!active) return
          setWorkSample(work_sample)
          setSubmission(sub)
          setSubmissionId(sub.id)
          // A returning candidate may already have submitted — show the receipt
          // (backend submission status: assigned → submitted → scored).
          if (sub.status === 'submitted' || sub.status === 'scored') {
            setSubmitted(true)
          }
        } else if (wsId) {
          const ws = await api.getWorkSample(wsId)
          if (!active) return
          // Keep the eager self-assign (idempotent server-side) so the assignment exists the
          // moment the invite link is opened. Assigning no longer stamps a deadline, so nothing
          // starts here: a ?ws deep link lands on the dashboard, where the start gate makes
          // beginning the timed screen a deliberate act. A failed assign falls through to the
          // load-error state with its Try again, since the workspace is no longer a destination.
          await api.assignWorkSample(ws.id, user.id)
          if (!active) return
          navigate('/candidate/home', { replace: true })
          return
        }
      } catch (e) {
        if (active) setLoadError(e.message || 'Could not load this screen.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [wsId, subParam, retryNonce, authLoading, user])

  // Periodically flush queued behavioral signals to the integrity endpoint once
  // we have a submission. Display-only attestations; the server attributes trust.
  useEffect(() => {
    if (!submissionId || !configured || !user) return
    flushTimer.current = setInterval(async () => {
      const events = signals.collectAndReset()
      if (!events.length) return
      try {
        await api.sendIntegrityEvents(submissionId, events)
      } catch {
        // Non-blocking: re-queueing isn't worth complicating the candidate flow.
      }
    }, 5000)
    return () => clearInterval(flushTimer.current)
  }, [submissionId, configured, user, signals])

  // --- Camera + mic presence (TOU-147) ---------------------------------------------------
  // Debounced AV signal: at most one event per type per 10s, so a flapping device can never
  // flood the integrity chain. Events ride the existing client-attested queue + 5s flush.
  const AV_EVENT_DEBOUNCE_MS = 10000
  function recordAvSignal(type) {
    const nowTs = Date.now()
    if (nowTs - (avLastSent.current[type] || 0) < AV_EVENT_DEBOUNCE_MS) return
    avLastSent.current[type] = nowTs
    signals.record(type)
  }

  // Hold the granted stream as a presence signal ONLY, and translate track transitions into
  // review flags: camera/mic mute toggles and a full revocation (track ended). The stream is
  // never attached to a recorder, canvas, media element, or network path.
  function adoptAvStream(stream) {
    avStreamRef.current = stream
    for (const trk of stream.getTracks()) {
      const video = trk.kind === 'video'
      trk.addEventListener('mute', () => recordAvSignal(video ? 'av_camera_off' : 'av_mic_muted'))
      trk.addEventListener('unmute', () => recordAvSignal(video ? 'av_camera_on' : 'av_mic_unmuted'))
      trk.addEventListener('ended', () => {
        recordAvSignal('av_revoked')
        setAvGranted(false)
      })
    }
    setAvGranted(true)
  }

  function releaseAvStream() {
    const s = avStreamRef.current
    avStreamRef.current = null
    if (s) {
      try {
        s.getTracks().forEach((t) => t.stop())
      } catch {
        /* already stopped */
      }
    }
    setAvGranted(false)
  }

  // The gate's "Enable camera and microphone" button. Denial is a respected choice: we explain
  // it plainly and Start stays locked; the decline affordance below the gate remains available.
  async function handleEnableAv() {
    setAvError(null)
    setAvRequesting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      adoptAvStream(stream)
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')
      setAvError(
        denied
          ? 'Camera and microphone access was blocked, so this screen stays locked. That is your choice to make: allow access in your browser to continue, or decline the assessment below. Nothing is ever recorded either way.'
          : 'Could not access a camera and microphone. Check that a device is connected and not in use by another app, then try again.',
      )
    } finally {
      setAvRequesting(false)
    }
  }

  // Reload mid-session: the previous stream is gone, so quietly re-acquire (the browser
  // remembers the grant). A failure is recorded as av_revoked, a review flag, nothing more.
  useEffect(() => {
    if (!avRequired || submitted || avStreamRef.current) return
    if (!submission?.started_at || submission.status !== 'in_progress') return
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        adoptAvStream(stream)
      })
      .catch(() => {
        if (!cancelled) recordAvSignal('av_revoked')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avRequired, submitted, submission?.started_at, submission?.status])

  // Always release every track when the candidate leaves the page.
  useEffect(() => releaseAvStream, [])

  const remainingMs = useRemaining(submission?.deadline_at)

  // Deadline UX: staged warnings while time runs low, then an auto-submit of whatever is in the
  // editor at zero. The server accepts a short grace window past the deadline (flagged as
  // late_submission for human review), so the zero-second submit still lands.
  const [timeWarning, setTimeWarning] = useState(null)
  const timeWarnedRef = useRef({})
  const autoSubmitRef = useRef(false)

  const checklist = useMemo(() => {
    // Generic, role-agnostic guidance — applies to any work sample. The task
    // prompt itself carries the specifics.
    return [
      'Read the prompt closely, then plan before you build',
      'Solve the real problem, not just the happy path',
      'Show your reasoning; leave the work in a reviewable state',
      aiAllowed
        ? 'Use the available AI assistant deliberately, then verify its output'
        : 'Complete the task independently without AI assistance',
    ]
  }, [aiAllowed])

  const codeResponse = useMemo(
    () => serializeFiles(files, resolveLanguageOptions(task?.languages).length > 1),
    [files, task],
  )
  const effectiveResponse = isCode ? codeResponse : response

  // --- AI assistant ↔ editor bridge: let the AI READ the current code and APPLY a suggested edit
  // (the candidate accepts / modifies / denies). For single-file code tasks the active file is the
  // solution file; for a written task it's the response text.
  const getAiCode = () => (isCode ? (files[0]?.content ?? codeResponse) : response)
  const getAiLanguage = () => (isCode ? currentLangKey || files[0]?.language || '' : 'markdown')
  // Best-effort record of what the candidate DID with a suggestion (accepted/rejected) on the
  // assistant turn — a direction-quality hint in the replay; the flow never blocks on it.
  const recordAiDisposition = (seq, disposition) => {
    if (!submissionId || !seq || isDemo) return
    api.setAiDisposition(submissionId, seq, disposition).catch(() => {})
  }
  const applyAiCode = (code, seq) => {
    if (typeof code !== 'string') return
    if (isCode) {
      setFiles((prev) => (prev.length ? prev.map((f, i) => (i === 0 ? { ...f, content: code } : f)) : prev))
      // Editor onChange doesn't fire for programmatic applies — persist the accepted edit
      // ourselves or a refresh silently drops it (while the server already recorded 'accepted').
      scheduleDraftSave()
    } else {
      setResponse(code)
      scheduleDraftSave()
    }
    setResponseTouched(true)
    recordAiDisposition(seq, 'accepted')
  }
  // Cursor-style review (flag: VITE_AI_EDIT_REVIEW): a pending suggestion parks here and the
  // editor pane shows the diff until the candidate accepts or rejects it.
  const [aiReview, setAiReview] = useState(null) // { code, seq } | null
  const openAiReview = (code, seq) => setAiReview({ code, seq })
  const acceptAiReview = () => {
    if (!aiReview) return
    applyAiCode(aiReview.code, aiReview.seq)
    setAiReview(null)
  }
  const rejectAiReview = () => {
    if (!aiReview) return
    recordAiDisposition(aiReview.seq, 'rejected')
    setAiReview(null)
  }

  // --- Language picker (single-file code tasks) ---------------------------------------------
  // The candidate picks which language to solve in; options come from the screen's declared
  // `languages` (else a standard default set). Only single-file tasks get a picker — a multi-file
  // authored project is fixed to its stack. Language is modeled per-file, so the current language
  // is derived from the lone solution file; switching it swaps that file (path + stub + highlight).
  // Candidates pick their language on single-file code screens. A declared set — including a
  // single language — is the recruiter's deliberate restriction and is honored exactly: screens
  // with per-case hidden tests are graded by a language-specific harness, so offering other
  // languages would fail every hidden case. Only when the screen declares nothing do we offer the
  // full supported set (LeetCode-style).
  const languageOptions = useMemo(() => resolveLanguageOptions(task?.languages), [task])
  const solutionFile = isCode && files.length === 1 ? files[0] : null
  const currentLangKey = solutionFile
    ? languageKeyFromHint(solutionFile.language) ||
      languageKeyFromHint(solutionFile.path.split('.').pop() || '')
    : null
  const showLanguagePicker = isCode && files.length === 1 && languageOptions.length > 1

  // --- Draft autosave (never lose progress) -------------------------------------------------
  // Persist the full per-language buffer map + on-screen files to localStorage, debounced. The
  // debounced writer reads filesRef so it always captures the latest content.
  function persistDraftNow() {
    if (!scopeId) return
    const f = filesRef.current || []
    const buffers = { ...langBuffers.current }
    let activeLang = null
    if (f.length === 1) {
      const k =
        languageKeyFromHint(f[0].language) || languageKeyFromHint(f[0].path.split('.').pop() || '')
      if (k) {
        buffers[k] = f[0].content
        activeLang = k
      }
    }
    saveDrafts(scopeId, { files: f, buffers, activeLang, text: responseRef.current, checks: checksRef.current })
    setDraftSaved(true)
  }

  // Tick / untick a deliverables item; the self-check rides the same debounced draft save.
  function toggleDeliverable(i) {
    setDeliverablesCheck((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
    scheduleDraftSave()
  }

  function scheduleDraftSave() {
    if (!scopeId) return
    setDraftSaved(false)
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(persistDraftNow, 700)
  }

  function changeLanguage(key) {
    const lang = languageByKey(key)
    if (!lang || key === currentLangKey) return // no-op when re-selecting the active language
    // Screens that ship a starter per language seed the switch with THEIR starter (correct
    // filename + task-specific stub), not the generic language template.
    const variant = starterVariants(task)?.[key] || null
    const nextPath = variant?.path || lang.filename
    setFiles((prev) => {
      if (prev.length > 1) return prev // multi-file authored screens keep their stack
      const cur = prev[0] || null
      const curKey = cur
        ? languageKeyFromHint(cur.language) || languageKeyFromHint(cur.path.split('.').pop() || '')
        : null
      // Stash the current buffer so switching back this session restores the candidate's work.
      if (cur && curKey) langBuffers.current[curKey] = cur.content
      // Presence (not truthiness) marks "edited this session" — so a deliberately-emptied buffer is
      // restored as empty rather than re-seeded with the starter stub.
      const content =
        key in langBuffers.current
          ? langBuffers.current[key]
          : variant
            ? variant.content || ''
            : lang.starter
      return [{ path: nextPath, content, language: variant?.language || lang.language }]
    })
    setActiveFile(nextPath)
    setResponseTouched(true)
    setRunResult(null)
    setRunError(null)
    setAiReview(null) // a pending AI review is against the OLD buffer — void it on language switch
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, key)
    } catch {
      /* ignore */
    }
    scheduleDraftSave()
  }

  // Reset the active language's buffer back to its starter stub. Two-step (arm → confirm) so a
  // stray click can't wipe work — autosave would otherwise persist the reset immediately.
  const [resetArmed, setResetArmed] = useState(false)
  const resetArmTimer = useRef(null)
  function handleReset() {
    const lang = languageByKey(currentLangKey)
    if (!lang) return
    if (!resetArmed) {
      setResetArmed(true)
      if (resetArmTimer.current) clearTimeout(resetArmTimer.current)
      resetArmTimer.current = setTimeout(() => setResetArmed(false), 3500)
      return
    }
    setResetArmed(false)
    if (resetArmTimer.current) clearTimeout(resetArmTimer.current)
    delete langBuffers.current[currentLangKey]
    const variant = starterVariants(task)?.[currentLangKey] || null
    setFiles([
      variant
        ? { path: variant.path, content: variant.content || '', language: variant.language }
        : { path: lang.filename, content: lang.starter, language: lang.language },
    ])
    setActiveFile(variant?.path || lang.filename)
    setResponseTouched(true)
    setRunResult(null)
    setRunError(null)
    setAiReview(null) // the buffer the review diffed against is gone — void the pending review
    scheduleDraftSave()
  }

  // Keep the typed-length tracker in sync with serialized code length so the
  // existing behavioral pipeline (paste-vs-typed) works for the IDE too.
  useEffect(() => {
    if (isCode) signals.onTextChange(codeResponse.length)
  }, [codeResponse, isCode, signals])

  const canSubmit =
    effectiveResponse.trim().length > 0 &&
    !submitting &&
    !aiReview && // an unresolved AI edit review must be accepted/rejected before submitting
    (isDemo || configured) &&
    (isDemo || Boolean(user))

  async function handleSubmit(opts = {}) {
    // The zero-second auto-submit passes { auto: true }: it must send whatever is in the editor,
    // so it skips the confirm-style guards a manual click gets. (Button onClick passes the click
    // event here, which has no .auto, so manual submits keep every guard.)
    const auto = opts && opts.auto === true
    setSubmitError(null)
    if (aiReview) {
      if (auto) {
        // A pending suggestion was never accepted, so it is not in the editor: void it and
        // submit the editor content as-is.
        recordAiDisposition(aiReview.seq, 'rejected')
        setAiReview(null)
      } else {
        setSubmitError('Accept or reject the AI suggested edit first. Your work submits exactly as it is in the editor.')
        return
      }
    }
    if (!effectiveResponse.trim() && !auto) {
      setSubmitError('Add your response before submitting.')
      return
    }
    // Deliverables soft confirm (TOU-146): a manual submit with unchecked items pauses for an
    // explicit "submit anyway / keep working" choice. Never a hard block, and the zero-second
    // auto-submit skips it (losing finished work to a checklist would be far worse).
    if (!auto && opts.confirmed !== true && deliverables.length) {
      const unchecked = deliverables.filter((_, i) => !deliverablesCheck.includes(i))
      if (unchecked.length) {
        setSubmitConfirm({ unchecked })
        return
      }
    }
    setSubmitConfirm(null)
    if (isCode) signals.record('ide_activity', activity.signals)
    signals.markSubmit(effectiveResponse.length)

    // Demo mode: no backend id wired — just show the thank-you state.
    if (isDemo) {
      setSubmitted(true)
      return
    }

    if (!configured) {
      setSubmitError('Submitting needs an account, which isn’t configured in this environment.')
      return
    }
    if (!user) {
      setSubmitError('Sign in to submit your work.')
      return
    }

    setSubmitting(true)
    try {
      let sid = submissionId
      // Self-assign if we only have a work-sample id (no submission yet).
      if (!sid && wsId) {
        const sub = await api.assignWorkSample(wsId, user.id)
        sid = sub.id
        setSubmission(sub)
        setSubmissionId(sid)
      }
      if (!sid) throw new Error('No submission to submit to.')

      // Flush remaining behavioral events before the response lands.
      const trailing = signals.collectAndReset()
      if (trailing.length) {
        try {
          await api.sendIntegrityEvents(sid, trailing)
        } catch {
          /* non-blocking */
        }
      }

      const payload = isCode ? { responseCode: effectiveResponse } : { responseText: response }
      // Self-check state travels with the submit so the recruiter's review shows what the
      // candidate ticked (server-validated, metadata.deliverables_check).
      if (deliverables.length && deliverablesCheck.length) {
        payload.deliverablesCheck = [...deliverablesCheck].sort((a, b) => a - b)
      }
      await api.submitResponse(sid, payload)
      track('screen_completed')
      // Work is safely on the server now — drop the local draft so it can't resurrect later.
      clearDrafts(scopeId)
      clearDrafts(sid) // legacy submission-keyed draft from before the canonical ws:<id> scope
      releaseAvStream() // the session is over; no reason to hold the camera or mic a second longer
      setSubmitted(true)
    } catch (e) {
      setSubmitError(e.message || 'Could not submit your work.')
    } finally {
      setSubmitting(false)
    }
  }

  // Fire the 10 / 5 / 1 minute warnings once each, then auto-submit at zero so the candidate's
  // work is never lost to the deadline. A failed auto-submit surfaces submitError exactly like a
  // manual submit; the server-side grace window keeps a slightly-late request accepted.
  useEffect(() => {
    if (remainingMs == null || submitted || isDemo) return
    for (const min of [10, 5, 1]) {
      if (remainingMs <= min * 60000 && !timeWarnedRef.current[min]) {
        timeWarnedRef.current[min] = true
        setTimeWarning(
          min === 1
            ? '1 minute left. Your work will submit automatically when time runs out.'
            : `${min} minutes left on this screen. Your work autosaves as you go.`,
        )
      }
    }
    if (remainingMs <= 0 && !autoSubmitRef.current && !submitting) {
      autoSubmitRef.current = true
      setTimeWarning('Time is up. Submitting the work in your editor now.')
      handleSubmit({ auto: true })
    }
  }, [remainingMs, submitted, submitting, isDemo])

  // The start gate's primary action: stamp started_at + deadline server-side (idempotent),
  // swap in the started submission, and let the workspace render with the countdown running.
  async function handleStart() {
    setStartError(null)
    // AV-gated screens (TOU-147): the button is locked until access is granted, but never
    // trust the button alone. The grant doubles as the explicit consent the server records.
    if (avRequired && !avGranted) {
      setStartError('Enable your camera and microphone above to unlock Start.')
      return
    }
    setStarting(true)
    try {
      const { submission: sub } = await api.startSubmission(
        submission.id,
        avRequired ? { avConsent: true } : undefined,
      )
      if (sub) {
        setSubmission(sub)
        setSubmissionId(sub.id)
      }
      track('screen_started')
    } catch (e) {
      setStartError(e.message || 'Could not start this assessment. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  // Confirm-decline from the gate's inline confirm: mark the submission declined server-side
  // (notifies the hiring team), then land the candidate back on their dashboard where the
  // row moves to the Declined section.
  async function handleDecline() {
    setDeclineError(null)
    setDeclining(true)
    try {
      await api.declineSubmission(submission.id, declineReason.trim() || undefined)
      track('screen_declined')
      navigate('/candidate/home')
    } catch (e) {
      setDeclineError(e.message || 'Could not decline this assessment. Please try again.')
    } finally {
      setDeclining(false)
    }
  }

  async function handleRun() {
    setRunError(null)
    if (isDemo) {
      setRunError('Running needs a real screen. This is a preview.')
      return
    }
    if (!configured) {
      setRunError('Code execution isn’t configured in this environment.')
      return
    }
    if (!user) {
      setRunError('Sign in to run your code against the checks.')
      return
    }
    setRunning(true)
    setRunResult(null)
    try {
      let sid = submissionId
      // Self-assign from a ?ws link so there's a submission to run against.
      if (!sid && wsId) {
        const sub = await api.assignWorkSample(wsId, user.id)
        sid = sub.id
        setSubmission(sub)
        setSubmissionId(sid)
      }
      if (!sid) throw new Error('No screen to run against yet.')
      const payloadFiles = (files || []).map((f) => ({ path: f.path, content: f.content || '' }))
      const res = await api.runSubmission(sid, { files: payloadFiles, language: currentLangKey, stdin: customInput })
      setRunResult(res)
    } catch (e) {
      setRunError(e.message || 'Could not run your code.')
    } finally {
      setRunning(false)
    }
  }

  // Written screens: "Check coverage" runs the SHARED deliverables heuristic (the same one the
  // recruiter sees on the result view) against the current draft. Pure client-side, no network,
  // no AI, no rubric: it only ever reads the PUBLIC checklist. A reading aid, never a grade.
  // NOTE: these hooks MUST live above the conditional returns below — placed lower, the start
  // gate renders fewer hooks than the workspace and the transition crashes (React #310).
  const canCheckCoverage = !isCode && deliverables.length > 0 && !submitting
  const [coverageReport, setCoverageReport] = useState(null)
  const handleCheckCoverage = () => setCoverageReport(buildCoverageReport(deliverables, response))
  // A stale report after further typing would quietly lie, so clear it as soon as the draft moves.
  useEffect(() => {
    setCoverageReport(null)
  }, [response])

  // --- Three-state flow: load → work → submit ---

  if (loading || authLoading) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-28 rounded-full bg-stone-200/70" />
          <div className="h-9 w-3/4 rounded-lg bg-stone-200/70" />
          <div className="h-4 w-full rounded bg-stone-200/60" />
          <div className="h-4 w-5/6 rounded bg-stone-200/60" />
          <div className="mt-6 h-64 w-full rounded-2xl bg-stone-200/50" />
        </div>
        <p className="mt-6 text-center text-sm text-stone-400">Loading your screen…</p>
      </div>
    )
  }

  // Logged-out visitor with an invite link: screens are private to a candidate account, so prompt
  // them to sign in or create one, then return here. We never show the assessment (or its brief)
  // without a session.
  if (!isDemo && configured && !user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-5 py-20 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-100">
          <Lock size={22} />
        </span>
        <h1 className="mt-5 font-serif text-2xl font-semibold text-ink">Sign in to start your screen</h1>
        <p className="mt-3 text-stone-600">
          This screen is private to your account. Sign in or create a free Touchstones account to
          open it, review the task and its AI policy, and submit your work.
        </p>
        <div className="mt-7 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Link to="/login" state={{ from: returnTo, mode: 'signup' }} className="btn-primary">
            Create a free account <ArrowRight size={16} />
          </Link>
          <Link to="/login" state={{ from: returnTo }} className="btn-ghost">
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-xs text-stone-400">
          The screen’s AI policy is shown with the task before the timer starts.
        </p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100">
          <FileText size={24} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-ink">This screen couldn’t be loaded</h1>
        <p className="mx-auto mt-3 max-w-md text-stone-600">{loadError}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-400">
          Check the link, or sign in if the screen is private to your account.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className="btn-primary">
            Try again
          </button>
          {configured && !user && (
            <Link to="/login" state={{ from: returnTo }} className="btn-ghost">
              Sign in <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200 dark:bg-clay-500/15 dark:text-[#9DA9EF] dark:ring-[#25304D]">
          <Check size={26} />
        </span>
        <h1 className="mt-5 text-3xl font-semibold dark:text-[#F4F6FF]">Submitted. Thank you.</h1>
        {task?.title && (
          <p className="mx-auto mt-2 max-w-md text-sm font-medium text-stone-500 dark:text-[#AEB7D0]">{task.title}</p>
        )}
        <p className="mx-auto mt-3 max-w-md text-stone-600 dark:text-[#AEB7D0]">
          Your work is in. The team reviews one explainable score with the reasoning attached: no
          black box, no ranking against a curve. You’ll hear back soon.
        </p>
        {user && !isDemo && (
          <div className="mx-auto mt-6 max-w-sm">
            <Link
              to="/candidate/results"
              className="inline-flex items-center gap-2 rounded-xl bg-clay-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-clay-700 dark:bg-[#3448C5] dark:hover:bg-[#4358D0]"
            >
              Go to your dashboard <ArrowRight size={15} />
            </Link>
          </div>
        )}
        <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-stone-200 bg-canvas/60 p-5 text-left text-sm text-stone-600 dark:border-[#25304D] dark:bg-[#11182B] dark:text-[#AEB7D0]">
          <p className="font-medium text-ink dark:text-[#F4F6FF]">What happens next</p>
          <ul className="mt-2 space-y-1.5">
            <li>Your solution is scored against the same rubric as every candidate.</li>
            {aiAllowed && <li>How you directed and verified the AI is part of the review context.</li>}
            <li>A real person reviews the result before any decision.</li>
          </ul>
        </div>
        <div className="mx-auto mt-6 flex max-w-sm flex-col gap-2 rounded-2xl border border-stone-200 bg-canvas/60 p-4 text-left text-sm text-stone-600 dark:border-[#25304D] dark:bg-[#11182B] dark:text-[#AEB7D0]">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={16} className="text-clay-500" /> Behavioral signals only, with no
            biometrics.
          </span>
          <span className="inline-flex items-center gap-2">
            <FileText size={16} className="text-clay-500" /> You can request your data anytime.
          </span>
        </div>

        {/* Optional verified-session offer (ADR-001 Phase 2). Only for a real signed-in submission
            on a verified-session-enabled screen, and only when the build flag is on — never in demo
            or signed-out. Flag OFF ⇒ this block is absent and the receipt is unchanged. */}
        {VERIFIED_SESSION_ENABLED && !isDemo && user && submissionId && task?.verified_session_enabled && (
          <div className="mx-auto max-w-xl text-left">
            <VerifiedSession submissionId={submissionId} task={task} />
          </div>
        )}
      </div>
    )
  }

  const roleLabel = task?.role_family || 'Work sample'
  const title = task?.title || 'Real-work screen'
  const promptText = task?.prompt_md || ''
  const durationMin = task?.duration_minutes || 30

  // Sign-in is required to submit a real screen. We don't block reading the task
  // (candidates can review the brief first) — we surface a clear prompt instead.
  const needsSignIn = !isDemo && configured && !user
  const authUnavailable = !isDemo && !configured

  // Plain-language pre-screen transparency notice — a NOTICE, not a consent gate (consent is
  // Phase 2 of the verified-session ADR). Shown in the task brief so what is and isn't recorded
  // is clear before the candidate starts. Rendered in both the code and non-code layouts.
  const transparencyNotice = (
    <div className="mt-5 rounded-xl border border-stone-200 bg-canvas/60 px-3.5 py-3 text-xs leading-relaxed text-stone-600 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#AEB7D0]">
      <p className="inline-flex items-center gap-1.5 font-semibold text-ink dark:text-[#F4F6FF]">
        <ShieldCheck size={13} className="text-clay-500" /> Before you start: what’s recorded
      </p>
      <p className="mt-1.5">
        {aiAllowed
          ? 'Your work and edits, your AI conversation, and server-observed session integrity events with timestamps.'
          : 'Your work and edits, plus server-observed session integrity events with timestamps. The AI assistant is disabled for this task.'}
      </p>
      <p className="mt-1.5">
        {/* On an av_required screen the camera and mic ARE in use, so the blanket "no webcam, no
            microphone" line would be a plain contradiction of the panel right below this one.
            State the truth for each case: nothing is ever captured or stored either way. */}
        {avRequired ? (
          <>
            <span className="font-medium text-ink dark:text-[#F4F6FF]">Not recorded:</span> no
            video, no audio, no snapshots, no screen capture, no biometrics. Your camera and
            microphone are used as a live presence signal only, and nothing from them is captured,
            stored, or sent anywhere.
          </>
        ) : (
          <>
            <span className="font-medium text-ink dark:text-[#F4F6FF]">Not recorded:</span> no
            webcam, no microphone, no screen capture, no biometrics.
          </>
        )}
      </p>
      <p className="mt-1.5">
        You can request deletion of your data at any time.{' '}
        <a
          href="/trust-center"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-clay-700 underline-offset-2 hover:underline dark:text-[#9DA9EF]"
        >
          How your data is handled →
        </a>
      </p>
    </div>
  )

  // --- Start gate (HackerRank-style). A fresh assignment that was never started (no
  // started_at, no deadline stamped) shows the brief and a deliberate Start button instead
  // of dropping into the workspace. Legacy rows assigned before start-gating already carry a
  // deadline_at from assign time; their timer is burning, so they skip the gate. Demo
  // previews have no submission and never reach this branch. ---
  const needsStartGate =
    !isDemo &&
    Boolean(submission) &&
    submission.status === 'assigned' &&
    !submission.started_at &&
    !submission.deadline_at

  if (needsStartGate) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <div className="rounded-2xl border border-stone-200 bg-white p-7 shadow-card dark:border-[#25304D] dark:bg-[#11182B]">
          <div className="flex items-center gap-2">
            <Pill tone="clay">{roleLabel}</Pill>
            {submissionId && (
              <Pill tone="neutral" className="font-mono">
                #{String(submissionId).slice(0, 6)}
              </Pill>
            )}
          </div>
          <h1 className="mt-4 font-serif text-3xl font-semibold leading-tight text-ink dark:text-[#F4F6FF]">{title}</h1>
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-[#AEB7D0]">
            <Clock size={16} className="text-clay-500" />
            You will have {durationMin} minutes once you start.
          </p>

          <div className="mt-5 rounded-2xl border border-stone-200 bg-canvas/60 p-5 dark:border-[#25304D] dark:bg-[#0D1426]">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-[#8490AE]">
              What to expect
            </span>
            <ul className="mt-3 space-y-2">
              {[
                ...checklist,
                'Your work autosaves as you go, so a refresh never loses progress.',
                'Submit when you are ready. When time runs out, the work in your editor submits automatically.',
              ].map((c) => (
                <li key={c} className="flex gap-2.5 text-sm text-stone-700 dark:text-[#AEB7D0]">
                  <Check size={16} className="mt-0.5 shrink-0 text-clay-500" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {transparencyNotice}

          {/* Camera + mic requirement (TOU-147). Consent is a deliberate act: Start stays
              locked until access is granted. Presence signals only; nothing is recorded. */}
          {avRequired && (
            <div className="mt-4 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3.5 dark:border-clay-500/40 dark:bg-clay-500/10">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-clay-800 dark:text-[#9DA9EF]">
                <Camera size={15} className="text-clay-600 dark:text-[#9DA9EF]" />
                <Mic size={15} className="text-clay-600 dark:text-[#9DA9EF]" />
                This screen involves your camera and microphone
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-clay-800/90 dark:text-[#AEB7D0]">
                They are used as a presence signal only. Nothing is recorded or stored: no video,
                no audio, no snapshots ever leave your browser. If your camera or mic turns off
                during the screen, that becomes a note for a human reviewer, never an automated
                pass or fail.
              </p>
              {avGranted ? (
                <p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-clay-800 dark:text-[#9DA9EF]">
                  <span className="h-2 w-2 rounded-full bg-clay-500" />
                  Camera and mic are on. Nothing is recorded.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleEnableAv}
                  disabled={avRequesting}
                  className="btn-primary mt-3 px-3.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {avRequesting ? 'Requesting access…' : 'Enable camera and microphone'}
                </button>
              )}
              {avError && (
                <p className="mt-3 rounded-lg bg-flag-50 px-3 py-2 text-xs leading-relaxed text-flag-700 ring-1 ring-flag-100">
                  {avError}
                </p>
              )}
            </div>
          )}

          {startError && (
            <p className="mt-4 rounded-lg bg-flag-50 px-3 py-2 text-sm text-flag-700 ring-1 ring-flag-100">
              {startError}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleStart}
              disabled={starting || (avRequired && !avGranted)}
              title={avRequired && !avGranted ? 'Enable your camera and microphone to unlock Start' : undefined}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {avRequired && !avGranted && <Lock size={14} />}
              {starting ? 'Starting…' : 'Start assessment'} <ArrowRight size={16} />
            </button>
            <Link
              to="/candidate/home"
              className="text-sm font-medium text-stone-500 underline-offset-2 hover:text-stone-700 hover:underline dark:text-[#8490AE] dark:hover:text-[#AEB7D0]"
            >
              Back to dashboard
            </Link>
          </div>

          {/* Quiet decline affordance. Only reachable pre-start (this gate never renders once
              started), matching the server's pre-start-only rule. */}
          <div className="mt-6 border-t border-stone-200 pt-4 dark:border-[#25304D]">
            {!declineOpen ? (
              <button
                type="button"
                onClick={() => setDeclineOpen(true)}
                className="text-xs font-medium text-stone-400 underline-offset-2 hover:text-flag-700 hover:underline dark:text-[#8490AE]"
              >
                Decline this assessment
              </button>
            ) : (
              <div className="rounded-xl border border-flag-100 bg-flag-50/60 p-4 dark:border-flag-500/40 dark:bg-flag-500/10">
                <p className="text-sm font-medium text-flag-700 dark:text-flag-200">
                  The hiring team will be notified. You can be re-invited later.
                </p>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={2}
                  spellCheck
                  placeholder="Optional: tell them why"
                  aria-label="Reason for declining (optional)"
                  className="mt-3 w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-flag-500 focus:outline-none dark:border-[#25304D] dark:bg-[#0D1426] dark:text-[#F4F6FF] dark:placeholder:text-[#8490AE]"
                />
                {declineError && <p className="mt-2 text-sm text-flag-700 dark:text-flag-200">{declineError}</p>}
                <div className="mt-3 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={declining}
                    className="rounded-xl bg-flag-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-flag-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {declining ? 'Declining…' : 'Confirm decline'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeclineOpen(false)
                      setDeclineError(null)
                    }}
                    className="text-sm font-medium text-stone-500 underline-offset-2 hover:text-stone-700 hover:underline"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // --- Workspace (every response type) -> full-height 3-pane split: problem (left),
  //     answer editor (middle; code screens stack a console under it), AI assistant
  //     (right). Stacks vertically below `lg`. Written screens deliberately keep the
  //     light theme (prose reads better on the light terracotta/ink system); the dark
  //     chrome only engages for code via the editor-theme effect above. ---
  const canRun = isCode && !running && !submitting && !isDemo

  // Pane contents are defined once and dropped into either the draggable PanelGroup (desktop) or
  // the stacked flex layout (mobile) — only one tree renders at a time, so the editor mounts once.
  const problemContent = (
    <>
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-[#8490AE]">
        Problem
      </span>
      <h2 className="mt-2 font-serif text-xl font-semibold leading-snug text-ink dark:text-[#F4F6FF]">{title}</h2>
      <Markdown
        className="mt-4"
        source={
          promptText ||
          'Our payments service intermittently double-charges customers when a request is retried. Reproduce the issue, fix the root cause, and add tests. Work the way you would on the job.'
        }
      />
      <div className="mt-5 rounded-xl border border-clay-200 bg-clay-50 px-3.5 py-3 text-xs leading-relaxed text-clay-800 dark:border-clay-500/30 dark:bg-clay-500/10 dark:text-[#C8CEFA]">
        <span className="font-semibold">{aiAllowed ? 'AI is allowed.' : 'Independent work.'}</span>{' '}
        {aiAllowed
          ? 'Direct the assistant deliberately and verify its output. Those choices become reviewable context alongside the work.'
          : 'The AI assistant is disabled for this task. Complete the work using the instructions and resources provided.'}
      </div>
      <div className="mt-5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-[#8490AE]">
          What we’re looking for
        </span>
        <ul className="mt-3 space-y-2">
          {checklist.map((c) => (
            <li key={c} className="flex gap-2 text-sm text-stone-700 dark:text-[#D4D9E8]">
              <Check size={15} className="mt-0.5 shrink-0 text-clay-500" />
              {c}
            </li>
          ))}
        </ul>
      </div>
      {/* Deliverables self-check (TOU-146): the recruiter's concrete asks, with tick-off
          checkboxes. The candidate's own aid; ticks persist with the draft and never gate
          submitting (a soft confirm lists anything unchecked). */}
      {deliverables.length > 0 && (
        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-[#8490AE]">
            Deliverables
          </span>
          <p className="mt-1 text-xs text-stone-400 dark:text-[#8490AE]">
            Tick items off as you cover them. This is your own checklist; it never blocks
            submitting.
          </p>
          <ul className="mt-3 space-y-1.5">
            {deliverables.map((d, i) => {
              const on = deliverablesCheck.includes(i)
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => toggleDeliverable(i)}
                    aria-pressed={on}
                    className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1 text-left text-sm transition-colors hover:bg-clay-50 dark:hover:bg-clay-500/10"
                  >
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                        on
                          ? 'border-clay-500 bg-clay-500 text-white'
                          : 'border-stone-300 bg-white dark:border-[#53607F] dark:bg-[#090E1C]'
                      }`}
                    >
                      {on && <Check size={11} />}
                    </span>
                    <span
                      className={
                        on
                          ? 'text-stone-400 line-through dark:text-[#8490AE]'
                          : 'text-stone-700 dark:text-[#D4D9E8]'
                      }
                    >
                      {d}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {transparencyNotice}
      {needsSignIn && (
        <p className="mt-5 rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-xs text-stone-600 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#AEB7D0]">
          Sign in to continue and submit your work.
        </p>
      )}
      {authUnavailable && (
        <p className="mt-5 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-[#D9A441]">
          Sign-in isn’t configured in this environment. This screen is read-only.
        </p>
      )}
    </>
  )

  // Autosave indicator shared by the code and written editor headers.
  const draftIndicator = scopeId && (
    <span className="hidden items-center gap-1 text-xs text-stone-400 dark:text-[#8490AE] sm:inline-flex">
      {draftSaved ? (
        <>
          <Check size={12} className="text-clay-500" /> Saved
        </>
      ) : (
        'Saving…'
      )}
    </span>
  )

  // Center pane: the code IDE (editor + language/reset chrome) or, for written screens, the
  // response editor filling the pane the same way. Both park a pending AI edit review here.
  const editorContent = isCode ? (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 bg-sand/40 px-4 py-2 dark:border-[#25304D] dark:bg-[#090E1C]">
        {showLanguagePicker ? (
          <LanguagePicker value={currentLangKey} options={languageOptions} onChange={changeLanguage} />
        ) : (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink dark:text-[#F4F6FF]">
            <Code size={15} className="text-stone-400 dark:text-[#8490AE]" /> Code
          </span>
        )}
        <div className="flex items-center gap-2.5">
          {draftIndicator}
          {currentLangKey && (
            <button
              type="button"
              onClick={handleReset}
              title="Restore the original starter code"
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                resetArmed
                  ? 'border-flag-300 bg-flag-50 text-flag-700 dark:border-flag-500/40 dark:bg-flag-500/10 dark:text-[#F0846A]'
                  : 'border-stone-200 text-stone-500 hover:border-clay-300 hover:text-stone-700 dark:border-[#25304D] dark:text-[#AEB7D0] dark:hover:border-clay-500/50'
              }`}
            >
              <RotateCcw size={12} /> {resetArmed ? 'Confirm reset?' : 'Reset'}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {aiReview ? (
          <AiEditReview
            fill
            original={getAiCode()}
            proposed={aiReview.code}
            onAccept={acceptAiReview}
            onReject={rejectAiReview}
          />
        ) : (
          <Suspense
            fallback={
              <div className="grid h-full min-h-[240px] place-items-center bg-canvas text-sm text-stone-400 dark:bg-[#11182B] dark:text-[#8490AE]">
                Loading editor…
              </div>
            }
          >
            <CodeEditor
              fill
              theme={editorTheme}
              files={files}
              activeFile={activeFile}
              onActiveFileChange={setActiveFile}
              onRunShortcut={canRun ? handleRun : undefined}
              onChange={(path, content) => {
                setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content } : f)))
                setResponseTouched(true)
                scheduleDraftSave()
              }}
              onActivity={(e) => {
                activity.onActivity(e)
                if (e.type === 'paste') signals.record('paste', { chars: e.length })
              }}
            />
          </Suspense>
        )}
      </div>
    </>
  ) : (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 bg-sand/40 px-4 py-2 dark:border-[#25304D] dark:bg-[#090E1C]">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink dark:text-[#F4F6FF]">
          <FileText size={15} className="text-stone-400 dark:text-[#8490AE]" /> Markdown
        </span>
        <div className="flex items-center gap-2.5">
          {draftIndicator}
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-400 dark:text-[#8490AE]">
            {aiAllowed ? (
              <><Sparkle size={13} /> AI allowed. Direct it, then verify it.</>
            ) : (
              <><ShieldCheck size={13} /> Independent work</>
            )}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-white dark:bg-[#0D1426]">
        {aiReview ? (
          <AiEditReview
            fill
            original={getAiCode()}
            proposed={aiReview.code}
            onAccept={acceptAiReview}
            onReject={rejectAiReview}
          />
        ) : (
          <textarea
            value={response}
            onChange={(e) => {
              setResponse(e.target.value)
              setResponseTouched(true)
              signals.onTextChange(e.target.value.length)
              scheduleDraftSave()
            }}
            onPaste={signals.onPaste}
            spellCheck
            placeholder="Write your response here. Markdown is welcome. Structure your thinking."
            aria-label="Your response"
            className="block h-full w-full resize-none bg-white px-5 py-4 text-sm leading-relaxed text-ink placeholder:text-stone-400 focus:outline-none dark:bg-[#0D1426] dark:text-[#F4F6FF] dark:placeholder:text-[#8490AE]"
          />
        )}
      </div>
    </>
  )

  const consoleContent = (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-4 py-2 dark:border-[#25304D]">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink dark:text-[#F4F6FF]">
          <Play size={14} className="text-stone-400 dark:text-[#8490AE]" />
          {isCode ? 'Console' : 'Deliverables'}
        </span>
        <div className="flex items-center gap-1.5">
          {/* stdin only means something for a program. A written screen never shows it. */}
          {isCode && (
            <button
              type="button"
              onClick={() => setShowInput((v) => !v)}
              title="Provide custom input (stdin) for your program"
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                showInput || customInput
                  ? 'border-clay-300 text-clay-700 dark:border-clay-500/50 dark:text-[#9DA9EF]'
                  : 'border-stone-200 text-stone-500 hover:border-clay-300 dark:border-[#25304D] dark:text-[#AEB7D0]'
              }`}
            >
              Input{customInput ? ' ·' : ''}
            </button>
          )}
          {/* Code screens run against the checks. Written screens have no code to execute, so the
              same button checks the PUBLIC deliverables checklist instead of sitting there dead
              (TOU-146's original intent: give written screens a way to check their own work). */}
          <button
            onClick={isCode ? handleRun : handleCheckCoverage}
            disabled={isCode ? !canRun : !canCheckCoverage}
            title={
              isCode
                ? (isDemo ? 'Running needs a real screen (preview mode)' : 'Run your code against the checks')
                : (deliverables.length
                    ? 'Check which deliverables your draft appears to cover'
                    : 'This screen has no deliverables checklist')
            }
            className="btn-ghost px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#303C5C] dark:text-[#9DA9EF] dark:hover:bg-clay-500/10"
          >
            <Play size={13} /> {isCode ? (running ? 'Running…' : 'Run') : 'Check coverage'}
          </button>
        </div>
      </div>
      {showInput && isCode && (
        <div className="shrink-0 border-b border-stone-200 px-4 py-2 dark:border-[#25304D]">
          <label className="text-xs text-stone-400 dark:text-[#8490AE]">Custom input (stdin)</label>
          <textarea
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="Lines fed to your program's standard input when you Run…"
            className="mt-1 w-full resize-y rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-clay-400 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF]"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {!isCode ? (
          // Written screens: deliverables coverage, never code execution.
          coverageReport ? (
            <div>
              <p className="text-xs text-stone-500 dark:text-[#AEB7D0]">
                {coverageReport.mentioned} of {coverageReport.total} deliverables look covered.
                This is a keyword check on your own draft, not a score and not a grade. Your
                reviewer is a human.
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {coverageReport.rows.map((r) => (
                  <li key={r.index} className="flex items-start gap-2 text-xs">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                        r.coverage === 'mentioned'
                          ? 'bg-clay-50 text-clay-700 ring-clay-200 dark:bg-clay-500/10 dark:text-[#9DA9EF] dark:ring-clay-500/40'
                          : 'bg-amber-50 text-amber-800 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30'
                      }`}
                    >
                      {COVERAGE_LABEL[r.coverage]}
                    </span>
                    <span className="text-stone-600 dark:text-[#AEB7D0]">{r.item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm text-stone-400 dark:text-[#8490AE]">
              <FileText size={15} />
              {deliverables.length
                ? 'Check coverage to see which deliverables your draft appears to address.'
                : 'This screen has no deliverables checklist.'}
            </p>
          )
        ) : running ? (
          <p className="inline-flex items-center gap-2 text-sm text-stone-500 dark:text-[#AEB7D0]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-clay-500" />
            Running your code against the checks…
          </p>
        ) : runError ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-flag-700 dark:text-[#F0846A]">{runError}</p>
            <button onClick={handleRun} className="btn-ghost px-3 py-1 text-xs dark:border-[#303C5C] dark:text-[#9DA9EF] dark:hover:bg-clay-500/10">
              Try again
            </button>
          </div>
        ) : runResult ? (
          <RunResult result={runResult} />
        ) : (
          <p className="inline-flex items-center gap-2 text-sm text-stone-400 dark:text-[#8490AE]">
            <Code size={15} /> Run your code to see test results and output here.
          </p>
        )}
      </div>
    </>
  )

  const aiContent = aiAllowed ? (
    <AiAssistPanel
      fill
      submissionId={submissionId}
      configured={configured}
      signedIn={Boolean(user)}
      getCode={getAiCode}
      getLanguage={getAiLanguage}
      onApplyCode={applyAiCode}
      onReviewCode={AI_EDIT_REVIEW_ENABLED ? openAiReview : undefined}
    />
  ) : null

  const mobileTabs = [
    { id: 'problem', label: 'Problem' },
    { id: 'work', label: 'Work' },
    { id: 'console', label: 'Console' },
    ...(aiAllowed ? [{ id: 'ai', label: 'AI' }] : []),
  ]

  return (
    <div className="flex flex-col bg-paper dark:bg-[#090E1C] lg:h-[calc(100dvh-106px)]">
      {/* Top bar — identity, theme toggle, timer, submit */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-canvas/70 px-4 py-2.5 dark:border-[#25304D] dark:bg-[#11182B]">
        <div className="flex min-w-0 items-center gap-2">
          <Pill tone="clay">{roleLabel}</Pill>
          {submissionId && (
            <Pill tone="neutral" className="font-mono">
              #{String(submissionId).slice(0, 6)}
            </Pill>
          )}
          <h1 className="truncate text-sm font-semibold text-ink dark:text-[#F4F6FF]">{title}</h1>
        </div>
        <div className="flex items-center gap-2.5">
          {responseTouched && !effectiveResponse.trim() && (
            <span className="hidden text-xs text-stone-400 dark:text-[#8490AE] md:inline">
              Add a response to submit
            </span>
          )}
          {/* Honest AV indicator (TOU-147): while the presence stream is live, say so plainly,
              and say just as plainly that nothing is recorded. */}
          {avRequired && (
            <span
              title="Presence signal only. No video or audio is ever recorded or stored."
              className="hidden items-center gap-1.5 text-xs text-stone-500 dark:text-[#AEB7D0] lg:inline-flex"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  avGranted ? 'bg-clay-500' : 'bg-stone-300 dark:bg-[#53607F]'
                }`}
              />
              {avGranted ? 'Camera and mic are on. Nothing is recorded.' : 'Camera and mic are off.'}
            </span>
          )}
          <EditorThemeMenu value={editorTheme} onChange={changeEditorTheme} />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-ink dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF]">
            <Clock size={14} className="text-stone-400 dark:text-[#8490AE]" />
            {remainingMs != null ? (
              <>
                {fmtClock(remainingMs / 1000)} <span className="font-normal text-stone-400">left</span>
              </>
            ) : (
              <>
                {fmtClock(elapsedS)} <span className="font-normal text-stone-400">/ ~{durationMin}m</span>
              </>
            )}
          </span>
          {needsSignIn ? (
            <Link to="/login" className="btn-primary px-3 py-1.5 text-sm">
              Sign in <ArrowRight size={15} />
            </Link>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="btn-primary px-3.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit'} <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Deadline warning strip (10 / 5 / 1 min + time-up). Dismissable; reappears at the next
          threshold. */}
      {timeWarning && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-[#D9A441]">
          <span className="inline-flex items-center gap-2">
            <Clock size={14} /> {timeWarning}
          </span>
          <button
            type="button"
            onClick={() => setTimeWarning(null)}
            className="shrink-0 text-xs font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Deliverables soft confirm (TOU-146): submit paused, never blocked. The auto-submit at
          zero skips this entirely, so finished work is never lost to a checklist. */}
      {submitConfirm && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-clay-200 bg-clay-50 px-4 py-2.5 text-sm text-clay-800 dark:border-clay-500/30 dark:bg-clay-500/10 dark:text-[#C8CEFA]">
          <span className="min-w-0">
            You have not marked {submitConfirm.unchecked.length} deliverable
            {submitConfirm.unchecked.length === 1 ? '' : 's'}:{' '}
            <span className="font-medium">{submitConfirm.unchecked.join(' · ')}</span>. Your work
            submits exactly as it is.
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => handleSubmit({ confirmed: true })}
              disabled={submitting}
              className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              Submit anyway
            </button>
            <button
              type="button"
              onClick={() => setSubmitConfirm(null)}
              className="text-xs font-medium underline-offset-2 hover:underline"
            >
              Keep working
            </button>
          </span>
        </div>
      )}

      {/* 3 panes — draggable PanelGroup on desktop (LeetCode-style resize), stacked below lg.
          Sizes persist per group via autoSaveId. Only one tree mounts (isDesktop) so the editor
          never double-mounts. */}
      {isDesktop ? (
        <div className="min-h-0 flex-1">
          <PanelGroup direction="horizontal" autoSaveId={isCode ? 'ts-ide-h' : 'ts-md-h'}>
            {/* LEFT — problem statement */}
            <Panel id="problem" order={1} defaultSize={26} minSize={15} className="min-h-0">
              <div className="h-full overflow-y-auto px-5 py-5 dark:bg-[#0D1426]">{problemContent}</div>
            </Panel>
            <IdeResizeHandle direction="horizontal" />
            {/* MIDDLE: the answer editor with a console stacked under it (itself vertically
                resizable). Owner directive 2026-07-14: EVERY assessment type gets this same
                workspace, so written screens keep the console pane too rather than handing the
                editor the whole pane (which read as a different, older layout). */}
            <Panel
              id="middle"
              order={2}
              defaultSize={aiAllowed ? 51 : 74}
              minSize={28}
              className="min-w-0"
            >
              <PanelGroup direction="vertical" autoSaveId={isCode ? 'ts-ide-v' : 'ts-md-v'}>
                <Panel id="editor" order={1} defaultSize={64} minSize={20} className="flex min-h-0 flex-col">
                  {editorContent}
                </Panel>
                <IdeResizeHandle direction="vertical" />
                <Panel id="console" order={2} defaultSize={36} minSize={10} className="flex min-h-0 flex-col bg-canvas/60 dark:bg-[#0D1426]">
                  {consoleContent}
                </Panel>
              </PanelGroup>
            </Panel>
            {aiAllowed && (
              <>
                <IdeResizeHandle direction="horizontal" />
                {/* RIGHT: AI assistant, only when the authored policy allows it. */}
                <Panel id="ai" order={3} defaultSize={23} minSize={15} className="flex min-h-0 min-w-0 flex-col">
                  {aiContent}
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            role="tablist"
            aria-label="Assessment workspace"
            className="sticky top-0 z-20 grid shrink-0 border-b border-stone-200 bg-paper/95 backdrop-blur dark:border-[#25304D] dark:bg-[#090E1C]/95"
            style={{ gridTemplateColumns: `repeat(${mobileTabs.length}, minmax(0, 1fr))` }}
          >
            {mobileTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`mobile-tab-${tab.id}`}
                aria-selected={mobilePane === tab.id}
                aria-controls={`mobile-panel-${tab.id}`}
                onClick={() => setMobilePane(tab.id)}
                className={`border-r border-stone-200 px-2 py-3 text-xs font-semibold transition-colors last:border-r-0 dark:border-[#25304D] ${
                  mobilePane === tab.id
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                    : 'text-stone-500 hover:bg-white hover:text-ink dark:text-[#AEB7D0] dark:hover:bg-[#11182B] dark:hover:text-[#F4F6FF]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mobilePane === 'problem' && (
            <div
              role="tabpanel"
              id="mobile-panel-problem"
              aria-labelledby="mobile-tab-problem"
              className="min-h-[calc(100dvh-15rem)] overflow-y-auto px-5 py-5 dark:bg-[#0D1426]"
            >
              {problemContent}
            </div>
          )}
          {mobilePane === 'work' && (
            <div
              role="tabpanel"
              id="mobile-panel-work"
              aria-labelledby="mobile-tab-work"
              className="flex min-h-[calc(100dvh-15rem)] flex-col"
            >
              {editorContent}
            </div>
          )}
          {mobilePane === 'console' && (
            <div
              role="tabpanel"
              id="mobile-panel-console"
              aria-labelledby="mobile-tab-console"
              className="flex min-h-[calc(100dvh-15rem)] flex-col bg-canvas/60 dark:bg-[#0D1426]"
            >
              {consoleContent}
            </div>
          )}
          {mobilePane === 'ai' && aiAllowed && (
            <div
              role="tabpanel"
              id="mobile-panel-ai"
              aria-labelledby="mobile-tab-ai"
              className="flex min-h-[calc(100dvh-15rem)] min-w-0 flex-col"
            >
              {aiContent}
            </div>
          )}
        </div>
      )}

      {submitError && (
        <p className="shrink-0 border-t border-flag-100 bg-flag-50 px-4 py-2 text-sm text-flag-700 dark:border-[#25304D] dark:bg-flag-500/10 dark:text-[#F0846A]">
          {submitError}
        </p>
      )}
    </div>
  )
}

// Renders the three run outcomes: unavailable, no-tests, and ran (pass/fail +
// program output). High-level pass counts only — never the hidden tests.
function RunResult({ result }) {
  if (result?.available === false) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-stone-500 dark:text-[#AEB7D0]">
        <Code size={15} className="text-stone-400 dark:text-[#8490AE]" /> Running isn’t available for this screen.
      </p>
    )
  }
  if (!result?.ran) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-stone-500 dark:text-[#AEB7D0]">
        <Code size={15} className="text-stone-400 dark:text-[#8490AE]" />{' '}
        {result?.reason || 'No automated checks to run for this screen. Submit when you’re ready.'}
      </p>
    )
  }
  // IDE-style program run (screens with no hidden tests): show console output + exit code.
  if (result?.mode === 'program') {
    const out = String(result.stdout || '').trim()
    const err = String(result.stderr || '').trim()
    const body = [out, err].filter(Boolean).join('\n')
    const ok = result.exitCode === 0
    return (
      <div>
        <p
          className={`inline-flex items-center gap-2 text-sm font-medium ${
            ok ? 'text-clay-700 dark:text-[#9DA9EF]' : 'text-flag-700 dark:text-[#F0846A]'
          }`}
        >
          {ok ? (
            <Check size={15} className="text-clay-600" />
          ) : (
            <span className="grid h-4 w-4 place-items-center rounded-full bg-flag-100 text-[10px] font-bold text-flag-700 dark:bg-flag-500/20 dark:text-[#F0846A]">
              !
            </span>
          )}
          {result.verdict === 'time_limit'
            ? 'Time limit exceeded'
            : ok
              ? 'Ran successfully'
              : `Exited with code ${result.exitCode}`}
          {typeof result.durationMs === 'number' && (
            <span className="font-normal text-stone-400 dark:text-[#8490AE]">· {result.durationMs} ms</span>
          )}
        </p>
        {body ? (
          <pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-ink/90 px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-100">
            {body}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-stone-500">
            No output. Add <code>console.log(...)</code> to print something.
          </p>
        )}
      </div>
    )
  }
  // Structured per-case screens (LeetCode-style): show each SAMPLE case (input/expected/your output).
  // Hidden cases never run here — they run when the candidate submits.
  if (result?.kind === 'cases') {
    return (
      <div>
        <TestCaseResults result={result} />
        <p className="mt-2 text-xs text-stone-500 dark:text-[#8490AE]">
          These are the sample cases. The hidden tests run when you submit.
        </p>
      </div>
    )
  }
  const total = Number(result.total) || 0
  const passed = Number(result.passedCount ?? (result.passed ? total : 0)) || 0
  const allPass = total > 0 ? passed >= total : Boolean(result.passed)
  const out = String(result.stdout || '').trim()
  const err = String(result.stderr || '').trim()
  const body = [out, err].filter(Boolean).join('\n')
  return (
    <div>
      <p
        className={`inline-flex items-center gap-2 text-sm font-medium ${
          allPass ? 'text-clay-700 dark:text-[#9DA9EF]' : 'text-flag-700 dark:text-[#F0846A]'
        }`}
      >
        {allPass ? (
          <Check size={15} className="text-clay-600" />
        ) : (
          <span className="grid h-4 w-4 place-items-center rounded-full bg-flag-100 text-[10px] font-bold text-flag-700 dark:bg-flag-500/20 dark:text-[#F0846A]">
            !
          </span>
        )}
        {result.verdict === 'time_limit'
          ? 'Time limit exceeded'
          : total > 0
            ? `${passed}/${total} checks passing`
            : allPass
              ? 'Checks passed'
              : 'Ran. See output'}
        {typeof result.durationMs === 'number' && (
          <span className="font-normal text-stone-400 dark:text-[#8490AE]">· {result.durationMs} ms</span>
        )}
      </p>
      {body && (
        <pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-ink/90 px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-100">
          {body}
        </pre>
      )}
    </div>
  )
}
