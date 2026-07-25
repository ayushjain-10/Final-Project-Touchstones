/**
 * Client Review Portal
 *
 * Recruiters can invite an external client to review one scored work-sample
 * result. The client link is a bearer capability stored only as a SHA-256 hash.
 * Public responses intentionally omit raw submissions, media, transcripts, and
 * protected attributes.
 */
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const emailService = require('../../services/emailService');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Abuse limits for the invite/email surfaces (route-level, no migration needed).
const MAX_INVITES_PER_SUBMISSION_PER_DAY = 20;
const MAX_CLIENT_COMMENTS_PER_INVITE = 50;
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_RESENDS_PER_INVITE = 20;
const NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000;

function cleanText(value, max = 4000) {
  const text = String(value || '').trim();
  if (!text) return '';
  let out = text.slice(0, max);
  // Never cut a surrogate pair in half: a trailing lone high surrogate is
  // invalid UTF-8 for Postgres and turns bad input into a 500.
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function reviewUrl(token) {
  return `${frontendBaseUrl()}/client-review/${encodeURIComponent(token)}`;
}

function displayName(profile) {
  if (!profile) return null;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  // No email fallback: every caller renders on the token-gated public page or in
  // emails to the external client, so a nameless profile must never leak a raw
  // email address. Recruiter-authenticated surfaces use recruiterName below.
  return name || null;
}

function recruiterName(user) {
  // No email fallback: recruiterName is stored as the shared-comment author_name
  // and used in notification emails, both of which the external client sees, so a
  // nameless recruiter must not leak their raw email. Falls back to a neutral label.
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return name || user?.company || 'The hiring team';
}

function effectiveStatus(invite) {
  if (!invite) return null;
  if (invite.status === 'revoked') return 'revoked';
  // Expiry applies to decided invites too: a decided link past its window is
  // 'expired' on the public routes instead of staying valid forever. Within the
  // window a decided invite still reads 'decided'.
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return 'expired';
  return invite.status || 'pending';
}

function publicCriterionRows(score) {
  const rows = Array.isArray(score?.per_criterion)
    ? score.per_criterion
    : score?.per_criterion && typeof score.per_criterion === 'object'
      ? Object.values(score.per_criterion)
      : [];
  return rows.slice(0, 12).map((row, index) => ({
    id: row.id || row.criterion_id || `criterion-${index + 1}`,
    label: row.label || row.requirement || row.name || `Criterion ${index + 1}`,
    points_awarded: row.points_awarded ?? row.awarded ?? row.score ?? null,
    points_possible: row.points_possible ?? row.possible ?? row.max ?? null,
    reasoning: cleanText(row.reasoning || row.rationale || row.explanation, 900) || null,
  }));
}

// Mirrors the cri_recruiter_select RLS predicate ("owner_id = auth.uid() OR
// public.is_workspace_member(owner_id)", migrations 038/100) in route logic.
// Required because the RLS submission read in the loaders below ALSO passes when
// the caller is the submission's CANDIDATE (wss policies include
// candidate_id = auth.uid()), while everything after the loaders fans out with
// supabaseAdmin (service role, RLS bypassed).
async function recruiterOwnsOrInWorkspace(req, ownerId) {
  if (!ownerId) return false;
  if (ownerId === req.user.id) return true;
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('member_id', req.user.id)
    .eq('status', 'active')
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function loadSubmissionContextForRecruiter(req, submissionId) {
  const { data: submission, error } = await req.user.supabase
    .from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, status, started_at, submitted_at, deadline_at, created_at')
    .eq('id', submissionId)
    .single();
  if (error || !submission) return null;

  const { data: workSample } = await supabaseAdmin
    .from('work_samples')
    .select('id, title, role_family, owner_id, response_type')
    .eq('id', submission.work_sample_id)
    .single();
  if (!workSample) return null;
  // OWNERSHIP GATE (mirrors proof.js DELETE /work-samples/:id): reject when the
  // only reason the RLS read passed is that the caller is the candidate.
  if (!(await recruiterOwnsOrInWorkspace(req, workSample.owner_id))) return null;
  return { submission, workSample };
}

async function loadLatestScore(submissionId) {
  const { data } = await supabaseAdmin
    .from('proof_scores')
    .select('id, normalized_score, raw_points_awarded, raw_points_possible, outcome, per_criterion, created_at')
    .eq('submission_id', submissionId)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
    .limit(1);
  return Array.isArray(data) ? data[0] || null : null;
}

async function loadProfile(id) {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, email, first_name, last_name, company')
    .eq('id', id)
    .single();
  return data || null;
}

async function loadReviewBundleBySubmission(submissionId) {
  const { data: invites, error } = await supabaseAdmin
    .from('client_review_invites')
    .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at, updated_at')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const ids = (invites || []).map((invite) => invite.id);
  if (!ids.length) return [];

  const [{ data: comments }, { data: decisions }] = await Promise.all([
    supabaseAdmin
      .from('client_review_comments')
      .select('id, invite_id, author_type, author_id, author_name, author_email, visibility, body, created_at')
      .in('invite_id', ids)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('client_review_decisions')
      .select('id, invite_id, decision, reasoning, created_at, updated_at')
      .in('invite_id', ids),
  ]);

  const commentsByInvite = {};
  for (const comment of comments || []) {
    if (!commentsByInvite[comment.invite_id]) commentsByInvite[comment.invite_id] = [];
    commentsByInvite[comment.invite_id].push(comment);
  }
  const decisionsByInvite = Object.fromEntries((decisions || []).map((decision) => [decision.invite_id, decision]));

  return (invites || []).map((invite) => ({
    ...invite,
    status: effectiveStatus(invite),
    comments: commentsByInvite[invite.id] || [],
    decision: decisionsByInvite[invite.id] || null,
  }));
}

async function loadInviteByToken(token) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(token || ''))) return null;
  const { data } = await supabaseAdmin
    .from('client_review_invites')
    .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at')
    .eq('token_hash', tokenHash(token))
    .single();
  return data || null;
}

