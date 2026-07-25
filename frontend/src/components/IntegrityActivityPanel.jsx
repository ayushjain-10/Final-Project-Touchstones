import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import {
  Code,
  Eye,
  Clock,
  FileText,
  ChevronRight,
  ShieldCheck,
  Link,
} from './icons.jsx'

// "Integrity & activity" — neutral behavioral signals for the recruiter.
//
// Touchstones lets candidates use AI and do real work. This panel SHOWS what
// happened (paste-vs-typed, tab focus, time-on-task, and — when the in-browser
// IDE captured it — keystroke/paste/file activity), with brief context. It is
// deliberately NOT a verdict: anti-arms-race means show, don't police. Every
// number is presented as an honest signal a human reviewer can weigh.
//
// Data source: api.getIntegrityDigest(submissionId). The response carries an
// aggregate `summary` (server-observed counters) and MAY carry a client-attested
// `ide_activity` rollup from the new editor. Both are optional — if the endpoint
// 404s or returns nothing, we degrade to a quiet "no data yet" rather than crash.
//
// Props:
//   submissionId — required to fetch the digest.
//   digest       — optional pre-loaded digest (Result already fetches one); when
//                  provided we render it directly and skip the extra request.
export default function IntegrityActivityPanel({ submissionId, digest: digestProp }) {
  const [digest, setDigest] = useState(digestProp ?? null)
  // Only self-fetch when the parent didn't already hand us a digest.
  const [loading, setLoading] = useState(!digestProp && Boolean(submissionId))
  const [error, setError] = useState(null)
  // Cross-session correlation signals are recruiter-only and NOT part of the digest, so
  // they're always fetched separately by submissionId. null = not loaded / no access.
  const [correlations, setCorrelations] = useState(null)

  useEffect(() => {
    if (digestProp) {
      setDigest(digestProp)
      setLoading(false)
      return
    }
    if (!submissionId) return
    let active = true
    setLoading(true)
    setError(null)
    api
      .getIntegrityDigest(submissionId)
      .then((d) => {
        if (active) setDigest(d)
      })
      .catch((e) => {
        // A 404 / empty digest is an expected "no signals yet" state, not a
        // page-breaking error — only surface genuine failures.
        if (!active) return
        if (e?.status === 404) setDigest(null)
        else setError(e?.message || 'Could not load activity signals.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [submissionId, digestProp])

  // Load cross-session signals (recruiter-only). A 404 means "not the owner / no access"
  // and an empty result means "clean" — both degrade quietly, never a page error.
  useEffect(() => {
    if (!submissionId) return
    let active = true
    api
      .getCorrelations(submissionId)
      .then((c) => {
        if (active) setCorrelations(c || null)
      })
      .catch(() => {
        // 404 (non-owner / candidate) or any failure: silently show nothing.
        if (active) setCorrelations(null)
      })
    return () => {
      active = false
    }
  }, [submissionId])

  const summary = digest?.summary || null
  const ide = readIdeActivity(digest)
  const hasAnything = Boolean(summary) || Boolean(ide)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-ink">Integrity &amp; activity</h3>
        {digest?.event_count != null && (
          <span className="text-xs text-stone-400">
            {digest.event_count} event{digest.event_count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="mt-2 inline-flex items-start gap-1.5 text-xs leading-relaxed text-stone-500">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-brand-500" />
        <span>
          Session signals are shown, not judged. Read them with the authored AI policy and the
          submitted work; they never determine the outcome.
        </span>
      </p>

      {loading ? (
        <p className="mt-5 text-sm text-stone-400">Loading activity signals…</p>
      ) : error ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
          {error}
        </p>
      ) : !hasAnything ? (
        <p className="mt-5 rounded-xl border border-dashed border-stone-300 bg-canvas/50 px-4 py-5 text-center text-sm text-stone-500">
          No activity signals recorded for this submission yet.
        </p>
      ) : (
        <>
          {summary && <SummarySignals summary={summary} />}
          {ide && <IdeActivity ide={ide} hasSummary={Boolean(summary)} />}
        </>
      )}

      {/* Recruiter-only cross-session signals. Renders only once the owner-gated
          request succeeds (candidates / non-owners get null and see nothing). */}
      {correlations && <CrossSessionSignals correlations={correlations} />}
    </div>
  )
}

// --- Cross-session signals (non-biometric, recruiter REVIEW prompt — never a verdict) ---
//
// Neutral nudges when this candidate's session context (device / network) overlaps with
// OTHER candidates the recruiter screened. We render the backend's already-explainable
// `detail` strings verbatim as TEXT (never HTML), and we deliberately frame everything as
// "worth a look", never an accusation. When clean we show a quiet reassurance line.
function CrossSessionSignals({ correlations }) {
  const flags = Array.isArray(correlations.flags) ? correlations.flags : []
  const correlated = Array.isArray(correlations.correlated) ? correlations.correlated : []
  const reviewCount = flags.filter((f) => f?.severity === 'review').length

  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
          <Link size={14} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Cross-session signals</p>
          <p className="text-[11px] text-stone-400">
            How this session compares to others you&apos;ve screened, as context rather than a verdict.
          </p>
        </div>
      </div>

      {flags.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-stone-300 bg-canvas/50 px-3 py-2.5 text-xs text-stone-500">
          No cross-session signals. Nothing here overlaps with your other candidates.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {flags.map((f, i) => (
              <li
                key={f?.kind || i}
                className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed ring-1 ${
                  f?.severity === 'review'
                    ? 'bg-amber-50 text-amber-800 ring-amber-100'
                    : 'bg-stone-50 text-stone-600 ring-stone-200'
                }`}
              >
                <Eye size={13} className="mt-0.5 shrink-0" />
                {/* Backend strings rendered as TEXT — never injected as HTML. */}
                <span>{f?.detail}</span>
              </li>
            ))}
          </ul>
          {reviewCount > 0 && correlated.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
              Overlaps with {correlated.length} other submission
              {correlated.length === 1 ? '' : 's'}. These are prompts to review, not conclusions.
              A shared office or network can explain them.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// --- Server-observed aggregate counters (the always-present part of a digest) ---

function SummarySignals({ summary: s }) {
  const typedPct =
    typeof s.typed_fraction === 'number' ? Math.round(s.typed_fraction * 100) : null
  const pasteCount = s.paste_count || 0
  const timeHiddenS = Math.round((s.tab_hidden_ms || 0) / 1000)

  const rows = [
    {
      icon: Code,
      label: 'Typed vs. pasted',
      detail:
        typedPct != null
          ? `${typedPct}% typed in-editor, ${100 - typedPct}% pasted across ${pasteCount} paste${pasteCount === 1 ? '' : 's'}.`
          : `${pasteCount} paste event${pasteCount === 1 ? '' : 's'} recorded${
              s.paste_chars ? ` (${s.paste_chars.toLocaleString()} chars)` : ''
            }.`,
      meter: typedPct,
    },
    {
      icon: Eye,
      label: 'Tab & window focus',
      detail: `${s.tab_hidden_count || 0} tab switch${(s.tab_hidden_count || 0) === 1 ? '' : 'es'}, ${
        s.window_blur_count || 0
      } window blur${(s.window_blur_count || 0) === 1 ? '' : 's'} recorded. No intent is inferred.`,
    },
    {
      icon: Clock,
      label: 'Time with tab hidden',
      detail:
        timeHiddenS > 0
          ? `${formatDuration(timeHiddenS * 1000)} total away from the tab.`
          : 'Stayed on the task tab throughout.',
    },
  ]

  return (
    <div className="mt-3 divide-y divide-stone-200">
      {rows.map((r) => (
        <SignalRow key={r.label} {...r} />
      ))}
    </div>
  )
}

function SignalRow({ icon: Icon, label, detail, meter }) {
  return (
    <div className="flex gap-3 py-3.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-ink">{label}</span>
        {/* Backend strings/numbers are rendered as TEXT — never injected as HTML. */}
        <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{detail}</p>
        {typeof meter === 'number' && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-clay-400"
              style={{ width: `${Math.max(0, Math.min(100, meter))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// --- Client-attested in-browser IDE activity (optional, surfaced when present) ---

function IdeActivity({ ide, hasSummary }) {
  const [showFiles, setShowFiles] = useState(false)
  const fileEntries = ide.perFileEditCounts
    ? Object.entries(ide.perFileEditCounts).sort((a, b) => b[1] - a[1])
    : []

  const stats = [
    { label: 'Keystrokes', value: num(ide.totalKeystrokes) },
    { label: 'Active time', value: ide.totalActiveMs ? formatDuration(ide.totalActiveMs) : '—' },
    { label: 'Pastes', value: num(ide.pasteCount ?? ide.pasteEvents?.length) },
    { label: 'Large pastes', value: num(ide.largePasteCount), flag: (ide.largePasteCount || 0) > 0 },
    { label: 'File switches', value: num(ide.fileSwitchCount) },
    { label: 'Files touched', value: num(ide.filesTouched ?? fileEntries.length) },
  ]

  return (
    <div className={`${hasSummary ? 'mt-4 border-t border-stone-200 pt-4' : 'mt-3'}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
          <FileText size={14} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">In-editor activity</p>
          <p className="text-[11px] text-stone-400">
            Self-reported by the candidate&apos;s editor, as context rather than proof.
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((st) => (
          <div
            key={st.label}
            className="rounded-xl border border-stone-200 bg-canvas/40 px-3 py-2.5 text-center"
          >
            <dt className="text-[11px] leading-tight text-stone-500">{st.label}</dt>
            <dd
              className={`mt-0.5 font-serif text-lg font-semibold ${
                st.flag ? 'text-amber-700' : 'text-ink'
              }`}
            >
              {st.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Large pastes are surfaced as neutral context, never an accusation. */}
      {(ide.largePasteCount || 0) > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-100">
          {ide.largePasteCount} large paste{ide.largePasteCount === 1 ? '' : 's'} detected
          {largePasteSizes(ide.pasteEvents)}. Review how the pasted material was adapted within the work.
        </p>
      )}

      {fileEntries.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowFiles((v) => !v)}
            aria-expanded={showFiles}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-clay-700 hover:text-clay-800"
          >
            <ChevronRight
              size={14}
              className={`transition-transform ${showFiles ? 'rotate-90' : ''}`}
            />
            {showFiles ? 'Hide per-file edits' : `Per-file edits (${fileEntries.length})`}
          </button>
          {showFiles && (
            <ul className="mt-2 space-y-1.5">
              {fileEntries.map(([path, count]) => (
                <li key={path} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-mono text-stone-600">{path}</span>
                  <span className="shrink-0 text-stone-400">
                    {count} edit{count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// --- helpers ---

// The digest MAY expose the client-attested ide_activity rollup in a couple of
// shapes depending on backend version. Read it defensively from any of them and
// return null when absent (the panel then simply omits the section).
function readIdeActivity(digest) {
  if (!digest) return null
  const candidate =
    digest.ide_activity ||
    digest.summary?.ide_activity ||
    digest.activity?.ide ||
    null
  if (!candidate || typeof candidate !== 'object') return null
  // Require at least one recognizable field before rendering the section.
  const known = [
    'totalKeystrokes',
    'pasteEvents',
    'pasteCount',
    'largePasteCount',
    'perFileEditCounts',
    'fileSwitchCount',
    'totalActiveMs',
  ]
  return known.some((k) => candidate[k] != null) ? candidate : null
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : '—'
}

function formatDuration(ms) {
  const totalS = Math.round(Number(ms) / 1000)
  if (!Number.isFinite(totalS) || totalS <= 0) return '0s'
  const m = Math.floor(totalS / 60)
  const s = totalS % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

function largePasteSizes(pasteEvents) {
  if (!Array.isArray(pasteEvents)) return ''
  const big = pasteEvents
    .filter((p) => Number(p?.length) > 120)
    .map((p) => Number(p.length))
    .sort((a, b) => b - a)
    .slice(0, 3)
  if (!big.length) return ''
  return ` (${big.map((n) => `${n.toLocaleString()} chars`).join(', ')})`
}
