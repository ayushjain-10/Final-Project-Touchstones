import { useEffect, useState } from 'react'
import ScoreRing from './ScoreRing.jsx'
import CriterionBar from './CriterionBar.jsx'
import { api } from '../services/api.js'
import { Sparkle, ChevronRight, Clock } from './icons.jsx'

// "How they directed the AI" — surfaces the new direction signal on the result.
//
// The three sub-dimensions (prompt quality / error catching / verification rigor)
// roll up into one direction_score. We render them as CriterionBar rows with the
// model's reasoning shown as TEXT. An expandable replay lists the captured
// transcript (role-labeled, text only — NEVER dangerouslySetInnerHTML).
//
// The replay reads as a REPLAY: a conversation timeline (candidate prompts vs AI
// replies) with relative timing from the first message, and a CLAY HIGHLIGHT on
// the moments where the candidate appears to catch / verify / redirect the AI.
// Those moments are Touchstones' most ownable signal, so we surface them — but
// only ever as an honest HEURISTIC hint, never a verdict or certainty claim.
// The highlight fires on disposition correction signals (edited / rejected) and
// on lightweight case-insensitive keyword cues in the CANDIDATE's own messages.
//
// Props:
//   submissionId — required to fetch/compute the direction score and transcript.
//   direction    — optional pre-loaded direction row (Result lifts this fetch so
//                  the DecisionCard and this panel share ONE request); when given
//                  we render it directly and skip the mount fetch.
const SUBDIMENSIONS = [
  {
    key: 'prompt_quality',
    label: 'Prompt quality',
    note: 'How clearly and specifically they directed the AI.',
  },
  {
    key: 'error_catching',
    label: 'Error catching',
    note: "Whether they noticed and corrected the AI's mistakes.",
  },
  {
    key: 'verification_rigor',
    label: 'Verification rigor',
    note: 'How thoroughly they checked the AI before trusting it.',
  },
]