async function assertPublicInvite(token, res) {
  const invite = await loadInviteByToken(token);
  if (!invite) {
    fail(res, 404, 'review link not found');
    return null;
  }
  const status = effectiveStatus(invite);
  if (status === 'revoked') {
    fail(res, 410, 'review link was revoked');
    return null;
  }
  if (status === 'expired') {
    await supabaseAdmin.from('client_review_invites').update({ status: 'expired' }).eq('id', invite.id).eq('status', 'pending');
    fail(res, 410, 'review link expired');
    return null;
  }
  return { ...invite, status };
}

async function safePublicReview(invite) {
  const [{ data: submission }, score, owner] = await Promise.all([
    supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, candidate_id, status, started_at, submitted_at, created_at')
      .eq('id', invite.submission_id)
      .single(),
    invite.score_id
      ? supabaseAdmin
        .from('proof_scores')
        .select('id, normalized_score, raw_points_awarded, raw_points_possible, outcome, per_criterion, created_at')
        .eq('id', invite.score_id)
        .single()
        .then(({ data }) => data || null)
      : loadLatestScore(invite.submission_id),
    loadProfile(invite.owner_id),
  ]);
  if (!submission) return null;

  const [{ data: workSample }, candidate, { data: comments }, { data: decision }] = await Promise.all([
    supabaseAdmin
      .from('work_samples')
      .select('id, title, role_family')
      .eq('id', submission.work_sample_id)
      .single(),
    loadProfile(submission.candidate_id),
    supabaseAdmin
      .from('client_review_comments')
      .select('id, author_type, author_name, visibility, body, created_at')
      .eq('invite_id', invite.id)
      .eq('visibility', 'shared')
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('client_review_decisions')
      .select('id, decision, reasoning, created_at, updated_at')
      .eq('invite_id', invite.id)
      .maybeSingle(),
  ]);

  return {
    review: {
      id: invite.id,
      status: invite.status,
      client_name: invite.client_name,
      message: invite.message,
      expires_at: invite.expires_at,
      created_at: invite.created_at,
    },
    recruiter: {
      name: displayName(owner) || owner?.company || 'The hiring team',
      company: owner?.company || null,
    },
    candidate: {
      label: displayName(candidate) || 'Candidate',
    },
    screen: {
      title: workSample?.title || 'Untitled screen',
      role_family: workSample?.role_family || null,
    },
    submission: {
      status: submission.status,
      started_at: submission.started_at,
      submitted_at: submission.submitted_at,
    },
    score: score
      ? {
          id: score.id,
          normalized_score: score.normalized_score,
          raw_points_awarded: score.raw_points_awarded,
          raw_points_possible: score.raw_points_possible,
          outcome: score.outcome,
          created_at: score.created_at,
          criteria: publicCriterionRows(score),
        }
      : null,
    comments: comments || [],
    decision: decision || null,
  };
}

