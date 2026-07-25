/**
 * verifyService — orchestration helpers for the public `/v1/verifications` ingest path.
 * ------------------------------------------------------------------------------------
 * PURE where possible (unit-testable, no I/O in the two functions below). The route layer
 * (routes/supabase/verify.js) drives the 11-step ingest and calls into here to (a) derive the
 * proof-of-human badge state from the integrity digest and (b) assemble the public Verification
 * object that gets persisted into verifications.report.
 *
 * NO forked engine logic lives here: scoring, AI-direction, code-execution, and the digest are
 * all produced by the EXISTING services (proofScoringService / aiDirectionService /
 * codeExecutionService / integrityDigestService) and merely shaped into the public response.
 */

/**
 * deriveProofOfHumanState(digest) → 'verified' | 'needs_review' | 'flagged'
 *
 * Ported from the frontend proofMappers.verificationStateFromDigest, with the ONE rename the spec
 * mandates: 'review' → 'needs_review' (the public API state name). Advisory only — this NEVER
 * auto-rejects; it surfaces a recruiter-review signal.
 *
 *   - no digest                                  → needs_review   (was frontend 'review')
 *   - summary.bot_verdict === true               → flagged        (server-observed bot)
 *   - digest.verified_chain === false            → flagged        (chain broken / forked)
 *   - event_count === 0 (no integrity events)    → needs_review   (evidentiary floor: an
 *     empty chain is zero evidence of a human session, so it can never award 'verified';
 *     it is a human-review flag, never an automated fail)
 *   - typed_fraction < 0.5  (heavy paste)        → needs_review
 *     OR tab_hidden_count > 5 OR window_blur_count > 8 (wandered)
 *   - else                                       → verified
 */
function deriveProofOfHumanState(digest) {
  if (!digest) return 'needs_review';
  const s = digest.summary || {};
  if (s.bot_verdict === true) return 'flagged';
  if (digest.verified_chain === false) return 'flagged';
  if (!digest.event_count) return 'needs_review';
  const heavyPaste = typeof s.typed_fraction === 'number' && s.typed_fraction < 0.5;
  const wandered = (s.tab_hidden_count || 0) > 5 || (s.window_blur_count || 0) > 8;
  if (heavyPaste || wandered) return 'needs_review';
  return 'verified';
}

/**
 * assembleVerification(parts) → the public Verification object (persisted into verifications.report).
 *
 * Shape (verify-api-design.md step 10):
 *   {
 *     id, candidate_ref, mode, status,
 *     proof_of_human: { state, verified_chain, signals, digest },
 *     score | null, ai_direction | null, code_execution | null,
 *     audit_url, report_url, created_at, completed_at
 *   }
 *
 * `score` / `ai_direction` / `code_execution` are the engine returns mapped to the public shape
 * (null when not produced). `digest` carries head_hash (the signable trust digest) + the advisory
 * summary; `signals` is the same summary lifted up for convenience.
 */
function assembleVerification({
  id,
  candidateRef,
  mode,
  status,
  digest,
  proofState,
  score = null,
  aiDirection = null,
  codeExecution = null,
  auditUrl = null,
  reportUrl = null,
  createdAt,
  completedAt = null,
}) {
  const summary = (digest && digest.summary) || {};
  return {
    id,
    candidate_ref: candidateRef ?? null,
    mode,
    status,
    proof_of_human: {
      state: proofState,
      verified_chain: digest ? Boolean(digest.verified_chain) : null,
      signals: summary,
      digest: digest
        ? {
            head_hash: digest.head_hash || null,
            event_count: digest.event_count || 0,
            server_observed_count: digest.server_observed_count || 0,
            summary,
          }
        : null,
    },
    score: score || null,
    ai_direction: aiDirection || null,
    code_execution: codeExecution || null,
    audit_url: auditUrl || null,
    report_url: reportUrl || null,
    created_at: createdAt || null,
    completed_at: completedAt || null,
  };
}

/**
 * Map a proofScoringService.scoreSubmission() success/cached return → the public `score` object.
 * Returns null for the degraded shapes (pending_scoring / needs_review), which the route handles
 * separately (202 enqueue / status flip) before assembly.
 */
function mapScore(result) {
  if (!result || result.status === 'pending_scoring' || result.status === 'needs_review') return null;
  return {
    score: result.normalized_score,
    outcome: result.outcome,
    per_criterion: result.per_criterion || [],
    overall_explanation: result.overall_explanation || '',
    score_variance: result.score_variance,
    injection_flag: Boolean(result.injection_flag),
    cached: Boolean(result.cached),
  };
}

/**
 * Map an aiDirectionService.scoreAiDirection() 'scored' return → the public `ai_direction` object.
 * Returns null for no_interactions / needs_review (omitted from the Verification per the spec).
 */
function mapAiDirection(result) {
  if (!result || result.status !== 'scored') return null;
  return {
    direction_score: result.direction_score,
    prompt_quality: result.prompt_quality,
    error_catching: result.error_catching,
    verification_rigor: result.verification_rigor,
    interaction_count: result.interaction_count,
    reasoning: result.reasoning || '',
  };
}

/**
 * Map a codeExecutionService.runTests() return → the public `code_execution` object.
 * Returns null when execution did not actually run (disabled / no tests / provisioning error).
 */
function mapCodeExecution(result) {
  if (!result || result.ran !== true) return null;
  return {
    passed: Boolean(result.passed),
    passed_count: result.passedCount || 0,
    failed_count: result.failedCount || 0,
    total: result.total || 0,
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
  };
}

module.exports = {
  deriveProofOfHumanState,
  assembleVerification,
  mapScore,
  mapAiDirection,
  mapCodeExecution,
};