export default function DirectionPanel({ submissionId, direction: directionProp }) {
  const seeded = directionProp && hasScore(directionProp) ? directionProp : null
  const [direction, setDirection] = useState(seeded)
  // Only self-fetch when the parent didn't already hand us a scored row.
  const [loading, setLoading] = useState(!seeded && Boolean(submissionId))
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState(null)

  const [showReplay, setShowReplay] = useState(false)
  const [interactions, setInteractions] = useState(null)
  const [loadingReplay, setLoadingReplay] = useState(false)
  const [replayError, setReplayError] = useState(null)

  // Best-effort load of any existing direction score on mount — skipped when the
  // parent already seeded us with one (Result lifts this fetch to share it).
  useEffect(() => {
    if (seeded) {
      setDirection(seeded)
      setLoading(false)
      return
    }
    if (!submissionId) return
    let active = true
    setLoading(true)
    api
      .getDirection(submissionId)
      .then((row) => {
        if (active && row && hasScore(row)) setDirection(row)
      })
      .catch(() => {
        /* No score yet is the expected first-load state — show the CTA. */
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [submissionId, seeded])

  async function runScore() {
    if (!submissionId) return
    setScoring(true)
    setError(null)
    try {
      const row = await api.scoreDirection(submissionId)
      setDirection(row)
    } catch (e) {
      setError(e?.message || 'Could not score AI direction.')
    } finally {
      setScoring(false)
    }
  }

  async function toggleReplay() {
    const next = !showReplay
    setShowReplay(next)
    if (next && interactions === null && !loadingReplay) {
      setLoadingReplay(true)
      setReplayError(null)
      try {
        const res = await api.getAiInteractions(submissionId)
        const rows = Array.isArray(res?.interactions) ? res.interactions : []
        setInteractions(rows)
      } catch (e) {
        setReplayError(e?.message || 'Could not load the AI replay.')
      } finally {
        setLoadingReplay(false)
      }
    }
  }

  const score = direction ? Math.round(Number(direction.direction_score) || 0) : null
  const interactionCount =
    direction?.interaction_count ??
    (Array.isArray(interactions) ? interactions.length : null)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 font-serif text-base font-semibold text-ink">
          <Sparkle size={16} className="text-clay-500" /> How they directed the AI
        </h3>
        {interactionCount != null && (
          <span className="text-xs text-stone-400">
            {interactionCount} interaction{interactionCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-stone-500">
        AI was allowed. We measure how well they prompted it, caught its mistakes, and verified
        its output — computed in code from the captured replay, not asserted by the model.
      </p>

      {loading ? (
        <p className="mt-5 text-sm text-stone-400">Loading AI-direction score…</p>
      ) : !direction ? (
        // No score yet — recruiter triggers the in-code scoring pass.
        <div className="mt-5 rounded-xl border border-dashed border-stone-300 bg-canvas/50 px-4 py-5 text-center">
          <p className="text-sm text-stone-600">
            AI direction hasn’t been scored for this submission yet.
          </p>
          <button
            onClick={runScore}
            disabled={scoring}
            className="btn-primary mt-3 px-4 py-2 text-xs disabled:opacity-60"
          >
            <Sparkle size={14} /> {scoring ? 'Scoring…' : 'Score AI direction'}
          </button>
          {error && (
            <p className="mt-3 rounded-lg bg-flag-50 px-3 py-2 text-xs text-flag-700 ring-1 ring-flag-100">
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Headline direction score + sub-dimensions */}
          <div className="mt-5 flex items-center gap-5">
            <ScoreRing value={score} size={104} stroke={9} suffix="/100" />
            <div className="min-w-0 flex-1 space-y-3.5">
              {SUBDIMENSIONS.map((d, i) => {
                // Prefer the per-dimension points when the API returns the
                // breakdown; fall back to the flat sub-score field.
                const pct = clampPct(direction.per_dimension?.[d.key]?.points ?? direction[d.key])
                return (
                  <CriterionBar
                    key={d.key}
                    label={d.label}
                    points={`${pct} / 100`}
                    pct={pct}
                    delay={i * 90}
                  />
                )
              })}
            </div>
          </div>

          {/* Per-dimension breakdown: the model's evidence for each dimension
              when the API returns it, else the static descriptor as a fallback. */}
          <ul className="mt-4 space-y-1.5">
            {SUBDIMENSIONS.map((d) => {
              const evidence = direction.per_dimension?.[d.key]?.evidence
              return (
                <li key={d.key} className="flex gap-2 text-xs leading-relaxed text-stone-500">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-clay-400" />
                  <span>
                    <span className="font-medium text-ink">{d.label}:</span> {evidence || d.note}
                  </span>
                </li>
              )
            })}
          </ul>

          {/* Reasoning — rendered as TEXT only. */}
          {direction.reasoning && (
            <div className="mt-4 rounded-xl bg-canvas/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                Why this score
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{direction.reasoning}</p>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-flag-50 px-3 py-2 text-xs text-flag-700 ring-1 ring-flag-100">
              {error}
            </p>
          )}

          {/* Expandable AI replay */}
          <button
            onClick={toggleReplay}
            aria-expanded={showReplay}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-clay-700 hover:text-clay-800"
          >
            <ChevronRight
              size={14}
              className={`transition-transform ${showReplay ? 'rotate-90' : ''}`}
            />
            {showReplay ? 'Hide AI replay' : 'View AI replay'}
          </button>

          {showReplay && (
            <div className="mt-3 rounded-xl border border-stone-200 bg-canvas/40 p-3">
              {loadingReplay ? (
                <p className="py-3 text-center text-xs text-stone-400">Loading transcript…</p>
              ) : replayError ? (
                <p className="rounded-lg bg-flag-50 px-3 py-2 text-xs text-flag-700 ring-1 ring-flag-100">
                  {replayError}
                </p>
              ) : interactions && interactions.length > 0 ? (
                <ReplayTimeline interactions={interactions} direction={direction} />
              ) : (
                <p className="py-3 text-center text-xs text-stone-400">
                  No AI interactions were recorded for this submission.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Keyword cues we treat as candidate-driven correction / verification moments.
// Case-insensitive substring match on the CANDIDATE's own message text. Each
// group maps to the chip we surface; ordering is the priority if several hit.
// These are HEURISTICS — they hint at a moment, they do not assert one happened.
const HIGHLIGHT_CUES = [
  // Catching a mistake / asserting the AI is off.
  { kind: 'caught', label: 'caught it', terms: ["wrong", "that's not", 'thats not', "doesn't handle", 'does not handle', 'edge case', 'fix'] },
  // Checking / asking the AI to prove itself.
  { kind: 'verified', label: 'verified', terms: ['verify', 'are you sure', 'add a test', 'double-check', 'double check'] },
  // Steering the AI in a new direction.
  { kind: 'redirected', label: 'redirected', terms: ['actually', 'instead', 'rather'] },
]

// Honest heuristic: does this CANDIDATE turn look like an error-catch / verify
// / redirect moment? Combines the server's disposition (an edited/rejected AI
// turn is a correction signal) with lightweight keyword cues on user text.
// Returns null for non-candidate turns and for turns with no signal.
function detectHighlight(interaction) {
  if (interaction?.role !== 'user') return null
  const text = typeof interaction.content === 'string' ? interaction.content.toLowerCase() : ''

  for (const cue of HIGHLIGHT_CUES) {
    if (cue.terms.some((t) => text.includes(t))) {
      return { kind: cue.kind, label: cue.label, reason: 'keyword' }
    }
  }

  // disposition lives on the AI turn server-side, but we also honor it if it
  // rides on a candidate turn — an edit/reject is a clear correction signal.
  const d = interaction.disposition
  if (d === 'edited') return { kind: 'redirected', label: 'redirected', reason: 'disposition' }
  if (d === 'rejected') return { kind: 'caught', label: 'caught it', reason: 'disposition' }

  return null
}

// Parse a client_ts into epoch ms, tolerating numbers, numeric strings, and
// ISO strings. Returns null when unusable so timing degrades quietly.
function toMs(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null
  const n = Number(ts)
  if (Number.isFinite(n) && String(ts).trim() !== '') return n
  const parsed = Date.parse(ts)
  return Number.isNaN(parsed) ? null : parsed
}

// "04:12" elapsed since the first message. null when we can't compute it.
function relTime(ms, baseMs) {
  if (ms == null || baseMs == null) return null
  const delta = Math.max(0, Math.round((ms - baseMs) / 1000))
  const m = Math.floor(delta / 60)
  const s = delta % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// The replay body: a compact sub-score header (when present) + the conversation
// timeline. The highlight count is framed as a heuristic, never a verdict.
function ReplayTimeline({ interactions, direction }) {
  // Earliest usable timestamp anchors the relative clock.
  const baseMs = interactions.reduce((min, it) => {
    const ms = toMs(it?.client_ts)
    if (ms == null) return min
    return min == null ? ms : Math.min(min, ms)
  }, null)

  const highlights = interactions.map(detectHighlight)
  const highlightCount = highlights.filter(Boolean).length

  const SUB = [
    { key: 'prompt_quality', label: 'Prompt' },
    { key: 'error_catching', label: 'Error catching' },
    { key: 'verification_rigor', label: 'Verification' },
  ]
  const hasSubScores = direction && SUB.some((s) => direction[s.key] != null)

  return (
    <div>
      {hasSubScores && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-stone-200/70 pb-3">
          {SUB.map((s) =>
            direction[s.key] != null ? (
              <span
                key={s.key}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] text-stone-600 ring-1 ring-stone-200"
              >
                {s.label}
                <span className="font-semibold text-ink">{clampPct(direction[s.key])}</span>
              </span>
            ) : null,
          )}
        </div>
      )}

      {highlightCount > 0 && (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-clay-50 px-2.5 py-1 text-[11px] text-clay-700 ring-1 ring-clay-200">
          <Sparkle size={12} className="text-clay-500" />
          {highlightCount} possible error-catch / verify moment{highlightCount === 1 ? '' : 's'}
          <span className="text-clay-500">— heuristic, review the replay</span>
        </p>
      )}

      <ol className="space-y-2.5">
        {interactions.map((it, i) => (
          <ReplayRow
            key={it.seq ?? i}
            interaction={it}
            highlight={highlights[i]}
            time={relTime(toMs(it?.client_ts), baseMs)}
          />
        ))}
      </ol>
    </div>
  )
}

// A single transcript entry. Role-labeled; content is plain text only. When the
// turn looks like a candidate error-catch / verify / redirect moment we tint it
// clay and add a small chip — surfaced as a heuristic highlight, not a verdict.
function ReplayRow({ interaction, highlight, time }) {
  const isUser = interaction.role === 'user'
  const isHighlight = Boolean(highlight)
  return (
    <li
      className={`rounded-lg text-sm ${
        isHighlight
          ? 'border-l-2 border-clay-400 bg-clay-50/60 py-1.5 pl-2.5 pr-1.5'
          : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isUser ? 'bg-clay-50 text-clay-700 ring-1 ring-clay-200' : 'bg-stone-100 text-stone-600'
          }`}
        >
          {isUser ? 'Candidate' : 'AI'}
        </span>
        {time && (
          <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-stone-400">
            <Clock size={11} className="text-stone-400" />
            {time}
          </span>
        )}
        {isHighlight && (
          <span className="inline-flex items-center gap-1 rounded-full bg-clay-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-clay-700 ring-1 ring-clay-300">
            <Sparkle size={10} className="text-clay-600" />
            {highlight.label}
          </span>
        )}
        {interaction.disposition && (
          <span className="text-[10px] text-stone-400">{interaction.disposition}</span>
        )}
      </div>
      {/* TEXT only — never dangerouslySetInnerHTML. */}
      <TranscriptText content={interaction.content} />
    </li>
  )
}

// Long assistant turns (a full generated document or file) would otherwise swallow the
// transcript; clamp anything past ~700 chars behind a Show more toggle. Content stays
// plain text.
const CLAMP_CHARS = 700
function TranscriptText({ content }) {
  const [expanded, setExpanded] = useState(false)
  const text = typeof content === 'string' ? content : ''
  const isLong = text.length > CLAMP_CHARS
  const shown = expanded || !isLong ? text : text.slice(0, CLAMP_CHARS)
  return (
    <div className="mt-1">
      <p className="whitespace-pre-wrap break-words leading-relaxed text-stone-700">
        {shown}
        {isLong && !expanded && <span className="text-stone-400">…</span>}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-semibold text-clay-700 underline-offset-2 hover:underline"
        >
          {expanded ? 'Show less' : `Show more (${Math.ceil(text.length / 1000)}k characters)`}
        </button>
      )}
    </div>
  )
}

function clampPct(v) {
  const n = Math.round(Number(v) || 0)
  return Math.max(0, Math.min(100, n))
}

function hasScore(row) {
  return row && (row.direction_score != null || row.prompt_quality != null)
}
