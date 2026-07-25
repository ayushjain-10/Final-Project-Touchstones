import ScoreRing from './ScoreRing.jsx'
import {
  Sparkle,
  FileText,
  Check,
  Eye,
  ArrowRight,
  ShieldCheck,
} from './icons.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// DecisionCard — the recruiter's ONE legible verdict, fused at the top of the
// result view.
//
// Touchstones reports work quality, how well the candidate directed the AI, and
// session-integrity context. The recommendation uses the work and AI-direction
// signals. Session context remains separate and never changes the band.
//
// COMPLIANCE POSTURE (load-bearing, do not soften):
//   • Session integrity is reviewer context, never identity or authorship proof.
//     We surface signals; we do not infer intent.
//   • The card RECOMMENDS, it never auto-rejects. The worst it ever says is
//     "Needs a closer look" — a prompt to a human, not a verdict on the person.
//   • Session context never changes the work recommendation.
//
// Props (all reuse data the Result page already loaded — no fetches in here):
//   score     — { score: number 0-100, criteria?: [{ label, points, pct }] }
//               The already-mapped work-score object (toResultCardData output).
//   direction — { direction_score, prompt_quality, error_catching,
//               verification_rigor } | null   (AI-direction; may be unscored)
//   digest    — integrity digest: { summary?: { typed_fraction, paste_count,
//               tab_hidden_count, window_blur_count, bot_verdict }, verified_chain,
//               ide_activity? } | null         (may be missing entirely)
//   onAnchor  — optional (sectionId) => void, called when a signal tile is
//               clicked so the page can scroll to the matching detail panel.
// ─────────────────────────────────────────────────────────────────────────────

// ── Fusion thresholds (named + documented so the logic is auditable) ──────────

// Work score (0-100) bands. These mirror the rubric pass bar most teams use.
const WORK_STRONG_MIN = 75 // at/above → strong work signal
const WORK_MIXED_MIN = 55 // at/above (below STRONG) → mixed; under this → weak

// AI-direction score (0-100) bands — how well they prompted, caught errors,
// and verified the AI. Direction is a quality signal, not a gate.
const DIR_STRONG_MIN = 70 // at/above → directed the AI well
const DIR_MIXED_MIN = 45 // at/above (below STRONG) → mixed; under → weak

// Session-context inputs from the integrity digest summary.
// Each is a soft signal; we combine them into high / mixed / low review context.
const TYPED_HIGH_MIN = 0.6 // ≥60% typed in-editor → consistent with hands-on work
const TYPED_LOW_MAX = 0.3 // <30% typed → mostly pasted; lower confidence
const TAB_HIDDEN_WANDER = 6 // > this many tab switches → attention wandered
const WINDOW_BLUR_WANDER = 8 // > this many window blurs → attention wandered
const LARGE_PASTE_NOTABLE = 1 // ≥ this many large pastes → worth a human glance

// ── Session context (high | mixed | low) ─────────────────────────────────────
//
// Returns a CONFIDENCE band + a plain-English read. NEVER an accusation.
// "low" means "we couldn't strongly confirm a human did this unaided — look
// closer", not "this is a bot".
function sessionContext(digest) {
  if (!digest || !digest.summary) {
    return {
      band: 'unknown',
      label: 'No session record',
      read: 'No session-integrity context was recorded for this submission.',
    }
  }
  const s = digest.summary
  const ide = readIdeActivity(digest)
  const largePastes = Number(ide?.largePasteCount) || 0

  const typed = typeof s.typed_fraction === 'number' ? s.typed_fraction : null
  const wandered =
    (s.tab_hidden_count || 0) > TAB_HIDDEN_WANDER ||
    (s.window_blur_count || 0) > WINDOW_BLUR_WANDER

  // A server-observed automation signal or a broken integrity chain are the
  // strongest "look closer" pulls — but still expressed as LOW CONFIDENCE,
  // never as a "bot" label.
  const automationSignal = s.bot_verdict === true
  const chainBroken = digest.verified_chain === false

  // Score the confidence-lowering signals.
  let lowering = 0
  if (typed != null && typed < TYPED_LOW_MAX) lowering += 2
  else if (typed != null && typed < TYPED_HIGH_MIN) lowering += 1
  if (wandered) lowering += 1
  if (largePastes >= LARGE_PASTE_NOTABLE) lowering += 1
  if (automationSignal) lowering += 3
  if (chainBroken) lowering += 3

  if (lowering >= 3) {
    return {
      band: 'low',
      label: 'Review suggested',
      read: automationSignal
        ? 'A server-observed automation signal should be reviewed with the work evidence.'
        : chainBroken
          ? 'The integrity record could not be fully verified and should be reviewed.'
          : 'Heavy pasting or repeated attention shifts are reviewer context.',
    }
  }
  if (lowering >= 1) {
    return {
      band: 'mixed',
      label: 'Context to review',
      read: 'The session is mostly consistent, with a few signals worth reviewing.',
    }
  }
  return {
    band: 'high',
    label: 'Consistent session',
    read:
      typed != null
        ? `The work trail shows ${Math.round(typed * 100)}% typed in-editor with steady focus.`
        : 'The recorded work trail is internally consistent.',
  }
}

