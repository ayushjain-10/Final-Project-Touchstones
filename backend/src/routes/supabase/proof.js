/**
 * Proof-of-Skill routes (Feature 1) — /api/proof/...
 * Recruiter authors a work sample; a candidate completes it; we score it with the
 * rubric grader (proofScoringService) and expose an explainable score + audit trail.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const proofScoringService = require('../../services/proofScoringService');
const scoringQueue = require('../../services/scoringQueue');
const aiDirectionService = require('../../services/aiDirectionService');
const variantService = require('../../services/variantService');
const aiAssistService = require('../../services/aiAssistService');
const spendGuard = require('../../services/spendGuard');
const emailService = require('../../services/emailService');
const emailTemplates = require('../../services/emailTemplates');
const workflowNotify = require('../../services/workflowNotify');
const codeExecutionService = require('../../services/codeExecutionService');
const baselineService = require('../../services/baselineService');
const planLimits = require('../../services/planLimits');
const speechService = require('../../services/speechService');
const { captureException } = require('../../config/observability');
const { isOfferable: verifiedSessionOfferable } = require('./verifiedSession'); // ADR-001 Phase 2 offer gate

router.use(supabaseAuth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Accept a submit that lands this long past deadline_at (flagged late_submission in metadata)
// instead of rejecting with 410. The client auto-submits when its timer hits zero, so network
// latency, tab wake-up, or clock skew must never cost a candidate their finished work.
const LATE_SUBMIT_GRACE_MS = 2 * 60 * 1000;

// --- Deliverables checklist (TOU-146, migration 111) ---
// Sanitize a recruiter-authored deliverables list: strings only, trimmed, empties dropped,
// capped at 8 items of 200 chars each. Returns the clean array or null (null = no checklist,
// so a cleared editor removes the column value). Exported for unit tests.
const DELIVERABLES_MAX_ITEMS = 8;
const DELIVERABLES_MAX_CHARS = 200;
function sanitizeDeliverables(input) {
  if (!Array.isArray(input)) return null;
  const items = input
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim().slice(0, DELIVERABLES_MAX_CHARS))
    .filter(Boolean)
    .slice(0, DELIVERABLES_MAX_ITEMS);
  return items.length ? items : null;
}

// Sanitize the candidate's self-check state (checked item indexes) stamped into submission
// metadata at submit: integers 0..7 only, de-duplicated, sorted. Returns null when nothing
// valid was supplied (so metadata is never touched needlessly). Exported for unit tests.
function sanitizeDeliverablesCheck(input) {
  if (!Array.isArray(input)) return null;
  const idx = [...new Set(
    input
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < DELIVERABLES_MAX_ITEMS),
  )].sort((a, b) => a - b);
  return idx.length ? idx : null;
}

// --- Camera + mic requirement (TOU-147, migration 112) ---
// STANCE: presence signals only. No video or audio is ever recorded, stored, or transmitted;
// the granted MediaStream never leaves the candidate's browser. av_* integrity events are
// review flags for humans, never automated pass/fail.
//
// The consent copy the start gate renders. Hashed server-side (mirroring verifiedSession.js)
// so the proof_consent rows written at Start carry a server-stamped consent_copy_hash the
// client cannot forge. Bump the version whenever this copy changes.
const AV_CONSENT_VERSION = 'av-requirement-1';
const AV_CONSENT_COPY = [
  'This assessment involves your camera and microphone as a presence signal.',
  'Nothing is recorded or stored: no video, no audio, no snapshots ever leave your browser.',
  'Signals (camera or mic turned off, permission revoked) are review flags for a human reviewer, never an automated pass or fail.',
  'You can decline this assessment instead; the hiring team will be notified.',
].join('\n');
const AV_CONSENT_COPY_HASH = crypto.createHash('sha256')
  .update(`${AV_CONSENT_VERSION}\n${AV_CONSENT_COPY}`).digest('hex');

// Pure start-gate check for the AV requirement: when the screen requires camera + mic, the
// start body must carry { av_consent: true }. Returns null when start may proceed, or the
// 400 payload to send back. Exported for unit tests.
function avConsentError(ws, body) {
  if (!ws || ws.av_required !== true) return null;
  if (body && body.av_consent === true) return null;
  return {
    error: 'This screen requires camera and microphone consent to start.',
    code: 'av_consent_required',
  };
}

// Record the AV consent grant at Start: per-modality proof_consent rows (025/088: camera +
// microphone are server-role-only grant rows with a server-stamped copy hash) plus one
// av_consent_granted integrity event on the tamper-evident chain (server_observed: this
// server code is the caller). Best-effort by design: a ledger hiccup must never cost the
// candidate their consented start, so failures are logged and reported to observability,
// not surfaced.
async function recordAvConsent(submission) {
  try {
    const rows = ['camera', 'microphone'].map((modality) => ({
      candidate_id: submission.candidate_id,
      submission_id: submission.id,
      modality,
      decision: 'granted',
      consent_version: AV_CONSENT_VERSION,
      consent_copy_hash: AV_CONSENT_COPY_HASH,
      context: { via: 'av_requirement' },
    }));
    const { error } = await supabaseAdmin.from('proof_consent').insert(rows);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn('av consent ledger write failed (non-blocking):', e.message);
    captureException(e, { stage: 'av_consent_ledger', submission_id: submission.id });
  }
  try {
    const { error } = await supabaseAdmin.rpc('append_integrity_event', {
      p_submission_id: submission.id,
      p_type: 'av_consent_granted',
      p_category: 'av',
      p_meta: { modalities: ['camera', 'microphone'], consent_version: AV_CONSENT_VERSION },
      p_client_ts: null,
      p_source: 'server_observed',
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn('av consent chain append failed (non-blocking):', e.message);
    captureException(e, { stage: 'av_consent_event', submission_id: submission.id });
  }
}

// Ephemeral Azure Speech token for the verbal walkthrough (Azure services plan #5). The BROWSER streams
// mic audio DIRECTLY to Azure Speech using this 10-minute token — audio never touches our backend and
// nothing (audio or transcript) is persisted; only the final transcript text returns for probe scoring.
// 404 (feature-off) unless ENABLE_SPEECH_WALKTHROUGH=true AND Azure Speech creds are configured.
router.get('/speech-token', async (req, res) => {
  try {
    if (!speechService.isEnabled()) return fail(res, 404, 'speech walkthrough not enabled');
    const token = await speechService.issueToken();
    if (!token) return fail(res, 404, 'speech walkthrough not enabled');
    res.json(token);
  } catch (e) {
    fail(res, 502, 'speech token unavailable');
  }
});

// Phase 2 billing gate: a "verified screen" is metered at SEND time (assign /
// invite). If the recruiter has already used their plan's monthly allowance,
// respond 402 with the upgrade payload and return true so the caller stops.
// On any metering error we FAIL OPEN (allow the send) rather than block a paying
// action on a transient count failure — never returns true in that case.
async function blockedByPlanLimit(req, res, ownerId = req.user.id) {
  let usage;
  try {
    usage = await planLimits.getScreenUsage({ ownerId });
  } catch (e) {
    console.warn('plan-limit check failed (allowing send):', e.message);
    return false;
  }
  const { plan, limit, used } = usage;
  if (limit !== Infinity && used >= limit) {
    res.status(402).json({
      error: `Free plan limit reached — ${limit} verified screens this month. Upgrade to send more.`,
      upgrade: true,
      plan,
      limit,
      used,
    });
    return true;
  }
  return false;
}

// Notify the work-sample owner (the recruiter) that a candidate completed their
// screen. Runs in the candidate's request, so it reads the owner + candidate via
// the service-role client (RLS would otherwise hide the recruiter's profile).
// Best-effort: any failure is logged, never surfaced to the candidate.
async function notifyOwnerOfSubmission(submission) {
  try {
    const { data: ws } = await supabaseAdmin
      .from('work_samples')
      .select('id, title, owner_id')
      .eq('id', submission.work_sample_id)
      .single();
    if (!ws || !ws.owner_id) return;
    const { data: owner } = await supabaseAdmin
      .from('profiles')
      .select('email, first_name')
      .eq('id', ws.owner_id)
      .single();
    if (!owner || !owner.email) return;

    let candidateLabel = 'A candidate';
    if (submission.candidate_id) {
      const { data: cand } = await supabaseAdmin
        .from('profiles')
        .select('email, first_name, last_name')
        .eq('id', submission.candidate_id)
        .single();
      if (cand) {
        const name = [cand.first_name, cand.last_name].filter(Boolean).join(' ').trim();
        candidateLabel = name || cand.email || candidateLabel;
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || '';
    const reviewUrl = frontendUrl ? `${frontendUrl}/app/result?submission=${submission.id}` : null;
    const body = [
      `Hi ${owner.first_name || 'there'},`,
      '',
      `${candidateLabel} just completed your screen "${ws.title || 'Untitled'}".`,
      "It's being scored now — you'll get one explainable score with the reasoning, the candidate's work, and how they directed the AI.",
      reviewUrl ? `\nReview it: ${reviewUrl}` : '',
      '',
      '— Touchstones',
    ]
      .filter((l) => l !== undefined)
      .join('\n');

    await emailService.sendEmail({
      to: owner.email,
      subject: `New submission: ${ws.title || 'your screen'}`,
      body,
      html: emailTemplates.submissionCompletedRecruiter({
        firstName: owner.first_name,
        candidateLabel,
        screenTitle: ws.title,
        reviewUrl,
      }),
      fromName: 'Touchstones',
    });
  } catch (e) {
    console.warn('notifyOwnerOfSubmission failed (non-blocking):', e.message);
  }
}

// --- Recruiter: create a work sample ---
router.post('/work-samples', requireRecruiter, async (req, res) => {
  try {
    const { title, prompt_md, rubric, role_family, job_id, response_type, duration_minutes, scoring_strategy, starter_files, languages, tests, reference_solution, deliverables, av_required } = req.body || {};
    if (!title || !prompt_md || !rubric || !Array.isArray(rubric.criteria) || !rubric.criteria.length) {
      return fail(res, 400, 'title, prompt_md, and rubric.criteria[] are required');
    }
    const row = {
      owner_id: req.user.id, title, prompt_md, rubric,
      role_family: role_family || null, job_id: job_id || null,
      response_type: response_type || 'markdown',
      duration_minutes: duration_minutes || 60,
      scoring_strategy: scoring_strategy || 'weighted_sum',
      starter_files: Array.isArray(starter_files) ? starter_files : [],
      languages: Array.isArray(languages) ? languages : [],
      tests: tests && typeof tests === 'object' ? tests : null,
      // 098: pairs with `tests` on exec-grounded screens (test validation + adjudication context).
      // PUT already patches it through; POST previously dropped it silently.
      reference_solution: typeof reference_solution === 'string' && reference_solution.trim() ? reference_solution : null,
      status: 'published',
    };
    // 111/112: only included when actually used, so creating a plain screen never depends on
    // these columns existing yet.
    const cleanDeliverables = sanitizeDeliverables(deliverables);
    if (cleanDeliverables) row.deliverables = cleanDeliverables;
    if (av_required === true) row.av_required = true;
    const { data, error } = await req.user.supabase.from('work_samples').insert(row).select().single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: edit (bump rubric_version when the rubric changes) ---
router.put('/work-samples/:id', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: existing, error: e0 } = await req.user.supabase.from('work_samples').select('*').eq('id', req.params.id).single();
    if (e0 || !existing) return fail(res, 404, 'work sample not found');
    const patch = { ...req.body, updated_at: new Date().toISOString() };
    delete patch.id; delete patch.owner_id; delete patch.rubric_version;
    if (patch.rubric && JSON.stringify(patch.rubric) !== JSON.stringify(existing.rubric)) {
      patch.rubric_version = (existing.rubric_version || 1) + 1;
    }
    // 111/112: same validators as create. An explicit deliverables value is sanitized (an empty
    // or invalid list clears the checklist); av_required is coerced to a strict boolean.
    if ('deliverables' in patch) patch.deliverables = sanitizeDeliverables(patch.deliverables);
    if ('av_required' in patch) patch.av_required = patch.av_required === true;
    const { data, error } = await req.user.supabase.from('work_samples').update(patch).eq('id', req.params.id).select().single();
    if (error) return fail(res, 500, error.message);
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

router.get('/work-samples/:id', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // Owner gets the full record (incl. rubric, for editing). Anyone else gets the
    // candidate-safe view of a PUBLISHED sample (no rubric) so a shared
    // /candidate?ws=<id> link works without leaking the grading rubric.
    const { data: owned } = await req.user.supabase.from('work_samples').select('*').eq('id', req.params.id).single();
    if (owned) return res.json(owned);
    let { data: pub, error: pubError } = await supabaseAdmin.from('work_samples_candidate')
      .select('id, title, prompt_md, response_type, language, duration_minutes, starter_files, languages, role_family, status, deliverables, av_required, ai_allowed')
      .eq('id', req.params.id).eq('status', 'published').single();
    // Deploy-safe fallback while migration 115 rolls out. Legacy views keep the
    // historical default (AI allowed) without breaking candidate links.
    if (pubError) {
      const legacy = await supabaseAdmin.from('work_samples_candidate')
        .select('id, title, prompt_md, response_type, language, duration_minutes, starter_files, languages, role_family, status, deliverables, av_required')
        .eq('id', req.params.id).eq('status', 'published').single();
      pub = legacy.data ? { ...legacy.data, ai_allowed: true } : null;
    }
    if (!pub) return fail(res, 404, 'work sample not found');
    res.json(pub);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: delete (archive) a work sample (owner-scoped) ---
// SOFT-DELETE by design. A hard delete cascades into the screen's submissions and then into
// APPEND-ONLY tamper-evident tables (submission_integrity_events / proof_audit_log / ai_interactions),
// whose BEFORE-DELETE triggers reject the delete — so a screen a candidate actually worked on can
// never be hard-deleted (the immutable evidence is the whole point of the trust product). Instead we
// archive it (status='archived'), which removes it from the recruiter's lists while the evidence
// stays intact. Returns { deleted:true } for the frontend's existing contract.
router.delete('/work-samples/:id', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // OWNER-ONLY. A plain RLS read is NOT a sufficient gate: migration 038 (team workspace RLS)
    // added ws_member_select, so an active workspace TEAMMATE can READ the owner's screen — but
    // writes stay owner-only. Read owner_id and assert it's the caller before the service-role
    // write (which bypasses RLS), and scope the update by owner_id as a belt-and-suspenders.
    const { data: ws } = await req.user.supabase.from('work_samples').select('id, owner_id').eq('id', req.params.id).single();
    if (!ws) return fail(res, 404, 'work sample not found or not accessible');
    if (ws.owner_id !== req.user.id) return fail(res, 403, 'only the owner can delete this screen');
    const { error } = await supabaseAdmin.from('work_samples')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('owner_id', req.user.id);
    if (error) return fail(res, 500, error.message);
    res.json({ deleted: true, id: req.params.id });
  } catch (e) { fail(res, 500, e.message); }
});

// Newest submission for (screen, candidate). The idempotency read shared by self-assign below and
// the invite claim in portal.js, so neither path can create a duplicate submission. Ordered by
// created_at: started_at is null until the candidate presses Start (migration 107).
async function findSubmission(workSampleId, candidateId) {
  const { data } = await supabaseAdmin.from('work_sample_submissions')
    .select('*').eq('work_sample_id', workSampleId).eq('candidate_id', candidateId)
    .order('created_at', { ascending: false }).limit(1);
  return (Array.isArray(data) && data[0]) || null;
}

// Create a submission with the standard self-assign defaults (status 'assigned'). service role
// (RLS WITH CHECK is candidate-self) creates the row. started_at and deadline_at stay NULL:
// the timer only starts when the candidate explicitly presses Start
// (POST /submissions/:id/start), which stamps both (migration 107). Shared with the invite
// claim in portal.js so both paths produce identical rows.
function createSubmission(ws, candidateId) {
  return supabaseAdmin.from('work_sample_submissions').insert({
    work_sample_id: ws.id, candidate_id: candidateId, job_id: ws.job_id || null,
    status: 'assigned',
  }).select().single();
}

// Re-invite un-declines (migration 108): a fresh invite for a (screen, email) whose claimed
// submission was declined resets that submission to a clean unstarted 'assigned' row (the
// recruiter explicitly asked again). declined_at and metadata.decline_reason are cleared and the
// start-gate stamps (started_at/deadline_at, 107) return to null so the candidate gets a fresh
// window. Service-role write, guarded by status='declined' both on the read and the update, so a
// submission in any other state is never touched. Exported for unit tests.
async function resetDeclinedSubmission(submissionId) {
  const { data: sub } = await supabaseAdmin.from('work_sample_submissions')
    .select('id, status, metadata').eq('id', submissionId).single();
  if (!sub || sub.status !== 'declined') return null;
  const metadata = { ...(sub.metadata || {}) };
  delete metadata.decline_reason;
  const { data, error } = await supabaseAdmin.from('work_sample_submissions')
    .update({ status: 'assigned', declined_at: null, started_at: null, deadline_at: null, metadata })
    .eq('id', submissionId).eq('status', 'declined').select();
  if (error) throw new Error(error.message);
  return (Array.isArray(data) && data[0]) || null;
}

// --- Recruiter: assign a work sample to a candidate (creates an unstarted submission; the ---
// --- deadline is stamped when the candidate presses Start) ---
router.post('/work-samples/:id/assign', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { candidate_id } = req.body || {};
    if (!isUUID(candidate_id)) return fail(res, 400, 'candidate_id (uuid) required');
    // Two callers share this route: (a) the OWNER assigning a candidate (candidate_id = someone
    // else), and (b) a CANDIDATE self-assigning from a shared /candidate?ws=<id> link
    // (candidate_id = themselves). The owner can read the sample under RLS; the candidate cannot
    // (not owner/member), so fall back to a service-role read of the PUBLISHED sample — mirroring
    // GET /work-samples/:id. Without this fallback the self-serve invite loop 404s for every
    // invited candidate (they can never run or submit).
    let ws = (await req.user.supabase.from('work_samples')
      .select('id, owner_id, duration_minutes, job_id').eq('id', req.params.id).single()).data;
    if (!ws) {
      const { data: pub } = await supabaseAdmin.from('work_samples_candidate')
        .select('id, owner_id, duration_minutes, job_id')
        .eq('id', req.params.id).eq('status', 'published').single();
      if (!pub) return fail(res, 404, 'work sample not found');
      // A non-owner may ONLY self-assign — never create a submission for someone else.
      if (candidate_id !== req.user.id) return fail(res, 403, 'not allowed to assign this screen');
      ws = pub;
    }
    // Idempotent: if this candidate already has a submission for this screen, return it — so
    // Run-then-Submit (two self-assign calls) doesn't create duplicates or double-meter.
    const existing = await findSubmission(ws.id, candidate_id);
    if (existing) return res.status(200).json(existing);
    // Phase 2: meter verified screens at SEND time, against the screen OWNER (not the caller —
    // the self-serve candidate owns no screens) — 402 once the owner's monthly cap is hit.
    if (await blockedByPlanLimit(req, res, ws.owner_id)) return;
    const { data, error } = await createSubmission(ws, candidate_id);
    if (error) return fail(res, 500, error.message);
    // Owner assigned a DIFFERENT candidate (API/ATS path) → email them the invite so they're not
    // left uninvited. Self-assign (candidate opened a ?ws= link) needs no email — they're already here.
    if (candidate_id !== req.user.id) {
      workflowNotify
        .candidateAssignedToScreen({ candidateId: candidate_id, workSampleId: ws.id, inviterId: req.user.id })
        .catch(() => {});
    }
    res.status(201).json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: invite a candidate to a screen by email (delivers the candidate link) ---
router.post('/work-samples/:id/invite', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { email, message } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'a valid email is required');
    // owner gate: only the owner can read this work sample under RLS.
    const { data: ws } = await req.user.supabase.from('work_samples').select('id, title, rubric').eq('id', req.params.id).single();
    if (!ws) return fail(res, 404, 'work sample not found');
    // Phase 2: meter verified screens at SEND time — 402 once the monthly cap is hit.
    if (await blockedByPlanLimit(req, res)) return;
    const frontendUrl = process.env.FRONTEND_URL || '';
    const link = frontendUrl ? `${frontendUrl}/candidate?ws=${ws.id}` : null;
    if (!link) return fail(res, 503, 'invites are not available in this deployment');
    // Invite tracking (migration 106): record the invite BEFORE sending, so the funnel and the
    // candidate's claim-on-arrival (portal.js /assignments) never depend on email delivery (the
    // recruiter may copy the link instead). Upsert on (work_sample_id, email): a re-invite
    // refreshes inviter/message without duplicating rows or touching an existing claim. Recording
    // is best-effort: a storage failure must not block the send (invited: null in the response).
    const invitedEmail = String(email).trim().toLowerCase();
    let invited = null;
    const { data: invRow, error: inviteErr } = await supabaseAdmin.from('work_sample_invites').upsert({
      work_sample_id: ws.id,
      email: invitedEmail,
      invited_by: req.user.id,
      message: message ? String(message).slice(0, 500) : null,
    }, { onConflict: 'work_sample_id,email' }).select('submission_id').single();
    if (inviteErr) {
      // Context stays PII-free: the work sample id, never the recipient address.
      console.warn('invite record failed:', inviteErr.message);
      captureException(new Error(`invite record failed: ${inviteErr.message}`), { stage: 'invite_record', work_sample_id: ws.id });
    } else {
      invited = { email: invitedEmail };
      // Re-invite un-declines (108): if this invite's claimed submission was declined, reset it
      // to a fresh 'assigned' row. Best-effort: a reset failure must not block the send.
      if (invRow && invRow.submission_id) {
        await resetDeclinedSubmission(invRow.submission_id).catch((e) => {
          console.warn('re-invite un-decline failed:', e.message);
          captureException(e, { stage: 'invite_undecline', work_sample_id: ws.id });
        });
      }
    }
    const { data: me } = await req.user.supabase.from('profiles').select('first_name, last_name, company').eq('id', req.user.id).single();
    const from = [me?.first_name, me?.last_name].filter(Boolean).join(' ').trim() || me?.company || 'A hiring team';
    const aiAllowed = ws.rubric?.ai_allowed !== false;
    const body = [
      'Hi,',
      '',
      `${from} invited you to complete a short, real-work screen${ws.title ? `: "${ws.title}"` : ''}.`,
      aiAllowed
        ? 'AI is allowed for this screen. The in-browser assistant is available, and how you direct and verify it becomes reviewable context.'
        : 'This screen is independent work. The in-browser AI assistant is disabled for this task.',
      message ? `\n"${String(message).slice(0, 500)}"` : '',
      `\nStart here: ${link}`,
      '',
      'Touchstones',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    // Surface the email delivery RESULT (silent failure was the bug — sendEmail RETURNS an
    // error object on a config/provider failure, so a .catch never saw it). The candidate
    // link is always returned so the recruiter can copy/share it even when email can't be sent.
    let email_sent = false;
    let email_error = null;
    try {
      // Branded HTML from the shared design system (emails/). null => emailService falls back to text(body).
      const html = emailTemplates.candidateInvite({ from, screenTitle: ws.title, message, link, aiAllowed });
      const r = await emailService.sendEmail({
        to: email, subject: `You're invited to a Touchstones screen${ws.title ? `: ${ws.title}` : ''}`, body, html, fromName: 'Touchstones',
      });
      email_sent = !!(r && r.success);
      email_error = (r && r.error) || null;
      if (!email_sent) {
        console.warn('invite email not sent:', email_error);
        // Context stays PII-free: the work sample id, never the recipient address.
        captureException(new Error(`invite email not sent: ${email_error}`), { stage: 'invite_email', work_sample_id: ws.id });
      }
    } catch (e) {
      email_error = e.message;
      console.warn('invite email failed:', e.message);
      captureException(e, { stage: 'invite_email', work_sample_id: ws.id });
    }
    res.json({ ok: true, link, email_sent, email_error, invited });
  } catch (e) { fail(res, 500, e.message); }
});

// Resolve the workspace the caller belongs to: the one they OWN, or — if they're an active
// member — the one they JOINED. Shared reads (activity, metrics) scope to this owner so a
// teammate sees the workspace's data, consistent with migration 038's member-select (which the
// RLS-based Dashboard already uses). Falls back to the caller for solo users / on any error.
async function workspaceOwnerId(req) {
  try {
    const { data } = await supabaseAdmin
      .from('workspace_members')
      .select('owner_id')
      .eq('member_id', req.user.id)
      .eq('status', 'active')
      .order('accepted_at', { ascending: true })
      .limit(1);
    return (Array.isArray(data) && data[0]?.owner_id) || req.user.id;
  } catch {
    return req.user.id;
  }
}

// --- Recruiter: activity timeline across the workspace's screens (most recent submissions) ---
router.get('/activity', requireRecruiter, async (req, res) => {
  try {
    const ownerId = await workspaceOwnerId(req);
    const { data: samples } = await req.user.supabase
      .from('work_samples').select('id, title').eq('owner_id', ownerId).neq('status', 'archived');
    const ids = (samples || []).map((s) => s.id);
    if (!ids.length) return res.json({ activity: [] });
    const titleById = Object.fromEntries((samples || []).map((s) => [s.id, s.title]));
    // Ownership is gated by the owner_id filter above; read submissions via service
    // role so we can enrich candidate identity (profiles aren't recruiter-readable under RLS).
    const { data: subs } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, candidate_id, status, started_at, submitted_at, deadline_at')
      .in('work_sample_id', ids)
      .order('started_at', { ascending: false })
      .limit(100);
    const candIds = [...new Set((subs || []).map((s) => s.candidate_id).filter(Boolean))];
    let candById = {};
    if (candIds.length) {
      const { data: profs } = await supabaseAdmin
        .from('profiles').select('id, email, first_name, last_name').in('id', candIds);
      candById = Object.fromEntries((profs || []).map((p) => [p.id, p]));
    }
    const activity = (subs || []).map((s) => {
      const c = candById[s.candidate_id];
      const candidate = c ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email : null;
      return {
        submission_id: s.id,
        screen_title: titleById[s.work_sample_id] || 'Untitled',
        candidate,
        status: s.status,
        started_at: s.started_at,
        submitted_at: s.submitted_at,
        deadline_at: s.deadline_at,
      };
    });
    res.json({ activity });
  } catch (e) { fail(res, 500, e.message); }
});

// Pure funnel shaping for GET /work-samples/invites/overview (exported for unit tests).
// Per-invite `status` is the furthest stage reached: invited -> started -> submitted -> scored.
// Started means ACTUALLY started (start gate, migration 107): started_at stamped, or a status
// past 'assigned' (in_progress/submitted/scored/expired). An assigned-but-never-started claim
// (e.g. claim-on-arrival) still counts as invited.
// 'declined' (migration 108) is a TERMINAL side exit, not a funnel stage: a declined submission
// reports status 'declined' (a decline is pre-start by construction, so it can never coexist
// with started/submitted/scored) and rides its own `declined` count, outside the cumulative chain.
// Counts are CUMULATIVE stages (sent >= started >= submitted >= scored), and submissions with no
// invite row (direct ?ws self-assigns) fold in as sent rows labeled by the candidate's email.
function buildInviteFunnel(samples, invites, subs, emailByCand) {
  const invitesByWs = {};
  for (const inv of invites) {
    (invitesByWs[inv.work_sample_id] = invitesByWs[inv.work_sample_id] || []).push(inv);
  }
  const subsByWs = {};
  for (const sub of subs) {
    (subsByWs[sub.work_sample_id] = subsByWs[sub.work_sample_id] || []).push(sub);
  }
  const stageOf = (sub) => {
    if (!sub) return 'invited';
    // Terminal side exit (108): a decline is pre-start only, so it can't shadow a real stage.
    if (sub.status === 'declined') return 'declined';
    if (sub.status === 'scored') return 'scored';
    if (sub.status === 'submitted') return 'submitted';
    // started_at is stamped by POST /submissions/:id/start; legacy pre-107 rows carry it from
    // assignment. in_progress/expired without it (older auto-flipped rows) still count.
    if (sub.started_at || sub.status === 'in_progress' || sub.status === 'expired') return 'started';
    return 'invited';
  };
  const totals = { sent: 0, started: 0, submitted: 0, scored: 0, declined: 0 };
  const screens = samples.map((s) => {
    const wsSubs = subsByWs[s.id] || [];
    const subById = Object.fromEntries(wsSubs.map((x) => [x.id, x]));
    const subByEmail = {};
    for (const sub of wsSubs) {
      const em = emailByCand[sub.candidate_id];
      if (em && !subByEmail[em]) subByEmail[em] = sub;
    }
    const claimed = new Set();
    const rows = (invitesByWs[s.id] || []).map((inv) => {
      // Prefer the stamped claim; fall back to an email match so a self-assign that raced ahead
      // of the claim stamp still shows as progress instead of a duplicate "direct" row.
      const sub = (inv.submission_id && subById[inv.submission_id]) || subByEmail[inv.email] || null;
      if (sub) claimed.add(sub.id);
      return { email: inv.email, status: stageOf(sub), invited_at: inv.created_at, submitted_at: (sub && sub.submitted_at) || null };
    });
    for (const sub of wsSubs) {
      if (claimed.has(sub.id)) continue;
      rows.push({ email: emailByCand[sub.candidate_id] || null, status: stageOf(sub), invited_at: null, submitted_at: sub.submitted_at || null });
    }
    const counts = { sent: rows.length, started: 0, submitted: 0, scored: 0, declined: 0 };
    for (const r of rows) {
      // Declined counts as sent + declined only; it never entered the started chain (pre-start).
      if (r.status === 'declined') { counts.declined += 1; continue; }
      if (r.status !== 'invited') counts.started += 1;
      if (r.status === 'submitted' || r.status === 'scored') counts.submitted += 1;
      if (r.status === 'scored') counts.scored += 1;
    }
    totals.sent += counts.sent;
    totals.started += counts.started;
    totals.submitted += counts.submitted;
    totals.scored += counts.scored;
    totals.declined += counts.declined;
    return { work_sample_id: s.id, title: s.title, ...counts, invites: rows };
  });
  return { screens, totals };
}

// --- Recruiter: invite funnel across the workspace's screens (who was invited, how far they got) ---
router.get('/work-samples/invites/overview', requireRecruiter, async (req, res) => {
  try {
    const ownerId = await workspaceOwnerId(req);
    const { data: samples } = await req.user.supabase
      .from('work_samples').select('id, title').eq('owner_id', ownerId).neq('status', 'archived');
    const ids = (samples || []).map((s) => s.id);
    if (!ids.length) return res.json({ screens: [], totals: { sent: 0, started: 0, submitted: 0, scored: 0, declined: 0 } });
    // Ownership is gated by the owner_id filter above (same as /activity); batched service-role
    // reads (invites + submissions + candidate emails), never a query per invite.
    const [{ data: invites }, { data: subs }] = await Promise.all([
      supabaseAdmin.from('work_sample_invites')
        .select('work_sample_id, email, created_at, submission_id')
        .in('work_sample_id', ids)
        .order('created_at', { ascending: false }),
      supabaseAdmin.from('work_sample_submissions')
        .select('id, work_sample_id, candidate_id, status, started_at, submitted_at')
        .in('work_sample_id', ids),
    ]);
    const candIds = [...new Set((subs || []).map((s) => s.candidate_id).filter(Boolean))];
    let emailByCand = {};
    if (candIds.length) {
      const { data: profs } = await supabaseAdmin.from('profiles').select('id, email').in('id', candIds);
      emailByCand = Object.fromEntries((profs || []).map((p) => [p.id, (p.email || '').toLowerCase()]));
    }
    res.json(buildInviteFunnel(samples || [], invites || [], subs || [], emailByCand));
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: screening ROI metrics across my screens (the quotable numbers) ---
router.get('/metrics', requireRecruiter, async (req, res) => {
  try {
    const ownerId = await workspaceOwnerId(req);
    const { data: samples } = await req.user.supabase
      .from('work_samples').select('id').eq('owner_id', ownerId).neq('status', 'archived');
    const ids = (samples || []).map((s) => s.id);
    const empty = { screens: ids.length, submissions_total: 0, by_status: {}, completed: 0, scored: 0, completion_rate: 0, median_minutes_to_submit: null, est_onsite_hours_saved: 0 };
    if (!ids.length) return res.json(empty);
    const { data: subs } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('status, started_at, submitted_at')
      .in('work_sample_id', ids);
    const rows = subs || [];
    const by_status = {};
    for (const s of rows) by_status[s.status] = (by_status[s.status] || 0) + 1;
    const submissions_total = rows.length;
    const completed = (by_status.submitted || 0) + (by_status.scored || 0);
    const scored = by_status.scored || 0;
    const completion_rate = submissions_total ? completed / submissions_total : 0;
    // median minutes from start to submit (a real "fast signal" number)
    const durations = rows
      .filter((s) => s.started_at && s.submitted_at)
      .map((s) => (new Date(s.submitted_at).getTime() - new Date(s.started_at).getTime()) / 60000)
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);
    let median_minutes_to_submit = null;
    if (durations.length) {
      const mid = Math.floor(durations.length / 2);
      median_minutes_to_submit = Math.round(durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2);
    }
    // Estimate: each completed screen replaces ~4h of senior-eng onsite/take-home review.
    const est_onsite_hours_saved = Math.round(completed * 4);
    res.json({ screens: ids.length, submissions_total, by_status, completed, scored, completion_rate, median_minutes_to_submit, est_onsite_hours_saved });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: mint an adaptive task variant (anti-share) for this work sample ---
// Each candidate can receive a fresh, non-shareable parameterized variant. Ownership-
// guarded via the RLS-scoped read; persisted through service-role after the gate (so the
// owner_id WITH CHECK on work_sample_variants is satisfied by the verified ownership above).
router.post('/work-samples/:id/variant', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { seed, submission_id } = req.body || {};
    if (submission_id !== undefined && submission_id !== null && !isUUID(submission_id)) {
      return fail(res, 400, 'submission_id must be a uuid');
    }
    // ownership gate: requester must be able to read this work sample under RLS.
    // (We select '*' so a future variant_spec column flows through to the variant
    // service without a code change; variantService treats it as optional.)
    const { data: ws } = await req.user.supabase.from('work_samples')
      .select('*').eq('id', req.params.id).single();
    if (!ws) return fail(res, 404, 'work sample not found or not accessible');

    const variant = await variantService.generateVariant(ws, seed);
    const { data, error } = await supabaseAdmin.from('work_sample_variants').insert({
      work_sample_id: ws.id,
      submission_id: submission_id || null,
      variant_seed: variant.variant_seed,
      params: variant.params,
    }).select().single();
    if (error) return fail(res, 500, error.message);
    res.status(201).json({ ...data, prompt_md: variant.prompt_md });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Candidate: load the assigned task + remaining time ---
router.get('/submissions/:id', async (req, res) => {
  try {
    const { data: sub, error } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', req.params.id).single();
    if (error || !sub) return fail(res, 404, 'submission not found');
    // Loading the screen does NOT flip 'assigned' -> 'in_progress' anymore (start gate,
    // migration 107): only the explicit POST /submissions/:id/start below starts the timer,
    // so a candidate can open and read an assigned screen without burning their window.
    // work_samples is owner-only under RLS, so the candidate can't read it with their
    // token. The submission row above already gated access (RLS: candidate-self OR
    // owner), so read the CANDIDATE-SAFE fields via service role — note this select
    // deliberately omits `rubric` so the grading criteria never reach the candidate.
    let { data: ws, error: wsError } = await supabaseAdmin.from('work_samples_candidate')
      .select('id, title, prompt_md, response_type, language, duration_minutes, starter_files, languages, role_family, deliverables, av_required, ai_allowed').eq('id', sub.work_sample_id).single();
    if (wsError) {
      const legacy = await supabaseAdmin.from('work_samples_candidate')
        .select('id, title, prompt_md, response_type, language, duration_minutes, starter_files, languages, role_family, deliverables, av_required').eq('id', sub.work_sample_id).single();
      ws = legacy.data ? { ...legacy.data, ai_allowed: true } : null;
    }
    // Redact stored per-case results for the candidate (hidden cases → pass/fail only, no data).
    if (sub.candidate_id === req.user.id && sub.test_results) {
      sub.test_results = codeExecutionService.redactCasesForCandidate(sub.test_results);
    }
    // ADR-001 Phase 2 interim offer gate: tell the FE whether to render the verified-session offer
    // for this screen (flag on AND allowlisted). Absent/false ⇒ no offer (safe). Never a signal to
    // the recruiter — this is a candidate-facing render hint only.
    const work_sample = ws ? { ...ws, verified_session_enabled: verifiedSessionOfferable(ws.id) } : ws;
    res.json({ submission: sub, work_sample });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Candidate: explicitly start the screen (starts the timer) ---
// Start gate (migration 107): assignment no longer stamps started_at/deadline_at, so an invited
// candidate can sign up and look around without their window burning. The first Start stamps
// started_at = now, computes deadline_at = now + duration_minutes, and flips to 'in_progress'.
// Idempotent: a repeat call (reload, double-click) returns the current row unchanged. Legacy rows
// with a deadline_at stamped at assignment (pre-107) keep it: Start never extends a deadline.
router.post('/submissions/:id/start', async (req, res) => {
  try {
    // Same ownership gate as GET /submissions/:id: the read under the caller's RLS client only
    // returns the row to the candidate or the screen owner.
    const { data: sub, error } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', req.params.id).single();
    if (error || !sub) return fail(res, 404, 'submission not found');
    // The RLS read also admits the screen OWNER; only the candidate may start their own timer.
    if (sub.candidate_id !== req.user.id) return fail(res, 403, 'only the candidate can start this screen');
    // Already completed: idempotent no-op (never 410 a finished screen).
    if (sub.status === 'submitted' || sub.status === 'scored') return res.json({ submission: sub });
    if (sub.status === 'expired') return fail(res, 410, 'deadline passed');
    // Legacy stamped deadline already in the past but not yet swept -> same as expired.
    if (sub.deadline_at && Date.now() > new Date(sub.deadline_at).getTime()) return fail(res, 410, 'deadline passed');
    if (sub.status === 'in_progress' && sub.started_at) return res.json({ submission: sub });
    // status 'assigned' (or a row missing its start stamp): start now. Write via service role,
    // matching /submit (work_sample_submissions is read-only to end-user tokens, 080).
    // Candidate-safe view (the base table is owner-only under RLS), mirroring the GET above.
    // Read once: duration_minutes drives the deadline, av_required drives the consent gate (112).
    // If the view predates migration 112 (deploy-before-migrate, or a 112 rollback), the
    // av_required column select errors; fall back to a duration-only read so the deadline stays
    // correct (a missing column just means no screen is AV-gated yet), never silently null ws
    // which would apply the 60-minute fallback to every screen.
    let { data: ws, error: wsErr } = await supabaseAdmin.from('work_samples_candidate')
      .select('duration_minutes, av_required').eq('id', sub.work_sample_id).single();
    if (wsErr) {
      const legacy = await supabaseAdmin.from('work_samples_candidate')
        .select('duration_minutes').eq('id', sub.work_sample_id).single();
      ws = legacy.data ? { ...legacy.data, av_required: false } : null;
    }
    // AV requirement (TOU-147): a screen with av_required only starts with an explicit
    // { av_consent: true } in the body. Enforced server-side so a client can never skip the gate.
    const avErr = avConsentError(ws, req.body);
    if (avErr) return res.status(400).json(avErr);
    const now = new Date();
    const patch = { status: 'in_progress' };
    if (!sub.started_at) patch.started_at = now.toISOString();
    if (!sub.deadline_at) {
      patch.deadline_at = new Date(now.getTime() + ((ws && ws.duration_minutes) || 60) * 60000).toISOString();
    }
    let q = supabaseAdmin.from('work_sample_submissions').update(patch)
      .eq('id', sub.id).in('status', ['assigned', 'in_progress']);
    // Race guard: two concurrent Starts both read started_at = null; the loser matches 0 rows
    // here instead of re-stamping, and falls through to return the winner's row.
    if (!sub.started_at) q = q.is('started_at', null);
    const { data: updatedRows, error: e1 } = await q.select();
    if (e1) return fail(res, 500, e1.message);
    let updated = (Array.isArray(updatedRows) && updatedRows[0]) || null;
    // Consent evidence, only when THIS call actually stamped the start of an AV-gated screen
    // (the race loser and idempotent repeats never double-record). proof_consent rows (camera +
    // microphone) + one av_consent_granted chain event; recordAvConsent is best-effort inside.
    if (updated && patch.started_at && ws && ws.av_required === true) {
      await recordAvConsent(updated);
    }
    if (!updated) {
      const { data: current } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', sub.id).single();
      updated = current || sub;
    }
    if (updated.status === 'expired') return fail(res, 410, 'deadline passed');
    // Same candidate-facing redaction as GET /submissions/:id (only the candidate reaches here).
    if (updated.test_results) {
      updated.test_results = codeExecutionService.redactCasesForCandidate(updated.test_results);
    }
    res.json({ submission: updated });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Candidate: decline an assigned screen (pre-start only) ---
// Migration 108: a candidate can bow out of a screen they have NOT started. Only
// status='assigned' with a null started_at qualifies; past Start the row is evidence and can no
// longer be declined (409). Sets status='declined' + declined_at; the optional reason is
// candidate-supplied and rides in metadata.decline_reason (103) so it reaches the recruiter's
// notification but is NEVER logged server-side. Idempotent: declining an already-declined row
// returns 200 with the current row. A re-invite resets the row back to 'assigned' (see
// resetDeclinedSubmission above).
router.post('/submissions/:id/decline', async (req, res) => {
  try {
    // Same ownership gate as /start: the RLS read only returns the row to the candidate or the
    // screen owner, and only the candidate may decline their own screen.
    const { data: sub, error } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', req.params.id).single();
    if (error || !sub) return fail(res, 404, 'submission not found');
    if (sub.candidate_id !== req.user.id) return fail(res, 403, 'only the candidate can decline this screen');
    if (sub.status === 'declined') return res.json({ submission: sub });
    if (sub.status !== 'assigned' || sub.started_at) {
      return fail(res, 409, 'only an unstarted screen can be declined; this one was already started or completed');
    }
    const reason = String((req.body || {}).reason || '').trim().slice(0, 500);
    const patch = { status: 'declined', declined_at: new Date().toISOString() };
    if (reason) patch.metadata = { ...(sub.metadata || {}), decline_reason: reason };
    // Write via service role, matching /start (work_sample_submissions is read-only to end-user
    // tokens, 080). Race guard: only an untouched 'assigned' row flips; if a concurrent Start won,
    // the update matches 0 rows and we re-read to answer truthfully.
    const { data: updatedRows, error: e1 } = await supabaseAdmin.from('work_sample_submissions')
      .update(patch).eq('id', sub.id).eq('status', 'assigned').is('started_at', null).select();
    if (e1) return fail(res, 500, e1.message);
    let updated = (Array.isArray(updatedRows) && updatedRows[0]) || null;
    if (!updated) {
      const { data: current } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', sub.id).single();
      if (current && current.status === 'declined') return res.json({ submission: current });
      return fail(res, 409, 'only an unstarted screen can be declined; this one was already started or completed');
    }
    // Tell the screen owner (bell + email), best-effort and non-blocking. No candidate email:
    // they just acted; confirmation lives in the UI.
    workflowNotify.recruiterScreenDeclined({ submission: updated, reason: reason || null }).catch(() => {});
    res.json({ submission: updated });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Candidate: submit a response (server enforces the deadline) ---
router.post('/submissions/:id/submit', async (req, res) => {
  try {
    const { response_text, response_code, deliverables_check } = req.body || {};
    // Read under the candidate's RLS client to confirm ownership (candidate can only read THEIR own
    // submission), THEN write via service role — work_sample_submissions is read-only to end-user
    // tokens (080), so the trusted backend is the only writer (prevents input_hash forgery / status
    // tampering / post-score rewrites via direct PostgREST).
    const { data: sub, error: e0 } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', req.params.id).single();
    if (e0 || !sub) return fail(res, 404, 'submission not found');
    // Idempotent: a re-submit (or a double-click) must not re-fire the owner email or re-score.
    if (sub.status === 'submitted' || sub.status === 'scored') return res.json(sub);
    // Grace window: a submit arriving shortly after the deadline is ACCEPTED and flagged as
    // late_submission (a review hint for the recruiter, never an automated pass/fail), instead
    // of a hard 410 that loses the candidate's work. Past the grace window, still 410.
    const lateMs = sub.deadline_at ? Date.now() - new Date(sub.deadline_at).getTime() : 0;
    if (lateMs > LATE_SUBMIT_GRACE_MS) return fail(res, 410, 'deadline passed');
    const body = String(response_text || response_code || '');
    const input_hash = crypto.createHash('sha256').update(body).digest('hex');
    const patch = {
      response_text: response_text || null, response_code: response_code || null,
      input_hash, submitted_at: new Date().toISOString(), status: 'submitted',
    };
    // metadata (migration 103) is only referenced on a LATE submit or when the candidate ticked
    // deliverables (111), so plain submissions never depend on the column existing yet.
    if (lateMs > 0) {
      patch.metadata = { ...(sub.metadata || {}), late_submission: true, late_by_seconds: Math.round(lateMs / 1000) };
    }
    // Deliverables self-check (TOU-146): the candidate's ticked item indexes, validated and
    // stamped by the trusted backend. A review aid for the recruiter, never a gate: submitting
    // with unchecked (or no) items is always accepted.
    const checked = sanitizeDeliverablesCheck(deliverables_check);
    if (checked) {
      patch.metadata = { ...(patch.metadata || sub.metadata || {}), deliverables_check: checked };
    }
    const { data, error } = await supabaseAdmin.from('work_sample_submissions').update(patch)
      .eq('id', req.params.id).select().single();
    if (error) return fail(res, 500, error.message);
    // Tell the recruiter their screen was completed (best-effort, non-blocking): email + bell.
    notifyOwnerOfSubmission(data).catch(() => {});
    workflowNotify.recruiterSubmissionReceived(data).catch(() => {});
    // Confirm receipt to the candidate so they aren't left wondering (best-effort, non-blocking).
    workflowNotify.candidateSubmissionReceived(data).catch(() => {});
    // Run full structured tests BEFORE scoring, so execution grounding can read test_results when
    // AI_SCORE_EXEC_GROUNDING is on. Still fire-and-forget: submit never waits on E2B or the LLM.
    runTestsThenScore(data).catch(() => {});
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

async function runTestsThenScore(submission) {
  await runFullTestsAndStore(submission);
  await autoScoreSubmission(submission);
}

// On submit, run the screen's FULL structured test suite (all cases) once in the sandbox and store
// the authoritative per-case result on the submission. Recruiter sees every case; candidate reads
// are redacted (see GET /submissions/:id). Best-effort, non-blocking — never affects submit.
async function runFullTestsAndStore(submission) {
  try {
    const { data: ws } = await supabaseAdmin
      .from('work_samples').select('tests, starter_files').eq('id', submission.work_sample_id).single();
    if (!ws || !codeExecutionService.isCaseTests(ws.tests)) return;
    const files = reconstructFiles(submission.response_code, ws.starter_files);
    const result = await codeExecutionService.runCases({ files, tests: ws.tests, mode: 'all' });
    if (result && result.ran) {
      await supabaseAdmin.from('work_sample_submissions').update({ test_results: result }).eq('id', submission.id);
    }
  } catch (e) {
    console.warn('runFullTestsAndStore failed (non-blocking):', e.message);
    captureException(e, { stage: 'runFullTestsAndStore', submission_id: submission.id, work_sample_id: submission.work_sample_id });
  }
}

// Background scorer kicked off on submit. Never affects the candidate's submit response; any
// failure is logged. Uses the work_sample OWNER as the spend account (the recruiter pays). When
// the async queue is on, enqueue instead of scoring inline.
async function autoScoreSubmission(submission) {
  try {
    const { data: ws } = await supabaseAdmin
      .from('work_samples').select('owner_id, rubric_version').eq('id', submission.work_sample_id).single();
    if (process.env.USE_SCORING_QUEUE === 'true') {
      await scoringQueue.enqueue(submission.id, ws?.rubric_version ?? 1);
      return;
    }
    await proofScoringService.scoreSubmission(submission.id, { accountId: ws?.owner_id, reviewerId: ws?.owner_id });
  } catch (e) {
    console.warn('autoScoreSubmission failed (non-blocking):', e.message);
    captureException(e, { stage: 'autoScoreSubmission', submission_id: submission.id, work_sample_id: submission.work_sample_id });
  }
}

// Reconstruct candidate files from the serialized response_code. The IDE serializes
// multiple files with `/* ===== path ===== */` headers; a single file is just its body.
function reconstructFiles(responseCode, starterFiles) {
  const code = String(responseCode || '');
  if (/\/\* ===== .+? ===== \*\//.test(code)) {
    const parts = code.split(/\/\* ===== (.+?) ===== \*\/\n?/);
    const out = [];
    for (let i = 1; i < parts.length; i += 2) {
      out.push({ path: parts[i].trim(), content: parts[i + 1] || '' });
    }
    if (out.length) return out;
  }
  const path = (Array.isArray(starterFiles) && starterFiles[0] && starterFiles[0].path) || 'solution.js';
  return [{ path, content: code }];
}

// --- Run code against the screen's hidden tests in an isolated sandbox ---
// Two callers:
//   - Candidate pre-submit "Run": pass the CURRENT editor code in the body ({ files:[{path,content}] }
//     or { response_code }) → we run it so they get pass/fail feedback before submitting.
//   - Recruiter / post-submit: no body → we run the STORED submission code (and cache the result).
// SECURITY: the test COMMAND always comes from the screen's stored work_samples.tests — NEVER from
// the request body. Only the candidate's files are taken from the body; they're written into the
// isolated E2B sandbox (codeExecutionService sanitizes paths), exactly like the submitted code is.
router.post('/submissions/:id/run', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // Access gate: the caller must be able to read the submission under RLS
    // (candidate-self OR work_sample owner). Then read tests via service role.
    const { data: sub } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found');
    // Code-exec disabled → 200 with { available:false } (NOT 503). api.js throws on any non-2xx,
    // which would turn the intended graceful "not available" UI into a red, retryable error.
    // Returning 200 lets run/baseline RESOLVE so the frontend's available:false branch renders.
    if (!codeExecutionService.isEnabled()) return res.json({ available: false, ran: false, reason: 'code execution is not configured' });
    const { data: ws } = await supabaseAdmin.from('work_samples').select('id, tests, starter_files').eq('id', sub.work_sample_id).single();
    if (!ws) return fail(res, 404, 'work sample not found');

    // Resolve the files to run. Prefer the candidate's CURRENT code from the body (pre-submit Run);
    // fall back to the STORED submission code. The test command is ALWAYS ws.tests (trusted).
    const body = req.body || {};
    let files;
    let usingCurrent = false;
    if (Array.isArray(body.files) && body.files.length) {
      files = body.files.slice(0, 50)
        .filter((f) => f && typeof f.path === 'string')
        .map((f) => ({ path: String(f.path).slice(0, 300), content: String(f.content || '').slice(0, 200000) }));
      usingCurrent = files.length > 0;
    }
    if (!usingCurrent && typeof body.response_code === 'string' && body.response_code.trim()) {
      files = reconstructFiles(body.response_code, ws.starter_files);
      usingCurrent = true;
    }
    if (!files || !files.length) {
      files = reconstructFiles(sub.response_code, ws.starter_files);
    }

    // Structured per-case tests (LeetCode-style). The candidate's interactive Run executes ONLY the
    // visible SAMPLE cases (hidden inputs never enter their sandbox) and gets a redacted result; the
    // owner previewing their own screen can run the full suite. Submit-time runs the full suite (see
    // runFullTestsAndStore) and stores the authoritative per-case grade.
    if (codeExecutionService.isCaseTests(ws.tests)) {
      const isCandidate = sub.candidate_id === req.user.id;
      let result = await codeExecutionService.runCases({ files, tests: ws.tests, mode: isCandidate ? 'sample' : 'all' });
      if (isCandidate) result = codeExecutionService.redactCasesForCandidate(result);
      return res.json(result);
    }

    // No hidden tests → IDE-style: actually execute the candidate's program and return
    // stdout/stderr so console.log prints. (Previously this returned ran:false and the code
    // never ran — "console.log nowhere to be printed".) Ad-hoc program runs aren't cached.
    if (!ws.tests || !ws.tests.command) {
      const language = typeof body.language === 'string' ? body.language : null;
      const stdin = typeof body.stdin === 'string' ? body.stdin : null;
      return res.json(await codeExecutionService.runProgram({ files, language, stdin }));
    }

    const result = await codeExecutionService.runTests({ files, tests: ws.tests });
    // Only cache when we ran the STORED submission code — an ad-hoc current-code run isn't the
    // submitted artifact, so caching it on the submission would be misleading.
    if (!usingCurrent) {
      supabaseAdmin.from('work_sample_submissions').update({ execution_result: result }).eq('id', sub.id).then(() => {}, () => {});
    }
    res.json(result);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Compare a submission to the one-shot AI baseline (where the human beat the agent) ---
router.post('/submissions/:id/baseline', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: sub } = await req.user.supabase.from('work_sample_submissions').select('*').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found');
    // Code-exec disabled → 200 with { available:false } (NOT 503). api.js throws on any non-2xx,
    // which would turn the intended graceful "not available" UI into a red, retryable error.
    // Returning 200 lets run/baseline RESOLVE so the frontend's available:false branch renders.
    if (!codeExecutionService.isEnabled()) return res.json({ available: false, ran: false, reason: 'code execution is not configured' });
    const { data: ws } = await supabaseAdmin.from('work_samples').select('id, prompt_md, starter_files, tests, baseline').eq('id', sub.work_sample_id).single();
    if (!ws) return fail(res, 404, 'work sample not found');
    if (!ws.tests || !ws.tests.command) return res.json({ available: true, ran: false, reason: 'no hidden tests for this screen' });
    // Per-task one-shot baseline (generated + cached once on the work sample).
    const baseline = await baselineService.ensureBaseline(ws, async (b) => {
      await supabaseAdmin.from('work_samples').update({ baseline: b }).eq('id', ws.id);
    });
    if (!baseline || !baseline.result) return res.json({ available: true, ran: false, reason: 'could not generate a one-shot baseline' });
    const files = reconstructFiles(sub.response_code, ws.starter_files);
    const candidate = await codeExecutionService.runTests({ files, tests: ws.tests });
    const cPass = candidate.passedCount || 0;
    const bPass = (baseline.result && baseline.result.passedCount) || 0;
    res.json({
      available: true, ran: true,
      candidate: { passed: cPass, failed: candidate.failedCount || 0, total: candidate.total || 0 },
      baseline: { passed: bPass, failed: baseline.result.failedCount || 0, total: baseline.result.total || 0 },
      delta: cPass - bPass,
    });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Run scoring (recruiter/system) ---
router.post('/submissions/:id/score', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    // ownership guard: requester must own the work sample (RLS-scoped read = tenant gate)
    const { data: sub } = await req.user.supabase.from('work_sample_submissions').select('id, work_sample_id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');

    // Async path (SYSTEM_DESIGN #8): enqueue + 202 so the request never blocks on the
    // LLM; the worker drains and Realtime pushes the result. Default is inline scoring.
    if (process.env.USE_SCORING_QUEUE === 'true') {
      const { data: ws } = await req.user.supabase.from('work_samples').select('rubric_version').eq('id', sub.work_sample_id).single();
      const job = await scoringQueue.enqueue(req.params.id, ws?.rubric_version ?? 1);
      return res.status(202).json({ jobId: job.id, status: job.status || 'queued' });
    }

    const result = await proofScoringService.scoreSubmission(req.params.id, {
      accountId: req.user.id,
      reviewerId: req.user.id,
    });
    // Distinguish degraded outcomes for the client (429 budget, 503 LLM-down).
    if (result && result.status === 'pending_scoring') return res.status(503).json(result);
    res.json(result);
  } catch (e) {
    if (e && e.name === 'SpendCeilingError') return res.status(429).json({ error: e.message, reason: e.reason });
    fail(res, 500, e.message);
  }
});

// --- Get a score (latest, non-superseded) ---
router.get('/scores/:id', requireRecruiter, async (req, res) => {
  try {
    const { data, error } = await req.user.supabase.from('proof_scores').select('*').eq('id', req.params.id).single();
    if (error || !data) return fail(res, 404, 'score not found');
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Audit-trail export (immutable record). Guarded by work-sample ownership. ---
router.get('/scores/:id/audit.json', requireRecruiter, async (req, res) => {
  try {
    // ownership: can the requester read this score under RLS?
    const { data: score } = await req.user.supabase.from('proof_scores').select('id').eq('id', req.params.id).single();
    if (!score) return fail(res, 404, 'score not found or not accessible');
    const { data: audit, error } = await supabaseAdmin.from('proof_audit_log').select('*').eq('proof_score_id', req.params.id).order('created_at', { ascending: false }).limit(1).single();
    if (error || !audit) return fail(res, 404, 'audit record not found');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.id}.json"`);
    res.json(audit);
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: human score correction ("adjust this score" — the labeling flywheel) ---
// Records the reviewer's disagreement as a LABEL on the live score row: human_override +
// human_reviewer_id + override_reason. normalized_score (the model's number) is NEVER touched —
// the model-vs-human pair is exactly the non-circular training signal export-training-set.js
// already selects. proof_scores has no numeric override column (011: human_override is BOOLEAN),
// so the adjusted 0-100 value is serialized into override_reason with a FIXED server-built
// prefix — human-readable in compliance exports, machine-parseable downstream, and backfillable
// into a dedicated column by a later migration.
router.post('/scores/:id/override', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { human_score, override_reason } = req.body || {};
    const adjusted = Number(human_score);
    if (!Number.isInteger(adjusted) || adjusted < 0 || adjusted > 100) {
      return fail(res, 400, 'human_score must be an integer between 0 and 100');
    }
    const reason = String(override_reason || '').trim();
    if (reason.length < 10 || reason.length > 1000) {
      return fail(res, 400, 'override_reason is required (10 to 1000 characters)');
    }
    // Tenant gate: RLS-scoped read (080: proof_scores are readable by the screen OWNER only),
    // then — like the work-sample delete route — assert ownership explicitly against the
    // submission → work_sample chain before the service-role write (proof_scores has no
    // end-user UPDATE policy, so the write must go through supabaseAdmin).
    const { data: score } = await req.user.supabase.from('proof_scores')
      .select('id, submission_id, normalized_score, superseded_by').eq('id', req.params.id).single();
    if (!score) return fail(res, 404, 'score not found or not accessible');
    const { data: sub } = await supabaseAdmin.from('work_sample_submissions')
      .select('id, work_sample_id').eq('id', score.submission_id).single();
    const { data: ws } = sub
      ? await supabaseAdmin.from('work_samples').select('id, owner_id').eq('id', sub.work_sample_id).single()
      : { data: null };
    if (!ws || ws.owner_id !== req.user.id) return fail(res, 403, 'only the screen owner can adjust this score');
    // Only the LIVE score is a label target; a superseded row is history, not the grade.
    if (score.superseded_by) return fail(res, 409, 'this score was superseded by a re-score; adjust the live score');
    const { data: updated, error } = await supabaseAdmin.from('proof_scores')
      .update({
        human_override: true,
        human_reviewer_id: req.user.id,
        override_reason: `Adjusted to ${adjusted}/100 (model scored ${score.normalized_score}): ${reason}`,
      })
      .eq('id', score.id).is('superseded_by', null) // re-check: a concurrent re-score wins
      .select().single();
    if (error || !updated) return fail(res, 409, 'score changed while adjusting; reload and retry');
    res.json(updated);
  } catch (e) { fail(res, 500, e.message); }
});