function inviteEmailHtml({ from, screenTitle, candidateLabel, link, message }) {
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
  return `
    <div style="font-family: Inter, Arial, sans-serif; color: #2b211b; line-height: 1.55;">
      <p>Hi,</p>
      <p>${esc(from)} invited you to review ${esc(candidateLabel)} for ${esc(screenTitle)} in Touchstones.</p>
      ${message ? `<p style="border-left: 3px solid #c86f4a; padding-left: 12px; color: #6b5b50;">${esc(message)}</p>` : ''}
      <p><a href="${esc(link)}" style="background:#9f4f32;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;display:inline-block;">Open client review</a></p>
      <p style="font-size: 12px; color: #85766a;">This review includes the candidate score, rubric reasoning, shared comments, and your decision form. It does not include raw media, transcripts, or biometric signals.</p>
    </div>
  `;
}

function simpleEmailHtml({ title, body, link, cta }) {
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
  return `
    <div style="font-family: Inter, Arial, sans-serif; color: #2b211b; line-height: 1.55;">
      <h1 style="font-size: 18px; margin: 0 0 12px;">${esc(title)}</h1>
      <p>${esc(body)}</p>
      ${link ? `<p><a href="${esc(link)}" style="background:#9f4f32;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;display:inline-block;">${esc(cta || 'Open review')}</a></p>` : ''}
      <p style="font-size: 12px; color: #85766a;">Touchstones keeps client feedback attached to the scored result.</p>
    </div>
  `;
}

async function sendEmailSafe(options) {
  try {
    const result = await emailService.sendEmail(options);
    return {
      email_sent: !!(result && result.success),
      email_error: (result && result.error) || null,
    };
  } catch (e) {
    return { email_sent: false, email_error: e.message };
  }
}

async function loadInviteContextForRecruiter(req, inviteId) {
  const { data: invite } = await req.user.supabase
    .from('client_review_invites')
    .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at, updated_at')
    .eq('id', inviteId)
    .single();
  if (!invite) return null;

  const { data: submission } = await supabaseAdmin
    .from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, status, submitted_at')
    .eq('id', invite.submission_id)
    .single();
  if (!submission) return null;

  const [{ data: workSample }, candidate] = await Promise.all([
    supabaseAdmin
      .from('work_samples')
      .select('id, title, role_family, owner_id')
      .eq('id', submission.work_sample_id)
      .single(),
    loadProfile(submission.candidate_id),
  ]);
  if (!workSample) return null;
  // Belt-and-suspenders: cri_recruiter_select already scopes the invite read to
  // owner/workspace member, but assert it here too before any service-role write.
  if (!(await recruiterOwnsOrInWorkspace(req, workSample.owner_id))) return null;
  return { invite, submission, workSample, candidate };
}

// Debounce recruiter notifications per invite: repeated public writes on the
// same invite within the window send at most one email. In-memory (per process)
// is enough here: the goal is flood damping, not exactly-once delivery.
const lastNotifyAtByInvite = new Map();
function shouldNotifyRecruiter(inviteId) {
  const now = Date.now();
  const last = lastNotifyAtByInvite.get(inviteId) || 0;
  if (now - last < NOTIFY_DEBOUNCE_MS) return false;
  if (lastNotifyAtByInvite.size > 5000) {
    for (const [id, ts] of lastNotifyAtByInvite) {
      if (now - ts >= NOTIFY_DEBOUNCE_MS) lastNotifyAtByInvite.delete(id);
    }
  }
  lastNotifyAtByInvite.set(inviteId, now);
  return true;
}