// ── Per-signal tiers (work / direction) ───────────────────────────────────────

function workTier(score) {
  const n = clamp100(score)
  if (n >= WORK_STRONG_MIN) return 'strong'
  if (n >= WORK_MIXED_MIN) return 'mixed'
  return 'weak'
}

function directionTier(direction) {
  if (!direction || direction.direction_score == null) return 'unknown'
  const n = clamp100(direction.direction_score)
  if (n >= DIR_STRONG_MIN) return 'strong'
  if (n >= DIR_MIXED_MIN) return 'mixed'
  return 'weak'
}

// ── The fusion: ONE recommendation band ───────────────────────────────────────
//
// Logic, in plain English:
//   1. Start from the WORK signal (the core of the screen): strong / mixed / weak.
//   2. AI-direction can only NUDGE: strong direction can lift a mixed-work case
//      up; weak direction can pull a strong-work case down to "review". Missing
//      direction is neutral (we simply don't have it yet).
//   3. Session-integrity context is displayed separately. It never changes the
//      recommendation level or produces a hiring outcome.
//
// Returns one of three bands. The card RECOMMENDS — it never auto-rejects.
function fuseRecommendation({ workTierV, dirTierV }) {
  // Map work tier to a base level: 2 = strong, 1 = mixed, 0 = needs a look.
  let level = workTierV === 'strong' ? 2 : workTierV === 'mixed' ? 1 : 0

  // AI-direction nudges by at most one level, and only when we have it.
  if (dirTierV === 'strong' && level === 1) level = 2 // strong direction lifts mixed work
  if (dirTierV === 'weak' && level === 2) level = 1 // weak direction tempers strong work

  if (level >= 2) {
    return {
      key: 'strong',
      band: 'Strong evidence',
      blurb:
        'The work and AI-direction signals are strong. The session record adds context for a reviewer.',
      tone: BAND_TONE.strong,
    }
  }
  if (level === 1) {
    return {
      key: 'mixed',
      band: 'Review suggested',
      blurb:
        'The work shows useful signal, with one or two areas a reviewer should inspect.',
      tone: BAND_TONE.mixed,
    }
  }
  return {
    key: 'review',
    band: 'More evidence needed',
    blurb:
      'The evidence is incomplete or below the rubric bar. A reviewer should inspect the work before deciding.',
    tone: BAND_TONE.review,
  }
}