// ── "Direct the AI" replay (the 2026-native signal) ──

// DEPRECATED + REMOVED (migration 095): this endpoint let the client POST an arbitrary AI transcript,
// which a candidate could fabricate to inflate their AI-direction score. The in-app assistant is now
// captured server-side by POST /ai-assist (the server generates the reply and logs both turns as
// source:'server_attested'), and candidate direct-inserts to ai_interactions are revoked. The frontend
// only ever calls /ai-assist + GET /ai-interactions, so nothing legitimate used this write path.
router.post('/submissions/:id/ai-interactions', (_req, res) => {
  res.status(410).json({
    error: 'gone',
    message: 'Client-supplied AI transcripts are no longer accepted. Use POST /ai-assist (server-logged).',
  });
});

// Replay: retrieve the transcript (recruiter via ownership, or candidate — RLS-scoped).
router.get('/submissions/:id/ai-interactions', async (req, res) => {
  try {
    const { data, error } = await req.user.supabase.from('ai_interactions')
      .select('seq, role, content, disposition, client_ts')
      .eq('submission_id', req.params.id).order('seq', { ascending: true });
    if (error) return fail(res, 403, error.message);
    res.json({ interactions: data || [] });
  } catch (e) { fail(res, 500, e.message); }
});

// Record what the candidate DID with an AI suggestion (accepted into the editor / rejected /
// accepted-then-edited). Candidate-attested by nature — we can't observe their editor server-side —
// but it rides into aiDirectionService's replay as a direction-quality hint, same as the /v1 API's
// disposition field. Only assistant turns can carry a disposition (they hold the suggestions).
router.patch('/submissions/:id/ai-interactions/:seq/disposition', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const seq = parseInt(req.params.seq, 10);
    if (!Number.isInteger(seq) || seq < 1) return fail(res, 400, 'invalid seq');
    const disposition = String((req.body || {}).disposition || '');
    if (!['accepted', 'edited', 'rejected'].includes(disposition)) {
      return fail(res, 400, 'disposition must be accepted | edited | rejected');
    }
    // Stricter than /ai-assist's gate: the RLS read also passes for the recruiter/work-sample owner
    // (wss_read), but only the CANDIDATE may attest their own accept/reject — and only while the
    // screen is live. Once submitted/scored the replay is evidence; no post-hoc rewrites.
    const { data: sub } = await req.user.supabase.from('work_sample_submissions')
      .select('id, candidate_id, status').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');
    if (sub.candidate_id !== req.user.id) return fail(res, 403, 'only the candidate can set a disposition');
    if (sub.status === 'submitted' || sub.status === 'scored') {
      return fail(res, 409, 'submission is closed; dispositions are frozen');
    }
    const { data, error } = await supabaseAdmin.from('ai_interactions')
      .update({ disposition })
      .eq('submission_id', req.params.id).eq('seq', seq).eq('role', 'assistant')
      .select('seq, disposition');
    if (error) return fail(res, 500, error.message);
    if (!data || !data.length) return fail(res, 404, 'assistant turn not found');
    res.json({ seq, disposition });
  } catch (e) { fail(res, 500, e.message); }
});

