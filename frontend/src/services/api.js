// Thin fetch wrapper around the Touchstones backend (/api/...).
//
// - Base URL comes from VITE_API_URL (default http://localhost:3001).
// - Every request carries `Authorization: Bearer <token>` when a token getter
//   is registered (see setAuthTokenGetter, called from AuthContext).
// - Responses are parsed as JSON; non-2xx throws an Error carrying the server's
//   `error` message and the HTTP status, so screens can show real feedback.
//
// The typed helpers below map 1:1 to the real backend routes:
//   proof.js     -> /api/proof/...      (author, assign, submit, score, audit)
//   integrity.js -> /api/integrity/...  (client-attested behavioral events)

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// Registered by AuthContext so api.js stays free of a hard dependency on the
// auth store. Returns the current Supabase access token (or null when signed out).
let getToken = () => null
export function setAuthTokenGetter(fn) {
  getToken = typeof fn === 'function' ? fn : () => null
}

// Registered by AuthContext. Called on a 401 to force a Supabase session refresh (the
// background auto-refresh timer does not fire while a laptop sleeps, so a resumed tab can
// hold an expired access token). Returns the fresh token or null.
let refreshToken = async () => null
export function setAuthTokenRefresher(fn) {
  refreshToken = typeof fn === 'function' ? fn : async () => null
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

// Whether an error is worth offering a "Try again" for: transient transport
// failures (status 0 = network/timeout), request timeout, rate limit, or any
// 5xx. Terminal 4xx (auth, validation, not-found) are not retryable.
export function isRetryable(err) {
  const s = err && typeof err.status === 'number' ? err.status : null
  return s === 0 || s === 408 || s === 429 || (s !== null && s >= 500)
}

async function request(path, { method = 'GET', body, headers, signal, timeout = 45000, _isRetry = false } = {}) {
  const token = getToken()

  // Wrap fetch with a timeout + a uniform error shape. Without this, a network
  // failure (offline/DNS/CORS) rejects with a bare TypeError that carries no
  // `.status`, and a hung backend never settles — so callers cannot reliably
  // drive an error+retry UI. We normalise both into ApiError(status 0).
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  let timedOut = false
  const timer =
    timeout > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeout)
      : null

  let res
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    // Caller intentionally cancelled (e.g. AiAssistPanel abort) — preserve the
    // original AbortError so existing cancel handling keeps working.
    if (signal && signal.aborted && !timedOut) throw err
    if (timedOut) throw new ApiError('Request timed out — please try again.', 0, null)
    throw new ApiError('Network error — check your connection and try again.', 0, null)
  } finally {
    if (timer) clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onCallerAbort)
  }

  // Some endpoints (audit export) set a JSON content-type with a download
  // disposition; others may return empty bodies. Parse defensively.
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    // Expired session rail: one forced refresh + retry. Without this, a tab resumed after
    // sleep keeps its expired access token and every call banners "Invalid or expired token"
    // until a manual reload.
    if (res.status === 401 && token && !_isRetry) {
      const fresh = await refreshToken().catch(() => null)
      if (fresh && fresh !== token) {
        return request(path, { method, body, headers, signal, timeout, _isRetry: true })
      }
    }
    const message =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      (typeof data === 'string' && data) ||
      `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }
  return data
}

export const api = {
  request,
  baseUrl: API_URL,

  // --- Public marketing assistant ("Ask Touchstones" chatbox) ---
  assistantChat(message, history) {
    return request('/assistant/chat', { method: 'POST', body: { message, history } })
  },

  // --- Auth provider separation ---

  // Which auth providers an email already signed up with:
  // { exists: boolean, providers: string[] } (e.g. ['google'], ['email']).
  // Signup uses this to stop a password signup on a Google-only account.
  providerPrecheck(email) {
    return request('/auth/provider-precheck', { method: 'POST', body: { email } })
  },
  // Undo Supabase's automatic linking of a just-signed-in Google identity onto an
  // older email/password account (authed). Returns { unlinked: boolean }.
  unlinkMislinked() {
    return request('/auth/unlink-mislinked', { method: 'POST' })
  },

  // --- Proof-of-skill workflow (recruiter) ---

  // Author a role-specific, AI-allowed work sample + rubric.
  // body: { title, prompt_md, rubric:{ criteria:[{ id, requirement, points_possible, weight? }] },
  //         role_family?, response_type?, duration_minutes?, scoring_strategy? }
  authorWorkSample(body) {
    return request('/proof/work-samples', { method: 'POST', body })
  },

  getWorkSample(id) {
    return request(`/proof/work-samples/${id}`)
  },


  // Delete a screen (owner-scoped; cascades its submissions/scores/audit/credentials).
  // Returns { deleted:true, id }. 404 for a non-owner OR pre-merge (route not live).
  deleteWorkSample(id) {
    return request(`/proof/work-samples/${id}`, { method: 'DELETE' })
  },

  // Assign a work sample to a candidate -> creates a submission (with deadline).
  assignWorkSample(workSampleId, candidateId) {
    return request(`/proof/work-samples/${workSampleId}/assign`, {
      method: 'POST',
      body: { candidate_id: candidateId },
    })
  },

  // --- Candidate ---

  // Load the assigned task + submission. Returns { submission, work_sample }.
  getSubmission(id) {
    return request(`/proof/submissions/${id}`)
  },

  // Deliberately start an assigned screen (the start gate's button): stamps started_at,
  // flips status to in_progress, and sets deadline_at only if it was null. Idempotent;
  // a repeat call returns the already-started submission. Returns { submission }.
  // avConsent: required (as body { av_consent: true }) when the screen has av_required;
  // the server 400s with code 'av_consent_required' otherwise. Nothing is ever recorded.
  startSubmission(submissionId, { avConsent } = {}) {
    return request(`/proof/submissions/${submissionId}/start`, {
      method: 'POST',
      body: avConsent === true ? { av_consent: true } : undefined,
    })
  },

  // Decline an assigned screen before starting it (the start gate's quiet opt-out).
  // Pre-start only: the server 409s once the screen has started; repeat declines are
  // idempotent. The optional reason goes to the hiring team. Returns { submission }.
  declineSubmission(submissionId, reason) {
    return request(`/proof/submissions/${submissionId}/decline`, {
      method: 'POST',
      body: { reason: reason || null },
    })
  },

  // Submit a candidate response. Pass response_text (markdown) or response_code.
  // deliverablesCheck: the checked deliverables-item indexes (self-check state); the server
  // stamps them into submission metadata for the recruiter's review. Never a gate.
  submitResponse(submissionId, { responseText, responseCode, deliverablesCheck } = {}) {
    const body = { response_text: responseText ?? null, response_code: responseCode ?? null }
    if (Array.isArray(deliverablesCheck) && deliverablesCheck.length) {
      body.deliverables_check = deliverablesCheck
    }
    return request(`/proof/submissions/${submissionId}/submit`, { method: 'POST', body })
  },

  // --- Scoring + result (recruiter/system) ---

  // Run the candidate's code against the screen's hidden tests in an isolated sandbox.
  // Returns { available, ran, passed, passedCount, failedCount, total, stdout, stderr }
  // or { available: false } when code execution isn't configured for this deployment.
  // No args → runs the STORED submission code (recruiter ExecutionPanel).
  // Pass { files } (or { responseCode }) to run the candidate's CURRENT editor
  // code pre-submit. The test COMMAND is always the screen's stored tests.command
  // server-side — only the files come from the body. Returns one of:
  //   { available:true, ran:true, passed, passedCount, failedCount, total, stdout, stderr }
  //   { available:true, ran:false, reason }            (screen has no tests)
  //   { available:false, error }                       (code exec not configured)
  runSubmission(submissionId, { responseCode, files, language, stdin } = {}) {
    const base = files ? { files } : responseCode != null ? { response_code: responseCode } : undefined
    // Pass the candidate's chosen language so the no-hidden-tests "Run" path can pick the right
    // runtime (node / python3 / javac / g++ / …). Ignored when the screen has its own test command.
    let body = base && language ? { ...base, language } : base
    // Optional custom stdin for the program run (no-hidden-tests path).
    if (body && typeof stdin === 'string' && stdin.length) body = { ...body, stdin }
    return request(`/proof/submissions/${submissionId}/run`, { method: 'POST', body, timeout: 120000 })
  },

  // Compare the candidate to a one-shot AI solution on the same hidden tests.
  // Returns { available, ran, candidate:{passed,total}, baseline:{passed,total}, delta }.
  runBaseline(submissionId) {
    return request(`/proof/submissions/${submissionId}/baseline`, { method: 'POST', timeout: 120000 })
  },


  // Read a persisted proof_scores row by id.
  getScore(scoreId) {
    return request(`/proof/scores/${scoreId}`)
  },

  // Recruiter: timestamped activity timeline for a submission (events + AI prompts + milestones)
  // with a summary header. Returns { screen, summary, items:[{ ts, kind, label, detail }] }.
  getActivityTimeline(submissionId) {
    return request(`/proof/submissions/${submissionId}/timeline`)
  },

  // Immutable audit record (also downloadable). Returns the audit JSON object.
  getScoreAudit(scoreId) {
    return request(`/proof/scores/${scoreId}/audit.json`)
  },

  // Recruiter: record a human correction of a score ("adjust this score"). Writes the
  // human_override label on the LIVE proof_scores row; the model's normalized_score is
  // untouched (the model-vs-human disagreement is the training signal). Returns the
  // updated proof_scores row.
  overrideScore(scoreId, { humanScore, overrideReason } = {}) {
    return request(`/proof/scores/${scoreId}/override`, {
      method: 'POST',
      body: { human_score: humanScore, override_reason: overrideReason },
    })
  },


  // --- Integrity (client-attested behavioral signals) ---
  //
  // These are DISPLAY-ONLY hints from the browser; the server independently
  // attributes the trustworthy ones into the tamper-evident hash chain.
  // events: [{ type, category?, meta?, client_ts? }]
  sendIntegrityEvents(submissionId, events) {
    return request('/integrity/events', {
      method: 'POST',
      body: { submission_id: submissionId, events },
    })
  },

  getIntegrityDigest(submissionId) {
    return request(`/integrity/submissions/${submissionId}/digest`)
  },

  // --- Cross-session signals (recruiter REVIEW only, non-biometric) ---
  //
  // Explainable flags when a recruiter's submissions from DIFFERENT candidates share a
  // coarse device/network context. Owner-gated server-side; a non-owner / candidate gets
  // 404. Returns { submission_id, flags:[{kind, detail, severity}], correlated:[...] };
  // empty arrays when clean. Display this as a quiet "worth a look" prompt, never a verdict.
  getCorrelations(submissionId) {
    return request(`/integrity/submissions/${submissionId}/correlations`)
  },

  // --- Verified session (optional, ADR-001 Phase 2 — CONSENT ONLY; no media leaves the browser) ---
  //
  // Consent is recorded server-side per modality (fail-closed) BEFORE any capture; Phase 2 records
  // the decision only — recordings never upload (Phase 3). Base: /verified-session (be-build).
  // modality: 'camera' | 'microphone' | 'walkthrough_recording'; the typed tier needs NO consent.

  // Current consent copy + version to render and echo back on a grant (fail-closed version check).
  getVerifiedSessionConsentCopy() {
    return request('/verified-session/consent-copy')
  },

  // Record a per-modality consent decision. consent_version is required when decision === 'granted'.
  recordVerifiedSessionConsent(submissionId, { modality, decision, consentVersion } = {}) {
    return request('/verified-session/consent', {
      method: 'POST',
      body: { submission_id: submissionId, modality, decision, consent_version: consentVersion },
    })
  },

  // --- Direct the AI (candidate in-app assist + recruiter direction scoring) ---
  //
  // The candidate's in-app AI. The backend auto-logs BOTH turns (the candidate's
  // prompt and the assistant's reply) to the replay transcript, so directing the
  // AI well is itself part of the measured signal. Requires the candidate to be
  // signed in (the Supabase token rides along automatically). Returns { reply, seq }.
  aiAssist(submissionId, message, { signal, code, language } = {}) {
    return request(`/proof/submissions/${submissionId}/ai-assist`, {
      method: 'POST',
      body: { message, ...(code ? { code } : {}), ...(language ? { language } : {}) },
      signal,
      timeout: 120000,
    })
  },

  // The full replay transcript, oldest-first.
  // Returns { interactions: [{ seq, role, content, disposition, client_ts }] }.
  getAiInteractions(submissionId) {
    return request(`/proof/submissions/${submissionId}/ai-interactions`)
  },

  // What the candidate did with an AI suggestion: accepted | edited | rejected.
  // Recorded on the assistant turn; feeds the direction-quality replay.
  setAiDisposition(submissionId, seq, disposition) {
    return request(`/proof/submissions/${submissionId}/ai-interactions/${seq}/disposition`, {
      method: 'PATCH',
      body: { disposition },
    })
  },

  // Recruiter triggers AI-direction scoring; computed in code from the transcript.
  // Returns { status, prompt_quality, error_catching, verification_rigor,
  //           direction_score, reasoning, interaction_count }.
  scoreDirection(submissionId) {
    return request(`/proof/submissions/${submissionId}/score-direction`, {
      method: 'POST',
      timeout: 120000,
    })
  },

  // Read the latest ai_direction_scores row for a submission.
  getDirection(submissionId) {
    return request(`/proof/submissions/${submissionId}/direction`)
  },

  // Mint a fresh, non-shareable task variant for a work sample. Pass a `seed`
  // to reproduce a specific variant; omit it for a new random one. Returns the
  // persisted variant row plus the rendered `prompt_md` text.
  makeVariant(workSampleId, seed) {
    return request(`/proof/work-samples/${workSampleId}/variant`, {
      method: 'POST',
      body: seed !== undefined && seed !== null ? { seed } : {},
    })
  },

  // --- Outcome flywheel (recruiter labels downstream results) ---


  // Upsert outcome labels for a submission. body: { advanced?, got_offer?,
  // hired?, retained_90d?, notes? } — each tri-state (true | false | null).
  setOutcome(submissionId, body) {
    return request(`/outcomes/submissions/${submissionId}`, { method: 'POST', body })
  },

  // --- Client review portal (recruiter client collaboration) ---

  // Recruiter: client review invites, shared/internal comments, and decisions for a submission.
  getClientReviews(submissionId) {
    return request(`/client-reviews/submissions/${submissionId}`)
  },
  // Recruiter: create a token-gated client review link. Returns { invite, review_url, email_sent }.
  createClientReviewInvite(submissionId, body) {
    return request(`/client-reviews/submissions/${submissionId}/invites`, { method: 'POST', body })
  },
  // Recruiter: rotate and resend the token-gated client review link.
  resendClientReview(inviteId) {
    return request(`/client-reviews/invites/${inviteId}/resend`, { method: 'POST' })
  },
  // Recruiter: revoke the current public review link.
  revokeClientReview(inviteId) {
    return request(`/client-reviews/invites/${inviteId}/revoke`, { method: 'POST' })
  },
  // Recruiter: add a shared or internal comment on a review invite.
  createClientReviewComment(inviteId, body) {
    return request(`/client-reviews/invites/${inviteId}/comments`, { method: 'POST', body })
  },
  // Public client: load a token-gated review summary.
  getPublicClientReview(token) {
    return request(`/client-reviews/public/${encodeURIComponent(token)}`)
  },
  // Public client: add a shared comment.
  createPublicClientReviewComment(token, body) {
    return request(`/client-reviews/public/${encodeURIComponent(token)}/comments`, { method: 'POST', body })
  },
  // Public client: submit a structured recommendation.
  submitPublicClientReviewDecision(token, body) {
    return request(`/client-reviews/public/${encodeURIComponent(token)}/decision`, { method: 'POST', body })
  },


  // --- Verified credentials ---

  // Mint a shareable, publicly verifiable credential for a scored submission.
  // Returns { public_token, verify_url, ... }.
  issueCredential(submissionId) {
    return request(`/credentials/submissions/${submissionId}/issue`, {
      method: 'POST',
    })
  },

  // PUBLIC — no auth. Resolve a credential by its public token.
  // Returns { valid, score, direction_score, issued_at }.
  verifyCredential(token) {
    return request(`/credentials/verify/${encodeURIComponent(token)}`)
  },

  // PUBLIC — no auth. Richer verification: the basic fields PLUS a LIVE re-check of the
  // immutable audit chain (chain_consistent) and how many teams have accepted it
  // (accepted_count). Returns { valid, score, direction_score, issued_at, digest_hash,
  // accepted_count, chain_consistent }. PII-free.
  verifyCredentialFull(token) {
    return request(`/credentials/${encodeURIComponent(token)}/verify`)
  },

  // --- Billing (Stripe Checkout) ---

  // Create a Stripe Checkout Session for a subscription tier and return its hosted
  // URL. Requires the caller to be signed in (the Supabase token rides along). The
  // server resolves plan -> Price, so the frontend only sends the plan name.
  // plan: 'startup' | 'growth'. Returns { url }.
  createCheckoutSession(plan) {
    return request('/payments/checkout', { method: 'POST', body: { plan } })
  },

  // Current plan + free-tier screen meter for the signed-in workspace.
  // Returns { plan: 'free'|'startup'|'growth'|…, limit, used, remaining }.
  // The free-tier gate counts *verified screens this month* (metered at send),
  // so `remaining <= 0` on the free plan means the next invite will be blocked.
  getPaymentsUsage() {
    return request('/payments/usage')
  },

  // Open the Stripe Billing Portal ("Manage subscription"). Returns { url } to
  // redirect to. 400 when the account has no Stripe customer yet (free / never
  // subscribed); 503 when billing is unconfigured; 404 pre-merge (route not live).
  createPortalSession() {
    return request('/payments/portal', { method: 'POST' })
  },

  // --- Assessment templates (position library + recruiter custom) ---

  // List the library (public, position-based) plus the caller's own templates.
  // Optional position filter (e.g. 'frontend', 'backend', 'data_ml', …).
  listAssessments(position) {
    const qs = position ? `?position=${encodeURIComponent(position)}` : ''
    return request(`/assessments${qs}`)
  },
  // Create a custom template (always private to the creator).
  createAssessment(body) {
    return request('/assessments', { method: 'POST', body })
  },
  updateAssessment(id, body) {
    return request(`/assessments/${id}`, { method: 'PUT', body })
  },
  // Clone a library/owned template into a new editable, recruiter-owned copy.
  cloneAssessment(id) {
    return request(`/assessments/${id}/clone`, { method: 'POST' })
  },

  // --- Candidate invites + recruiter activity ---

  // Email a candidate the link to a screen (they self-serve from there).
  // Returns { ok, link, email_sent, email_error, invited: { email } }.
  inviteCandidate(workSampleId, email, message) {
    return request(`/proof/work-samples/${workSampleId}/invite`, {
      method: 'POST',
      body: { email, message },
    })
  },
  // Recent submissions across the recruiter's screens (the activity timeline).
  getActivity() {
    return request('/proof/activity')
  },
  // Invite funnel across the recruiter's screens, grouped per screen.
  // Returns { screens: [{ work_sample_id, title, sent, started, submitted, scored,
  //   invites: [{ email, status: 'invited'|'started'|'submitted'|'scored',
  //   invited_at, submitted_at }] }], totals: { sent, started, submitted, scored } }.
  getInvitesOverview() {
    return request('/proof/work-samples/invites/overview')
  },

  // --- Team seats / invite (Phase 4 — shared workspace) ---

  // The caller's workspace members + pending invites.
  // Returns { members: [{ id, email, name, role, status, invited_at, accepted_at }] }.
  getTeam() {
    return request('/collab/team')
  },
  // Invite a teammate by email (sends them an accept link). Returns { member, emailed }.
  inviteTeammate(email) {
    return request('/collab/team/invite', { method: 'POST', body: { email } })
  },
  // Bind the signed-in account to a workspace via the one-time invite token.
  acceptTeamInvite(token) {
    return request('/collab/team/accept', { method: 'POST', body: { token } })
  },
  // Owner removes a member (or revokes a pending invite) by row id.
  removeTeammate(id) {
    return request(`/collab/team/${id}`, { method: 'DELETE' })
  },

  // --- Recruiter access request (candidate → hiring-team upgrade) ---
  //
  // A signed-in candidate asks for recruiter access. Self-promotion is DB-blocked,
  // so this routes through the backend, which sets recruiter_status none→pending
  // (or returns 'verified' if an invite already cleared them). All fields optional.
  // body: { company?, work_email?, role_title?, note? } → { recruiter_status }.
  requestRecruiterAccess(payload) {
    return request('/portal/request-recruiter', { method: 'POST', body: payload })
  },
  // My account/role status: { account_type, recruiter_status, is_admin }.
  getPortalStatus() {
    return request('/portal/status')
  },
  // Founder-only: the pending recruiter-access queue + approve/reject.
  getRecruiterRequests() {
    return request('/portal/admin/recruiter-requests')
  },
  approveRecruiter(userId, decision = 'verify') {
    return request('/portal/admin/approve-recruiter', { method: 'POST', body: { user_id: userId, decision } })
  },

  // --- Candidate portal (the signed-in candidate's own data) ---
  //
  // Each of these is candidate-scoped server-side (RLS + the /portal guard), so a
  // recruiter or a different candidate can never see another person's assignments,
  // results, or credentials. The candidate's OWN credential score is theirs to show.

  // Assigned screens, grouped by lifecycle:
  // { groups: { pending:[], in_progress:[], completed:[], expired:[] }, total }.
  getMyAssignments() {
    return request('/portal/assignments')
  },
  // Completed screens + (when minted) the shareable credential:
  // { results: [{ id, status, submitted_at, screen, credential: { verify_url, issued_at } | null }] }.
  getMyResults() {
    return request('/portal/results')
  },
  // Issued credentials the candidate can share/verify:
  // { credentials: [{ id, issued_at, score, direction_score, verify_url, screen }] }.
  getMyCredentials() {
    return request('/portal/credentials')
  },
  // Full export of the candidate's own data (parsed JSON; the Profile page wraps it
  // in a client-side Blob download). GDPR/portability self-serve.
  getMyData() {
    return request('/portal/export')
  },
  // Permanent account deletion. Requires the literal confirm string; the server
  // 409s if the caller is a recruiter / owns screens (can't self-delete those).
  deleteMyAccount() {
    return request('/portal/delete-account', { method: 'POST', body: { confirm: 'DELETE' } })
  },

  // --- Notifications (shared; candidate bell + future recruiter use) ---
  // GET /notifications → array of { id, type, title, message, data, read, created_at }.
  getNotifications() {
    return request('/notifications')
  },
  // GET /notifications/unread-count → { count } (we read defensively either way).
  getUnreadCount() {
    return request('/notifications/unread-count')
  },
  markNotificationRead(id) {
    return request(`/notifications/${id}/read`, { method: 'PUT' })
  },
  markAllNotificationsRead() {
    return request('/notifications/read-all', { method: 'PUT' })
  },

  // --- Verify API: developer console (api keys / usage / logs) ---

  // List the account's API keys (masked — full key only ever shown at create/rotate).
  listApiKeys() {
    return request('/keys')
  },
  // --- Ashby Assessments integration: the OUTBOUND Ashby API key (stored encrypted; never returned). ---
  getAshbySettings() {
    return request('/integrations/ashby/settings')
  },
  setAshbyKey(api_key) {
    return request('/integrations/ashby/settings', { method: 'PUT', body: { api_key } })
  },
  clearAshbyKey() {
    return request('/integrations/ashby/settings', { method: 'DELETE' })
  },
  // --- Greenhouse Assessments integration: the per-org Assessment API key (raw shown ONCE at
  // --- mint) + the Harvest v3 Partner OAuth connection. 404s until the feature flag is on. ---
  getGreenhouseAssessmentKey() {
    return request('/integrations/greenhouse/assessment-key')
  },
  mintGreenhouseAssessmentKey() {
    return request('/integrations/greenhouse/assessment-key', { method: 'POST' })
  },
  clearGreenhouseAssessmentKey() {
    return request('/integrations/greenhouse/assessment-key', { method: 'DELETE' })
  },
  startGreenhouseOAuth() {
    return request('/integrations/greenhouse/oauth/start', { method: 'POST' })
  },
  getGreenhouseOAuthStatus() {
    return request('/integrations/greenhouse/oauth/status')
  },
  disconnectGreenhouseOAuth() {
    return request('/integrations/greenhouse/oauth', { method: 'DELETE' })
  },
  // Create a key. mode: 'live' | 'test'. Returns { key (full plaintext, ONCE), api_key (masked) }.
  createApiKey(name, mode) {
    return request('/keys', { method: 'POST', body: { name, mode } })
  },
  // Rotate: revoke the old key + mint a fresh one. Returns { key (full, ONCE), api_key }.
  rotateApiKey(id) {
    return request(`/keys/${id}/rotate`, { method: 'POST' })
  },
  // Revoke a key (soft delete).
  deleteApiKey(id) {
    return request(`/keys/${id}`, { method: 'DELETE' })
  },
  // Per-day, per-endpoint call counts (default 30-day window).
  getApiUsage(days) {
    const qs = days ? `?days=${encodeURIComponent(days)}` : ''
    return request(`/keys/usage${qs}`)
  },
  // Recent /v1 verifications for the account (the "Logs" view).
  getApiVerifications(limit) {
    const qs = limit ? `?limit=${encodeURIComponent(limit)}` : ''
    return request(`/keys/verifications${qs}`)
  },

  // --- Verify API: outbound webhook endpoints (developer console) ---

  // List webhook endpoints (+ signing secret, owner-only) and the set of valid events.
  listWebhookEndpoints() {
    return request('/keys/webhooks')
  },
  // Create an endpoint. body: { url, description?, enabled_events? }.
  createWebhookEndpoint(body) {
    return request('/keys/webhooks', { method: 'POST', body })
  },
  // Update url / description / enabled_events / status ('active'|'disabled').
  updateWebhookEndpoint(id, body) {
    return request(`/keys/webhooks/${id}`, { method: 'PATCH', body })
  },
  // Issue a fresh signing secret for an endpoint.
  rotateWebhookSecret(id) {
    return request(`/keys/webhooks/${id}/rotate-secret`, { method: 'POST' })
  },
  // Send a one-off webhook.test event to confirm connectivity. Returns { test:{ ok, ... } }.
  testWebhookEndpoint(id) {
    return request(`/keys/webhooks/${id}/test`, { method: 'POST' })
  },
  // Delete an endpoint (cascades its delivery log).
  deleteWebhookEndpoint(id) {
    return request(`/keys/webhooks/${id}`, { method: 'DELETE' })
  },
  // Recent delivery attempts across the account's endpoints.
  getWebhookDeliveries(limit) {
    const qs = limit ? `?limit=${encodeURIComponent(limit)}` : ''
    return request(`/keys/webhooks/deliveries${qs}`)
  },

  // --- Verify API: public OpenAPI contract (no auth; served at /v1/openapi.json) ---
  // Note: this hits /v1 directly (NOT /api), so it bypasses the /api request() helper.
  async getOpenApiSpec() {
    const res = await fetch(`${API_URL}/v1/openapi.json`)
    if (!res.ok) throw new ApiError(`Could not load API spec (${res.status})`, res.status)
    return res.json()
  },
  // Base URL for the public /v1 surface (used by the sandbox + docs cURL examples).
  verifyBaseUrl: `${API_URL}/v1`,

  // --- Live AI Probe (S1, cc1) — appended ---
  // Recruiter (authed): start/resume a probe for a submission; read the latest / a specific probe.
  startProbe(submissionId) {
    return request(`/interview/submissions/${submissionId}/probe/start`, { method: 'POST', timeout: 60000 })
  },
  getLatestProbe(submissionId) {
    return request(`/interview/submissions/${submissionId}/latest-probe`)
  },
  // Candidate (public token — no auth; request() sends no Authorization header when signed out).
  getProbeByToken(token) {
    return request(`/interview/probe/by-token/${token}`)
  },
  answerProbe(token, answer) {
    return request(`/interview/probe/by-token/${token}/answer`, { method: 'POST', body: { answer }, timeout: 60000 })
  },
  // Ephemeral Azure Speech token so the candidate can DICTATE their answer (browser streams mic → Azure
  // directly; audio never touches our backend). 404 when the speech walkthrough flag is off — the caller
  // treats that as "mic unavailable" and simply hides the button.
  getProbeSpeechToken(token) {
    return request(`/interview/probe/by-token/${token}/speech-token`)
  },
  // --- Author with AI (CC2/S2 — generate a screen from a JD or repo) ---
  //
  // Generate a DRAFT work-sample (NOT persisted) from a job description. The recruiter
  // edits it, then saves via authorWorkSample() (the normal create flow). Returns
  // { draft: { title, role, role_family, language, languages, response_type, task,
  //   duration_minutes, ai_allowed, rubric:[{label,points,requirement}], starter_files,
  //   hidden_tests, test_summary, input_kind } }.
  // body: { jd, language?, difficulty? }
  generateScreenFromJD(body) {
    return request('/screen-gen/from-jd', { method: 'POST', body, timeout: 120000 })
  },
  // Same, from a repo URL or pasted code snippet. body: { repo_url?, snippet?, language?, difficulty? }.
  generateScreenFromRepo(body) {
    return request('/screen-gen/from-repo', { method: 'POST', body, timeout: 120000 })
  },

  // --- July MVP buildout skeletons (flag-gated backend surface) ---
  getMvpRoadmap() {
    return request('/mvp-skeleton/roadmap')
  },
  getMvpReviewQueue() {
    return request('/mvp-skeleton/review-queue')
  },
  getMvpAnalytics() {
    return request('/mvp-skeleton/analytics')
  },
  getMvpReadiness() {
    return request('/mvp-skeleton/readiness')
  },
  getMvpPilotPlan() {
    return request('/mvp-skeleton/pilot-plan')
  },
  getAshbyPolishChecklist() {
    return request('/mvp-skeleton/ashby-polish')
  },
  resendClientReviewSkeleton(inviteId) {
    return request(`/mvp-skeleton/client-reviews/${inviteId}/resend`, { method: 'POST' })
  },
  sendCandidateReminderSkeleton(submissionId) {
    return request(`/mvp-skeleton/candidate-reminders/${submissionId}`, { method: 'POST' })
  },
  extendCandidateDeadline(submissionId, minutes = 1440) {
    return request(`/mvp-skeleton/candidate-deadlines/${submissionId}/extend`, {
      method: 'POST',
      body: { minutes },
    })
  },
  createDecisionPacketSkeleton(submissionId) {
    return request(`/mvp-skeleton/decision-packets/${submissionId}`, { method: 'POST' })
  },
  getDecisionPacket(submissionId) {
    return request(`/mvp-skeleton/decision-packets/${submissionId}`)
  },
  // --- Touchstones Passport (S4): portable credential profile + accept-prior network ---
  // PUBLIC: a candidate's shareable passport by handle → { handle, display_name, headline, entries[] }.
  getPassport(handle) {
    return request(`/passport/${encodeURIComponent(handle)}`)
  },
  // The signed-in user's OWN passport + all entries (incl hidden) → { passport, entries }.
  getMyPassport() {
    return request('/passport')
  },
  // Claim a handle. body { handle, display_name?, headline? } → { passport }.
  createPassport(body) {
    return request('/passport', { method: 'POST', body })
  },
  // Update display_name / headline / is_public / handle on my passport.
  updatePassport(body) {
    return request('/passport', { method: 'PATCH', body })
  },
  // Add one of my verified results to my passport — by credential_id OR verify token.
  addPassportEntry({ credentialId, token } = {}) {
    return request('/passport/entries', { method: 'POST', body: { credential_id: credentialId, token } })
  },
  updatePassportEntry(id, body) {
    return request(`/passport/entries/${id}`, { method: 'PATCH', body })
  },
  deletePassportEntry(id) {
    return request(`/passport/entries/${id}`, { method: 'DELETE' })
  },
  // Recruiter accepts a credential for a req → { accepted, accepted_count }.
  acceptCredential(token, reqLabel) {
    return request(`/credentials/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: { req_label: reqLabel || null },
    })
  },

  // --- Compliance & Adverse-Impact (CC1 v3) — appended ---
  // Roles available for analysis + the opt-in label summary + selectable outcomes.
  getComplianceRoles() {
    return request('/compliance/roles')
  },
  // Role-level defensibility export (rubric + per-decision lines).
  getComplianceRoleExport(role) {
    return request(`/compliance/export/role/${encodeURIComponent(role)}`)
  },
  // Attach/upload OPT-IN group labels (voluntary, segregated, never affect scoring).
  // labels: [{ submission_id, attribute, value }].
  attachComplianceLabels(labels) {
    return request('/compliance/labels', { method: 'POST', body: { labels } })
  },
  // EEOC four-fifths analysis for a role → group rates, impact ratios, 0.8 flag, insufficient_data.
  getAdverseImpact(role, { attribute, outcome } = {}) {
    const qs = new URLSearchParams()
    if (attribute) qs.set('attribute', attribute)
    if (outcome) qs.set('outcome', outcome)
    return request(`/compliance/adverse-impact/role/${encodeURIComponent(role)}?${qs.toString()}`)
  },
  // --- CC2: Hiring Analytics & ROI (the /app/insights proof-of-value surface) ---
  // All account-scoped real aggregates. `opts` = { role, days } where days is a
  // number or 'all'. Helpers below build the query string and hit /api/analytics/insights/*.

  // Pipeline funnel (created→started→submitted→scored→advanced→offer→hired→stayed-90d).
  getInsightsFunnel({ role, days } = {}) {
    return request(`/analytics/insights/funnel${insightsQS({ role, days })}`)
  },
  // Throughput: time-to-submit/score/decision medians + per-day volume series.
  getInsightsThroughput({ role, days } = {}) {
    return request(`/analytics/insights/throughput${insightsQS({ role, days })}`)
  },
  // ROI: senior-eng hours saved + cost-per-qualified, recomputed from the user's
  // editable assumptions × real counts. Returns { inputs, counts, results, basis }.
  getInsightsRoi({ role, days, hoursPerOnsite, hourlyCost } = {}) {
    return request(`/analytics/insights/roi${insightsQS({ role, days, hoursPerOnsite, hourlyCost })}`)
  },
  // Per-role score distribution (histogram + percentiles + outcome bands), reusing
  // the calibration engine. Pass `score` to get the candidate's "your bar" marker.
  getInsightsDistribution(role, { score } = {}) {
    const seg = encodeURIComponent(role || '_all')
    return request(`/analytics/insights/distribution/${seg}${insightsQS({ score })}`)
  },
  // The account's role families (drives the role filter).
  getInsightsRoles() {
    return request('/analytics/insights/roles')
  },
  // --- Candidate Network / "Apply with Touchstones" (CC3/v3) ---
  // PUBLIC: redacted req context for the /apply/:token page → { valid, req }.
  getReqPublic(token) {
    return request(`/network/apply/${encodeURIComponent(token)}`)
  },
  // Candidate applies with one of THEIR OWN verified credentials → { application }.
  // body { req_token, credential_id? | token?, note? } (ownership enforced server-side via RLS).
  applyWithCredential({ reqToken, credentialId, token, note } = {}) {
    return request('/network/apply', {
      method: 'POST',
      body: { req_token: reqToken, credential_id: credentialId, token, note: note || null },
    })
  },
  // Candidate dashboard: my verified credentials + network signal (reuse / accepted-by-N).
  getNetworkCredentials() {
    return request('/network/credentials')
  },
  // Candidate dashboard: my applications + their req context + accepted state.
  getMyApplications() {
    return request('/network/applications')
  },
  withdrawApplication(id) {
    return request(`/network/applications/${id}`, { method: 'DELETE' })
  },
  // Employer side: create an open req → { req, apply_url }.
  createReq(body) {
    return request('/network/reqs', { method: 'POST', body })
  },
  // Employer side: my reqs + application counts + apply links.
  getMyReqs() {
    return request('/network/reqs')
  },
  updateReq(id, body) {
    return request(`/network/reqs/${id}`, { method: 'PATCH', body })
  },
  // Employer inbox: applications to one of my reqs (verified credential summaries).
  getReqApplications(id) {
    return request(`/network/reqs/${id}/applications`)
  },
  // Employer accepts an application without re-screening → { accepted, accepted_count }.
  acceptApplication(id) {
    return request(`/network/applications/${id}/accept`, { method: 'POST' })
  },
}

// Build a query string from defined, non-empty params (drops null/undefined/'').
function insightsQS(params) {
  const qs = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return qs ? `?${qs}` : ''
}

export default api