async function notifyRecruiter({ invite, title, body, link }) {
  const recipients = [invite.owner_id, invite.created_by].filter(Boolean);
  const unique = [...new Set(recipients)];
  const profiles = [];
  for (const id of unique) {
    const profile = await loadProfile(id);
    if (profile?.email) profiles.push(profile);
  }
  await Promise.all(profiles.map((profile) => sendEmailSafe({
    to: profile.email,
    subject: title,
    body: `${body}${link ? `\n\nOpen review: ${link}` : ''}`,
    html: simpleEmailHtml({ title, body, link, cta: 'Open result' }),
    fromName: 'Touchstones',
  })));
}

// Recruiter: list client reviews for one proof submission.
router.get('/submissions/:submissionId', supabaseAuth, requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.submissionId)) return fail(res, 400, 'invalid submission id');
    const context = await loadSubmissionContextForRecruiter(req, req.params.submissionId);
    if (!context) return fail(res, 404, 'submission not found or not accessible');
    const reviews = await loadReviewBundleBySubmission(context.submission.id);
    res.json({ submission_id: context.submission.id, reviews });
  } catch (e) {
    console.error('client review list failed:', e.message);
    fail(res, 500, 'could not load client reviews');
  }
});

// Recruiter: create and optionally email a client review invite.
router.post('/submissions/:submissionId/invites', supabaseAuth, requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.submissionId)) return fail(res, 400, 'invalid submission id');
    const email = cleanEmail(req.body?.email);
    if (!isEmail(email)) return fail(res, 400, 'a valid client email is required');
    const clientName = cleanText(req.body?.name, 120) || null;
    const message = cleanText(req.body?.message, 1000) || null;

    const context = await loadSubmissionContextForRecruiter(req, req.params.submissionId);
    if (!context) return fail(res, 404, 'submission not found or not accessible');

    const score = await loadLatestScore(context.submission.id);
    if (!score) return fail(res, 409, 'client reviews require a scored submission');

    // Dedup: re-inviting the same client on the same submission reuses the
    // existing invite row (rotating its token) instead of inserting and
    // emailing a new row each time.
    const { data: existingRows } = await supabaseAdmin
      .from('client_review_invites')
      .select('id, client_name, message, updated_at')
      .eq('submission_id', context.submission.id)
      .eq('client_email', email)
      .order('created_at', { ascending: false })
      .limit(1);
    const existing = (Array.isArray(existingRows) && existingRows[0]) || null;

    const token = makeToken();
    const link = reviewUrl(token);
    let invite;
    if (existing) {
      if (existing.updated_at && Date.now() - new Date(existing.updated_at).getTime() < RESEND_COOLDOWN_MS) {
        return fail(res, 429, 'this client was invited moments ago, try again in a few minutes');
      }
      const { data: updated, error } = await req.user.supabase
        .from('client_review_invites')
        .update({
          token_hash: tokenHash(token),
          status: 'pending',
          score_id: score.id,
          client_name: clientName || existing.client_name || null,
          message: message || existing.message || null,
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at, updated_at')
        .single();
      if (error) return fail(res, 500, error.message);
      invite = updated;
    } else {
      // Cap NEW invites per submission per day so this route cannot become an
      // email cannon (reuse above is bounded by the cooldown instead).
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentInvites } = await supabaseAdmin
        .from('client_review_invites')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', context.submission.id)
        .gte('created_at', dayAgo);
      if ((recentInvites || 0) >= MAX_INVITES_PER_SUBMISSION_PER_DAY) {
        return fail(res, 429, 'invite limit reached for this submission, try again tomorrow');
      }
      const { data: created, error } = await req.user.supabase
        .from('client_review_invites')
        .insert({
          owner_id: context.workSample.owner_id,
          created_by: req.user.id,
          submission_id: context.submission.id,
          score_id: score.id,
          client_email: email,
          client_name: clientName,
          token_hash: tokenHash(token),
          message,
        })
        .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at, updated_at')
        .single();
      if (error) return fail(res, 500, error.message);
      invite = created;
    }

    const candidate = await loadProfile(context.submission.candidate_id);
    const candidateLabel = displayName(candidate) || 'this candidate';
    const from = recruiterName(req.user);
    const body = [
      'Hi,',
      '',
      `${from} invited you to review ${candidateLabel} for ${context.workSample.title || 'a Touchstones screen'}.`,
      message ? `\n"${message}"` : '',
      '',
      `Open the review: ${link}`,
      '',
      'This page shows the score, rubric reasoning, shared comments, and your decision form. It does not include raw media, transcripts, or biometric signals.',
      '',
      'Touchstones',
    ].join('\n');

    let email_sent = false;
    let email_error = null;
    try {
      const result = await emailService.sendEmail({
        to: email,
        subject: `Review ${candidateLabel} in Touchstones`,
        body,
        html: inviteEmailHtml({ from, screenTitle: context.workSample.title || 'a Touchstones screen', candidateLabel, link, message }),
        fromName: 'Touchstones',
      });
      email_sent = !!(result && result.success);
      email_error = (result && result.error) || null;
    } catch (e) {
      email_error = e.message;
    }

    res.status(201).json({
      invite: { ...invite, status: effectiveStatus(invite), comments: [], decision: null },
      review_url: link,
      email_sent,
      email_error,
    });
  } catch (e) {
    console.error('client review invite failed:', e.message);
    fail(res, 500, 'could not create client review invite');
  }
});

