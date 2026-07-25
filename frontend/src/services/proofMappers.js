// Adapters between the backend proof payloads and the shapes the existing
// presentational components (ResultCard, CriterionBar, VerifiedBadge) expect.
// Keeping the mapping here means the screens stay thin and the visual system
// is untouched.

// Turn a machine-formatted criterion key (snake_case / kebab / camelCase, e.g.
// "root_cause", "fix_quality") into a human Title Case label at render time. The stored
// rubric/score data is untouched. Labels that already read as prose (contain a space)
// are left exactly as authored, so nice recruiter labels never get re-cased.
function humanizeLabel(s) {
  if (typeof s !== 'string' || /\s/.test(s)) return s
  const words = s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : s
}

// Map a per-criterion entry (server) -> the rubric criterion the recruiter
// authored, so we can show human-friendly labels next to the awarded points.
function criterionLabel(rubricCriteria, id) {
  const c = (rubricCriteria || []).find((x) => x.id === id)
  return humanizeLabel(c?.label || c?.requirement || id)
}

// Map the integrity digest summary to a session assurance badge state.
// Advisory only: paste and hidden-tab signals can suggest review, while a positive
// bot verdict adds an integrity flag. These signals never make the hiring decision.
export function verificationStateFromDigest(digest) {
  if (!digest) return 'review'
  const s = digest.summary || {}
  if (s.bot_verdict === true) return 'flagged'
  if (digest.verified_chain === false) return 'flagged'
  // S4-2: require positive behavioral evidence to award 'verified'. No usable keystroke
  // telemetry, such as typed_fraction null from a programmatic submit, falls back to
  // 'review', never the strongest badge. Fail closed. Keep byte-identical to the backend
  // proofOfHumanFromDigest (passportService.js) so the live card and passport snapshot match.
  if (typeof s.typed_fraction !== 'number') return 'review'
  const heavyPaste = s.typed_fraction < 0.5
  const wandered = (s.tab_hidden_count || 0) > 5 || (s.window_blur_count || 0) > 8
  if (heavyPaste || wandered) return 'review'
  return 'verified'
}

// Build the `data` object ResultCard consumes from the persisted score row
// (GET /proof/scores/:id) or the scoreSubmission() return, plus context
// (work sample, submission, integrity digest) when available.
export function toResultCardData(score, { workSample, submission, digest } = {}) {
  const rubricCriteria = workSample?.rubric?.criteria || []
  const per = score?.per_criterion || []

  const criteria = per.map((pc) => {
    const possible = Number(pc.points_possible) || 0
    const awarded = Number(pc.points_awarded) || 0
    const pct = possible > 0 ? Math.round((100 * awarded) / possible) : 0
    return {
      label: criterionLabel(rubricCriteria, pc.id),
      points: `${awarded} / ${possible}`,
      pct,
      note: pc.explanation || pc.evidence_quote || '',
      verdict: pc.verdict,
      evidence: pc.evidence_quote || '',
    }
  })

  const outcome = score?.outcome
  const verdict =
    outcome === 'advance'
      ? 'Strong evidence'
      : outcome === 'reject'
        ? 'Review against the hiring bar'
        : 'Evidence scored'

  const durationMin =
    submission?.started_at && submission?.submitted_at
      ? Math.max(
          0,
          Math.round(
            (new Date(submission.submitted_at) - new Date(submission.started_at)) / 60000,
          ),
        )
      : null

  return {
    role: workSample?.role_family || workSample?.title || 'Work sample',
    reqId: (submission?.id || score?.submission_id || score?.id || '').slice(0, 8) || 'N/A',
    task: workSample?.title || 'Real-work task',
    candidate: submission?.candidate_id
      ? `Candidate ${String(submission.candidate_id).slice(0, 4).toUpperCase()}`
      : 'Candidate',
    score: Number(score?.normalized_score ?? 0),
    verdict,
    verification: verificationStateFromDigest(digest),
    durationMin,
    aiNote:
      workSample?.ai_allowed === false
        ? 'Independent work: the in-browser AI assistant was disabled for this screen.'
        : 'AI allowed: directing and verifying it is part of the signal.',
    criteria,
    reasoning: [
      score?.overall_explanation,
      'AI evaluates each criterion against the work evidence. The weighted total is calculated in code and provenance-logged.',
    ]
      .filter(Boolean)
      .join(' '),
    evidence: criteria
      .filter((c) => c.evidence)
      .slice(0, 3)
      .map((c) => c.evidence),
    injectionFlag: Boolean(score?.injection_flag),
    scoreVariance: score?.score_variance,
  }
}