// Score how well the candidate directed the AI (ownership-guarded; computed in code).
router.post('/submissions/:id/score-direction', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: sub } = await req.user.supabase.from('work_sample_submissions').select('id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');
    const result = await aiDirectionService.scoreAiDirection(req.params.id, { accountId: req.user.id });
    res.json(result);
  } catch (e) {
    if (e && e.name === 'SpendCeilingError') return res.status(429).json({ error: e.message, reason: e.reason });
    fail(res, 500, e.message);
  }
});

// Latest direction score for the result card.
router.get('/submissions/:id/direction', async (req, res) => {
  try {
    const { data } = await req.user.supabase.from('ai_direction_scores')
      .select('*').eq('submission_id', req.params.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    // "Not scored yet" is an expected state, not an error: many submissions (incl. seeded/demo
    // ones) never have the AI directed. Return an empty 200 so the result card degrades to
    // "no direction" exactly as the client's catch path already does — without a console 404.
    if (!data) return res.json(null);
    res.json(data);
  } catch (e) { fail(res, 500, e.message); }
});

// In-app AI assistant for the candidate. Calls the LLM AND auto-logs both turns to the
// ai_interactions replay — "Direct the AI" is captured passively, no self-reporting.
router.post('/submissions/:id/ai-assist', async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const message = String((req.body || {}).message || '');
    if (!message.trim()) return fail(res, 400, 'message required');
    // candidate must own the submission (RLS-scoped read = the gate)
    const { data: sub } = await req.user.supabase.from('work_sample_submissions')
      .select('id, work_sample_id').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');
    // Task context via the candidate-safe projection (078) with the admin client: candidates have
    // no direct RLS read on work_samples (024/077), so an RLS-scoped read here returns null and the
    // assistant goes blind to the problem statement. The view is the single allow-list of
    // candidate-safe columns — rubric/tests/baseline can't leak into the prompt (which the
    // candidate could extract).
    const { data: ws } = await supabaseAdmin.from('work_samples_candidate')
      .select('title, prompt_md').eq('id', sub.work_sample_id).single();

    const reservation = spendGuard.reserve({ accountId: req.user.id, calls: 1 });
    if (!reservation.ok) return res.status(429).json({ error: 'AI budget reached', reason: reservation.reason });

    const { data: prior } = await req.user.supabase.from('ai_interactions')
      .select('seq, role, content').eq('submission_id', req.params.id).order('seq', { ascending: true });
    const history = (prior || []).map((p) => ({ role: p.role, content: p.content }));

    // The candidate's CURRENT editor code (optional) so the AI can read + reason about it.
    const code = typeof (req.body || {}).code === 'string' ? req.body.code : '';
    const language = typeof (req.body || {}).language === 'string' ? req.body.language : '';
    const { reply } = await aiAssistService.chat(ws?.prompt_md, history, message, { code, language, title: ws?.title });

    const now = new Date().toISOString();
    // B-9: allocate seq from the current head and retry ONCE on a UNIQUE(submission_id, seq) clash —
    // the sibling POST /ai-interactions can race this read-then-insert, and a losing insert used to be
    // silently discarded (corrupting the "Direct the AI" replay/timeline + the direction score).
    // source:'server_attested' — the server generated `reply` here, so this transcript is genuinely
    // server-observed, not candidate self-reported. Written via supabaseAdmin (migration 095 removed the
    // candidate's direct-insert path so a candidate can no longer fabricate a flattering exchange).
    const buildRows = (base) => [
      { submission_id: req.params.id, seq: base + 1, role: 'user', content: message.slice(0, 8000), client_ts: now, source: 'server_attested' },
      // 16000, not 8000: AI_ASSIST_MAX_TOKENS=3000 can emit ~12k chars of complete-file suggestion;
      // an 8000 cut lands mid code block, and a reload then loses the closing fence — the panel's
      // extractCode() finds no suggestion and the Review/Apply buttons vanish from the replay.
      { submission_id: req.params.id, seq: base + 2, role: 'assistant', content: String(reply).slice(0, 16000), client_ts: now, source: 'server_attested' },
    ];
    let base = prior && prior.length ? prior[prior.length - 1].seq : 0;
    let ins = await supabaseAdmin.from('ai_interactions').insert(buildRows(base));
    if (ins.error && ins.error.code === '23505') {
      const { data: head } = await supabaseAdmin.from('ai_interactions')
        .select('seq').eq('submission_id', req.params.id).order('seq', { ascending: false }).limit(1);
      base = head && head.length ? head[0].seq : base + 2;
      ins = await supabaseAdmin.from('ai_interactions').insert(buildRows(base));
    }
    if (ins.error) return fail(res, 500, ins.error.message);
    res.json({ reply, seq: base + 2 });
  } catch (e) { fail(res, 500, e.message); }
});