// Lifetime resend counter, in memory per process: enough to stop a runaway
// resend loop without a schema change (resets on deploy, which is acceptable
// because the cooldown below still bounds the rate).
const resendCountByInvite = new Map();

// Recruiter: rotate the token and resend the client review link.
router.post('/invites/:inviteId/resend', supabaseAuth, requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.inviteId)) return fail(res, 400, 'invalid invite id');
    const context = await loadInviteContextForRecruiter(req, req.params.inviteId);
    if (!context) return fail(res, 404, 'invite not found or not accessible');
    const { invite, workSample, candidate } = context;
    // Raw stored status, not effectiveStatus: a decided invite stays
    // non-resendable even after it expires.
    if (invite.status === 'decided') return fail(res, 409, 'client already submitted a decision');
    if (invite.updated_at && Date.now() - new Date(invite.updated_at).getTime() < RESEND_COOLDOWN_MS) {
      return fail(res, 429, 'this invite was sent moments ago, try again in a few minutes');
    }
    const resends = resendCountByInvite.get(invite.id) || 0;
    if (resends >= MAX_RESENDS_PER_INVITE) return fail(res, 429, 'resend limit reached for this invite');
    resendCountByInvite.set(invite.id, resends + 1);

    const token = makeToken();
    const link = reviewUrl(token);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: updated, error } = await req.user.supabase
      .from('client_review_invites')
      .update({
        token_hash: tokenHash(token),
        status: 'pending',
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id)
      .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at, updated_at')
      .single();
    if (error) return fail(res, 500, error.message);

    const candidateLabel = displayName(candidate) || 'this candidate';
    const from = recruiterName(req.user);
    const body = [
      'Hi,',
      '',
      `${from} resent your Touchstones review link for ${candidateLabel} on ${workSample.title || 'a Touchstones screen'}.`,
      '',
      `Open the review: ${link}`,
      '',
      'Touchstones',
    ].join('\n');
    const emailResult = await sendEmailSafe({
      to: invite.client_email,
      subject: `Review link: ${candidateLabel} in Touchstones`,
      body,
      html: inviteEmailHtml({ from, screenTitle: workSample.title || 'a Touchstones screen', candidateLabel, link, message: invite.message }),
      fromName: 'Touchstones',
    });

    res.json({
      invite: { ...updated, status: effectiveStatus(updated) },
      review_url: link,
      ...emailResult,
    });
  } catch (e) {
    console.error('client review resend failed:', e.message);
    fail(res, 500, 'could not resend client review');
  }
});