// Warm-palette tones per band (clay = good, amber = caution — never red/green).
const BAND_TONE = {
  strong: {
    chip: 'bg-clay-50 text-clay-700 ring-clay-200',
    bar: 'bg-clay-500',
    ring: 'ring-clay-200',
    surface: 'from-clay-50/70',
    icon: Check,
  },
  mixed: {
    chip: 'bg-amber-50 text-amber-700 ring-amber-100',
    bar: 'bg-amber-500',
    ring: 'ring-amber-100',
    surface: 'from-amber-50/60',
    icon: Eye,
  },
  review: {
    chip: 'bg-stone-100 text-stone-700 ring-stone-200',
    bar: 'bg-stone-400',
    ring: 'ring-stone-200',
    surface: 'from-stone-100/70',
    icon: Eye,
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DecisionCard({ score, direction, digest, onAnchor }) {
  const workScore = clamp100(score?.score)
  const dirScore =
    direction && direction.direction_score != null
      ? clamp100(direction.direction_score)
      : null

  const human = sessionContext(digest)
  const workTierV = workTier(workScore)
  const dirTierV = directionTier(direction)

  // Graceful degradation: when BOTH direction and digest are missing we still
  // render the band, but quieter — we say so plainly rather than overstating.
  const partial = dirScore == null || human.band === 'unknown'

  const rec = fuseRecommendation({ workTierV, dirTierV })
  const Icon = rec.tone.icon

  const tiles = [
    {
      id: 'work',
      icon: FileText,
      label: 'Work quality',
      value: `${workScore}`,
      suffix: '/100',
      read: WORK_READ[workTierV],
      anchor: 'work-score',
    },
    {
      id: 'direction',
      icon: Sparkle,
      label: 'AI-direction',
      value: dirScore != null ? `${dirScore}` : '—',
      suffix: dirScore != null ? '/100' : null,
      read:
        dirScore != null ? DIR_READ[dirTierV] : 'Not scored yet — open the panel to run it.',
      anchor: 'direction-panel',
    },
    {
      id: 'human',
      icon: ShieldCheck,
      label: 'Session context',
      value: human.label,
      suffix: null,
      read: human.read,
      anchor: 'integrity-panel',
    },
  ]

  function go(anchor) {
    if (typeof onAnchor === 'function') onAnchor(anchor)
  }

  return (
    <div className={`card overflow-hidden ring-1 ${rec.tone.ring}`}>
      {/* Hero band — the fused recommendation */}
      <div className={`bg-gradient-to-br ${rec.tone.surface} to-transparent px-6 py-6`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <ScoreRing value={workScore} size={120} stroke={10} />
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
              <ShieldCheck size={13} className="text-clay-500" /> Recommendation
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-base font-semibold ring-1 ${rec.tone.chip}`}
              >
                <Icon size={16} /> {rec.band}
              </span>
              {partial && (
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200">
                  Partial signals
                </span>
              )}
            </div>
            {/* All copy below is static / derived — never raw model HTML. */}
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-600">{rec.blurb}</p>
            <p className="mt-2 text-xs leading-relaxed text-stone-400">
              Calculated in code from work quality and AI direction. Human reviewers make every
              hiring decision. Session signals remain separate context and never determine the outcome.
            </p>
          </div>
        </div>
      </div>

      {/* Three signal tiles — each anchors to its detailed panel below */}
      <div className="grid gap-px border-t border-stone-200 bg-stone-200 sm:grid-cols-3">
        {tiles.map((t) => {
          const TileIcon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.anchor)}
              className="group flex flex-col gap-1.5 bg-canvas px-5 py-4 text-left transition-colors hover:bg-clay-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay-300"
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-stone-500">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                  <TileIcon size={14} />
                </span>
                {t.label}
              </span>
              <span className="flex items-baseline gap-1">
                <span className="font-serif text-2xl font-semibold leading-none text-ink tabular-nums">
                  {t.value}
                </span>
                {t.suffix && <span className="text-xs text-stone-400">{t.suffix}</span>}
              </span>
              <p className="text-xs leading-relaxed text-stone-500">{t.read}</p>
              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-clay-700 opacity-0 transition-opacity group-hover:opacity-100">
                See the detail <ArrowRight size={12} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Plain-English reads keyed by tier ─────────────────────────────────────────

const WORK_READ = {
  strong: 'Meets or clears the rubric bar.',
  mixed: 'Solid in places, gaps in others.',
  weak: 'Below the rubric bar on key criteria.',
}

const DIR_READ = {
  strong: 'Prompted, corrected, and verified the AI well.',
  mixed: 'Directed the AI unevenly — some gaps.',
  weak: 'Leaned on the AI with little direction.',
  unknown: 'Not scored yet — open the panel to run it.',
}

// ── helpers ───────────────────────────────────────────────────────────────────

function clamp100(v) {
  const n = Math.round(Number(v) || 0)
  return Math.max(0, Math.min(100, n))
}

// Mirror of IntegrityActivityPanel's defensive reader: the ide_activity rollup
// can live under a few keys depending on backend version. Used here only to read
// the large-paste count as a confidence signal.
function readIdeActivity(digest) {
  if (!digest) return null
  const candidate =
    digest.ide_activity || digest.summary?.ide_activity || digest.activity?.ide || null
  if (!candidate || typeof candidate !== 'object') return null
  return candidate
}