// --- Recruiter: a TIMESTAMPED activity timeline ("what happened, when") for a submission ---
// Merges server-observed integrity events (tab/focus/paste), the candidate's AI prompts, and the
// start/submit milestones into one chronological report with a summary header. Recruiter-only and
// tenant-gated: the requester must be a verified recruiter who can READ this screen under RLS.
const EVENT_LABELS = {
  tab_hidden: 'Switched away from the tab',
  tab_visible: 'Returned to the tab',
  window_blur: 'Window lost focus',
  window_focus: 'Window regained focus',
  paste: 'Pasted into the editor',
  large_paste: 'Large paste into the editor',
  automation_suspected: 'Automation/bot signal',
  bot_verdict: 'Automation/bot verdict',
  // AV presence flags (TOU-147). Non-judgmental by design: they say what happened, never a
  // verdict. A camera turned off mid-screen is a prompt to look, not a conclusion.
  av_consent_granted: 'Camera and mic enabled with consent',
  av_camera_off: 'Camera turned off',
  av_camera_on: 'Camera turned back on',
  av_mic_muted: 'Microphone muted',
  av_mic_unmuted: 'Microphone unmuted',
  av_revoked: 'Camera/mic access revoked',
};
// ADR-001 Principle 7 (red line): declining or withdrawing consent to the OPTIONAL verified
// session must NEVER become a recruiter-visible signal — exercising that right cannot be penalized.
// These are the append_integrity_event p_type values written by verifiedSession.js on decline/withdraw;
// they are stripped from everything the recruiter sees. (A GRANT is kept: it legitimately explains a
// captured walkthrough.)
const CONSENT_HIDDEN_TYPES = new Set(['consent_declined', 'consent_withdrawn']);
router.get('/submissions/:id/timeline', requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.id)) return fail(res, 400, 'invalid id');
    const { data: sub } = await req.user.supabase.from('work_sample_submissions')
      .select('id, work_sample_id, started_at, submitted_at, status').eq('id', req.params.id).single();
    if (!sub) return fail(res, 404, 'submission not found or not accessible');
    // Tenant gate: only someone who can read the screen under RLS (owner/teammate) sees the timeline.
    const { data: ws } = await req.user.supabase.from('work_samples').select('id, title').eq('id', sub.work_sample_id).single();
    if (!ws) return fail(res, 403, 'not allowed');

    const [{ data: allEvents }, { data: ai }] = await Promise.all([
      supabaseAdmin.from('submission_integrity_events')
        .select('type, category, meta, client_ts, source').eq('submission_id', sub.id).order('seq', { ascending: true }),
      supabaseAdmin.from('ai_interactions')
        .select('role, content, client_ts, seq').eq('submission_id', sub.id).order('seq', { ascending: true }),
    ]);
    // Strip consent decline/withdrawal (red line above) BEFORE any recruiter-facing derivation, so
    // nothing leaks — not the timeline row, and not an inflated `events` count in the summary.
    const events = (allEvents || []).filter((e) => !CONSENT_HIDDEN_TYPES.has(e.type));

    const items = [];
    if (sub.started_at) items.push({ ts: sub.started_at, kind: 'milestone', label: 'Started the screen' });
    for (const e of events || []) {
      // Server-observed signals are the trustworthy ones; client-attested are shown but marked.
      const chars = e.meta && (e.meta.chars || e.meta.length);
      const label = EVENT_LABELS[e.type] || e.type.replace(/_/g, ' ');
      items.push({
        ts: e.client_ts, kind: 'integrity', type: e.type, label,
        detail: chars ? `${chars} chars` : undefined,
        attested: e.source !== 'server_observed',
      });
    }
    for (const t of ai || []) {
      if (t.role !== 'user') continue;
      items.push({ ts: t.client_ts, kind: 'ai', label: 'Asked the AI', detail: String(t.content || '').slice(0, 140) });
    }
    if (sub.submitted_at) items.push({ ts: sub.submitted_at, kind: 'milestone', label: 'Submitted' });

    items.sort((a, b) => {
      const ta = a.ts ? Date.parse(a.ts) : Infinity;
      const tb = b.ts ? Date.parse(b.ts) : Infinity;
      return ta - tb;
    });

    const aiPrompts = (ai || []).filter((t) => t.role === 'user').length;
    const serverEvents = (events || []).filter((e) => e.source === 'server_observed');
    const pastes = serverEvents.filter((e) => e.type === 'paste' || e.type === 'large_paste').length;
    const tabSwitches = serverEvents.filter((e) => e.type === 'tab_hidden').length;
    const durationMin = sub.started_at && sub.submitted_at
      ? Math.max(0, Math.round((Date.parse(sub.submitted_at) - Date.parse(sub.started_at)) / 60000)) : null;

    res.json({
      screen: ws.title,
      summary: { ai_prompts: aiPrompts, pastes, tab_switches: tabSwitches, events: (events || []).length, duration_min: durationMin, started_at: sub.started_at, submitted_at: sub.submitted_at },
      items,
    });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
// Shared with portal.js (invite claim) and unit tests (funnel shaping), same pattern as
// verifiedSession.isOfferable.
module.exports.findSubmission = findSubmission;
module.exports.createSubmission = createSubmission;
module.exports.buildInviteFunnel = buildInviteFunnel;
module.exports.resetDeclinedSubmission = resetDeclinedSubmission;
// TOU-146/147 validators + gate check (unit-tested in deliverables.spec.js / avStartGate.spec.js).
module.exports.sanitizeDeliverables = sanitizeDeliverables;
module.exports.sanitizeDeliverablesCheck = sanitizeDeliverablesCheck;
module.exports.avConsentError = avConsentError;
module.exports.recordAvConsent = recordAvConsent;