// Recruiter: revoke the current public client review link.
router.post('/invites/:inviteId/revoke', supabaseAuth, requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.inviteId)) return fail(res, 400, 'invalid invite id');
    const context = await loadInviteContextForRecruiter(req, req.params.inviteId);
    if (!context) return fail(res, 404, 'invite not found or not accessible');
    const { data: updated, error } = await req.user.supabase
      .from('client_review_invites')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', context.invite.id)
      .select('id, owner_id, created_by, submission_id, score_id, client_email, client_name, status, message, expires_at, last_viewed_at, decided_at, created_at, updated_at')
      .single();
    if (error) return fail(res, 500, error.message);
    res.json({ invite: { ...updated, status: effectiveStatus(updated) } });
  } catch (e) {
    console.error('client review revoke failed:', e.message);
    fail(res, 500, 'could not revoke client review');
  }
});

// Recruiter: add a shared or internal comment to an invite.
router.post('/invites/:inviteId/comments', supabaseAuth, requireRecruiter, async (req, res) => {
  try {
    if (!isUUID(req.params.inviteId)) return fail(res, 400, 'invalid invite id');
    const body = cleanText(req.body?.body, 4000);
    if (!body) return fail(res, 400, 'comment body is required');
    const visibility = req.body?.visibility === 'internal' ? 'internal' : 'shared';

    const context = await loadInviteContextForRecruiter(req, req.params.inviteId);
    if (!context) return fail(res, 404, 'invite not found or not accessible');
    const { invite, workSample, candidate } = context;

    const { data: comment, error } = await req.user.supabase
      .from('client_review_comments')
      .insert({
        owner_id: invite.owner_id,
        invite_id: invite.id,
        author_type: 'recruiter',
        author_id: req.user.id,
        author_name: recruiterName(req.user),
        author_email: req.user.email,
        visibility,
        body,
      })
      .select('id, invite_id, author_type, author_id, author_name, author_email, visibility, body, created_at')
      .single();
    if (error) return fail(res, 500, error.message);
    let email_sent = false;
    let email_error = null;
    if (visibility === 'shared') {
      const result = await sendEmailSafe({
        to: invite.client_email,
        subject: `New Touchstones note on ${displayName(candidate) || 'a candidate'}`,
        body: `${recruiterName(req.user)} added a shared note on ${workSample.title || 'a Touchstones screen'}.\n\n${body}`,
        html: simpleEmailHtml({
          title: 'New shared review note',
          body: `${recruiterName(req.user)} added a shared note on ${workSample.title || 'a Touchstones screen'}.`,
          link: null,
        }),
        fromName: 'Touchstones',
      });
      email_sent = result.email_sent;
      email_error = result.email_error;
    }
    res.status(201).json({ comment, email_sent, email_error });
  } catch (e) {
    console.error('client review recruiter comment failed:', e.message);
    fail(res, 500, 'could not add comment');
  }
});

// Public client: load a token-gated review.
router.get('/public/:token', async (req, res) => {
  try {
    const invite = await assertPublicInvite(req.params.token, res);
    if (!invite) return;
    if (invite.status === 'pending') {
      await supabaseAdmin
        .from('client_review_invites')
        .update({ status: 'viewed', last_viewed_at: new Date().toISOString() })
        .eq('id', invite.id)
        .eq('status', 'pending');
      invite.status = 'viewed';
    } else if (!invite.last_viewed_at) {
      await supabaseAdmin
        .from('client_review_invites')
        .update({ last_viewed_at: new Date().toISOString() })
        .eq('id', invite.id);
    }
    const review = await safePublicReview(invite);
    if (!review) return fail(res, 404, 'review not found');
    res.json(review);
  } catch (e) {
    console.error('client review public load failed:', e.message);
    fail(res, 500, 'could not load client review');
  }
});

// Per-link limiter for the public WRITE routes: keyed by the token hash so one
// noisy client link cannot flood comments/decisions (and the recruiter's inbox)
// while other links stay unaffected. The global /api limiter still applies; the
// public GET view stays on the global limiter only.
const publicReviewWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => 'crl:' + tokenHash(req.params.token || '').slice(0, 24),
  message: { error: 'Too many requests for this review link, please try again later' },
});

// Public client: add a shared comment.
router.post('/public/:token/comments', publicReviewWriteLimiter, async (req, res) => {
  try {
    const invite = await assertPublicInvite(req.params.token, res);
    if (!invite) return;
    const body = cleanText(req.body?.body, 4000);
    if (!body) return fail(res, 400, 'comment body is required');
    // Cap client comments per invite so a leaked link cannot fill the table.
    const { count: clientComments } = await supabaseAdmin
      .from('client_review_comments')
      .select('id', { count: 'exact', head: true })
      .eq('invite_id', invite.id)
      .eq('author_type', 'client');
    if ((clientComments || 0) >= MAX_CLIENT_COMMENTS_PER_INVITE) {
      return fail(res, 429, 'comment limit reached for this review');
    }
    // The author label comes from the invite, never the request body, so a
    // public commenter cannot impersonate the recruiter in the UI or emails.
    const authorName = invite.client_name || 'Client reviewer';
    const { data: comment, error } = await supabaseAdmin
      .from('client_review_comments')
      .insert({
        owner_id: invite.owner_id,
        invite_id: invite.id,
        author_type: 'client',
        author_name: authorName,
        author_email: invite.client_email,
        visibility: 'shared',
        body,
      })
      .select('id, author_type, author_name, visibility, body, created_at')
      .single();
    if (error) return fail(res, 500, error.message);
    if (shouldNotifyRecruiter(invite.id)) {
      const reviewLink = `${frontendBaseUrl()}/app/result?submission=${invite.submission_id}`;
      notifyRecruiter({
        invite,
        title: 'Client commented on a Touchstones review',
        body: `${authorName} commented: ${body.slice(0, 240)}`,
        link: reviewLink,
      }).catch(() => {});
    }
    res.status(201).json({ comment });
  } catch (e) {
    console.error('client review public comment failed:', e.message);
    fail(res, 500, 'could not add comment');
  }
});

// Public client: submit or update their structured recommendation.
router.post('/public/:token/decision', publicReviewWriteLimiter, async (req, res) => {
  try {
    const invite = await assertPublicInvite(req.params.token, res);
    if (!invite) return;
    const decision = String(req.body?.decision || '');
    if (!['advance', 'reject', 'needs_more_signal'].includes(decision)) {
      return fail(res, 400, 'decision must be advance, reject, or needs_more_signal');
    }
    const reasoning = cleanText(req.body?.reasoning, 2000) || null;
    const { data: existingDecision } = await supabaseAdmin
      .from('client_review_decisions')
      .select('decision')
      .eq('invite_id', invite.id)
      .maybeSingle();
    const { data, error } = await supabaseAdmin
      .from('client_review_decisions')
      .upsert({
        owner_id: invite.owner_id,
        invite_id: invite.id,
        decision,
        reasoning,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'invite_id' })
      .select('id, invite_id, decision, reasoning, created_at, updated_at')
      .single();
    if (error) return fail(res, 500, error.message);
    await supabaseAdmin
      .from('client_review_invites')
      .update({ status: 'decided', decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', invite.id);
    // Only notify when the decision VALUE changed (a re-submit of the same
    // value is a no-op for the recruiter), and debounce repeated notifications.
    const decisionChanged = !existingDecision || existingDecision.decision !== decision;
    if (decisionChanged && shouldNotifyRecruiter(invite.id)) {
      const reviewLink = `${frontendBaseUrl()}/app/result?submission=${invite.submission_id}`;
      notifyRecruiter({
        invite,
        title: 'Client submitted a Touchstones decision',
        body: `Client decision: ${decision}${reasoning ? `. Notes: ${reasoning.slice(0, 240)}` : ''}`,
        link: reviewLink,
      }).catch(() => {});
    }
    res.json({ decision: data });
  } catch (e) {
    console.error('client review public decision failed:', e.message);
    fail(res, 500, 'could not save decision');
  }
});

module.exports = router;
