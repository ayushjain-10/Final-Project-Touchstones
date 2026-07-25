/**
 * Candidate/recruiter portal — account-level routes that aren't recruiter-gated.
 *
 * The role boundary (077-079) makes every signup a candidate and BLOCKS self-promotion at the DB
 * (a BEFORE UPDATE trigger forbids the authenticated role from changing account_type/recruiter_status).
 * So a candidate who wants hiring-team (recruiter) access must REQUEST it through here — the backend
 * sets recruiter_status='pending' via service_role and notifies the founder, who approves (verify) or
 * rejects. account_type stays 'candidate' until verified, preserving the secure default.
 */
const express = require('express');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');
const emailService = require('../../services/emailService');
const emailTemplates = require('../../services/emailTemplates');
const assessmentArchiveService = require('../../services/assessmentArchiveService');
const storageClient = require('../../services/storageClient');
const { verifyTurnstile } = require('../../helpers/turnstile');
const { isDisposableEmail } = require('../../helpers/disposableEmail');
// Shared submission creation from the ?ws self-assign path, reused by the invite claim below so
// invite-claimed submissions are byte-identical to self-assigned ones.
const { findSubmission, createSubmission } = require('./proof');

router.use(supabaseAuth);

// Founder/ops who may approve recruiter requests (comma-separated profile ids). Defaults to the
// founder so the flow works out of the box on dev; override per-env with RECRUITER_ADMIN_IDS.
const ADMINS = new Set(
  String(process.env.RECRUITER_ADMIN_IDS || 'a9195975-9823-4387-86ca-812ce6d48dd0')
    .split(',').map((s) => s.trim()).filter(Boolean),
);

const nameOf = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();

// GET /api/portal/status — the caller's role status (convenience for frontend routing/UI).
router.get('/status', async (req, res) => {
  try {
    const { data: me } = await supabaseAdmin
      .from('profiles').select('account_type, recruiter_status').eq('id', req.user.id).single();
    res.json({
      account_type: me?.account_type || 'candidate',
      recruiter_status: me?.recruiter_status || 'none',
      is_admin: ADMINS.has(req.user.id),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/portal/request-recruiter — a candidate requests hiring-team access (-> pending).
router.post('/request-recruiter', async (req, res) => {
  try {
    const { company, work_email, role_title, note } = req.body || {};
    const { data: me } = await supabaseAdmin
      .from('profiles').select('email, first_name, last_name, account_type, recruiter_status')
      .eq('id', req.user.id).single();
    if (!me) return res.status(404).json({ error: 'profile not found' });
    if (me.account_type === 'recruiter' && me.recruiter_status === 'verified') {
      return res.json({ recruiter_status: 'verified', alreadyVerified: true });
    }
    if (me.recruiter_status === 'pending') {
      return res.json({ recruiter_status: 'pending', alreadyRequested: true });
    }

    // Abuse gate for hiring-team access (the point that unlocks the metered E2B/AI surface).
    // Block throwaway/disposable domains — the work email if one was given, else the account email.
    // (Disposable-only; free webmail like gmail is fine for small teams.)
    if (isDisposableEmail(work_email) || (!work_email && isDisposableEmail(me.email))) {
      return res.status(400).json({ error: 'Please use a permanent work email for hiring-team access.' });
    }
    // Turnstile is a verify-IF-PRESENT forward hook: no widget ships today, so a missing token is
    // allowed (no-op), but once the frontend sends one a failed check is rejected.
    if (req.body && req.body.turnstileToken) {
      const captcha = await verifyTurnstile(req.body.turnstileToken, req.ip);
      if (!captcha.success) return res.status(400).json({ error: captcha.error || 'CAPTCHA verification failed' });
    }

    // Self-serve auto-approval (P0-1), OFF by default. When enabled, verify immediately so a cold
    // recruiter reaches their first screen with zero founder touches; the plan caps (planLimits) +
    // spendGuard already bound the abuse surface. When OFF, the manual pending→approve flow is intact.
    const autoApprove = process.env.RECRUITER_AUTOAPPROVE === 'true';
    if (autoApprove) {
      const { error: vErr } = await supabaseAdmin.from('profiles')
        .update({ account_type: 'recruiter', recruiter_status: 'verified', recruiter_verified_at: new Date().toISOString() })
        .eq('id', req.user.id);
      if (vErr) return res.status(500).json({ error: vErr.message });
      notifyFounderOfRequest({ me, company, work_email, role_title, note, userId: req.user.id, autoApproved: true }).catch(() => {});
      // Return the new status so the frontend can skip the "we'll email you" copy and route straight in.
      return res.json({ recruiter_status: 'verified', autoApproved: true });
    }

    // none or rejected → (re-)request: set pending. account_type stays candidate until verified.
    const { error } = await supabaseAdmin
      .from('profiles').update({ recruiter_status: 'pending' }).eq('id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    notifyFounderOfRequest({ me, company, work_email, role_title, note, userId: req.user.id }).catch(() => {});
    res.json({ recruiter_status: 'pending' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/portal/admin/approve-recruiter — founder-only. body: { user_id, decision:'verify'|'reject' }.
router.post('/admin/approve-recruiter', async (req, res) => {
  try {
    if (!ADMINS.has(req.user.id)) return res.status(403).json({ error: 'not authorized' });
    const { user_id, decision } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    // Fail CLOSED on the privilege-granting branch: only an explicit 'verify' promotes. Anything
    // other than the two known decisions is rejected outright (never defaulted into a grant).
    if (decision !== 'verify' && decision !== 'reject') {
      return res.status(400).json({ error: "decision must be 'verify' or 'reject'" });
    }
    const reject = decision === 'reject';
    const patch = reject
      ? { recruiter_status: 'rejected' }
      : { account_type: 'recruiter', recruiter_status: 'verified', recruiter_verified_at: new Date().toISOString() };
    const { error } = await supabaseAdmin.from('profiles').update(patch).eq('id', user_id);
    if (error) return res.status(500).json({ error: error.message });
    if (!reject) notifyRecruiterApproved(user_id).catch(() => {});
    res.json({ ok: true, user_id, recruiter_status: patch.recruiter_status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/portal/admin/recruiter-requests — founder-only: the pending recruiter-access queue.
router.get('/admin/recruiter-requests', async (req, res) => {
  try {
    if (!ADMINS.has(req.user.id)) return res.status(403).json({ error: 'not authorized' });
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, email, first_name, last_name, company, recruiter_status, updated_at')
      .eq('recruiter_status', 'pending')
      .order('updated_at', { ascending: false });
    res.json({ requests: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Length-cap and strip control chars from caller-supplied request fields before they go into the
// founder email (defense-in-depth: no header injection / runaway content from untrusted input).
const clean = (v, max = 200) =>
  typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function notifyFounderOfRequest({ me, company, work_email, role_title, note, userId, autoApproved = false }) {
  try {
    const to = process.env.RECRUITER_APPROVALS_EMAIL || 'ayush@touchstones.ai';
    const name = nameOf(me) || me.email;
    const c = clean(company), we = clean(work_email), rt = clean(role_title), nt = clean(note, 1000);
    const footer = autoApproved
      ? ['This account was AUTO-APPROVED (RECRUITER_AUTOAPPROVE is on) — no action needed.',
         'To revoke: set profiles.recruiter_status=\'rejected\', account_type=\'candidate\' for this id.']
      : ['Approve by calling POST /api/portal/admin/approve-recruiter { user_id, decision:"verify" } as a founder,',
         'or set profiles.recruiter_status=\'verified\', account_type=\'recruiter\' for this id.'];
    const body = [
      autoApproved ? 'New recruiter AUTO-APPROVED on Touchstones:' : 'New recruiter-access request on Touchstones:',
      '',
      `Name: ${name}`,
      `Account email: ${me.email}`,
      c ? `Company: ${c}` : '',
      we ? `Work email: ${we}` : '',
      rt ? `Role: ${rt}` : '',
      nt ? `Note: ${nt}` : '',
      `Profile id: ${userId}`,
      '',
      ...footer,
    ].filter(Boolean).join('\n');
    const subject = autoApproved ? `New recruiter (auto-approved) — ${name}` : `Recruiter access request — ${name}`;
    const appBase = (process.env.FRONTEND_URL || 'https://touchstones.ai').replace(/\/+$/, '');
    const html = emailTemplates.founderNotice({
      heading: autoApproved ? 'New recruiter (auto-approved)' : 'Recruiter access request',
      intro: autoApproved
        ? 'A new hiring-team account was auto-approved — no action needed.'
        : 'A new hiring team is requesting access and is waiting on your approval.',
      rows: [
        ['Name', name],
        ['Account email', me.email],
        ['Company', c],
        ['Work email', we],
        ['Role', rt],
        ['Note', nt],
        ['Profile id', userId],
      ],
      footnote: footer.join(' '),
      ctaUrl: autoApproved ? '' : `${appBase}/app/recruiter-requests`,
      ctaLabel: 'Review the request',
      preheader: subject,
    });
    await emailService.sendEmail({ to, subject, body, html, fromName: 'Touchstones' });
  } catch (_) { /* best-effort */ }
}

async function notifyRecruiterApproved(userId) {
  try {
    const { data: u } = await supabaseAdmin
      .from('profiles').select('email, first_name').eq('id', userId).single();
    if (!u?.email) return;
    const appUrl = `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/app`;
    const body = [
      `Hi ${u.first_name || 'there'},`,
      '',
      "You're verified as a hiring team on Touchstones — your recruiter dashboard is ready.",
      `Go to your dashboard: ${appUrl}`,
      '',
      '— Touchstones',
    ].join('\n');
    await emailService.sendEmail({
      to: u.email,
      subject: "You're verified — your Touchstones recruiter access is ready",
      body,
      html: emailTemplates.accountWelcome({ firstName: u.first_name, appUrl }),
      fromName: 'Touchstones',
    });
  } catch (_) { /* best-effort */ }
}

const FRONTEND = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

// Candidate-safe screen summaries (+ inviting company) for a set of work_sample ids. Reads the
// allow-list VIEW (never the base table), so rubric/tests/baseline can't leak.
async function screensFor(wsIds) {
  const ids = [...new Set((wsIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data: screens } = await supabaseAdmin
    .from('work_samples_candidate')
    .select('id, owner_id, title, role_family, response_type, duration_minutes, deliverables, av_required')
    .in('id', ids);
  const ownerIds = [...new Set((screens || []).map((s) => s.owner_id).filter(Boolean))];
  let companies = {};
  if (ownerIds.length) {
    const { data: owners } = await supabaseAdmin.from('profiles').select('id, company').in('id', ownerIds);
    companies = Object.fromEntries((owners || []).map((o) => [o.id, o.company]));
  }
  // deliverables + av_required (111/112) ride along so the dashboard and the start gate can
  // render the checklist and the camera/mic notice before the candidate opens the screen.
  return Object.fromEntries((screens || []).map((s) => [s.id, {
    id: s.id, title: s.title, role_family: s.role_family, response_type: s.response_type,
    duration_minutes: s.duration_minutes, company: companies[s.owner_id] || null,
    deliverables: s.deliverables || null, av_required: s.av_required === true,
  }]));
}

// Claim-on-arrival for email invites (migration 106). A recruiter can invite an address before any
// account exists, so nothing would appear on the invited candidate's dashboard until their pending
// invites are converted into real submissions. Runs on the assignments read, via the service role
// (candidates have no write access to invites under RLS). Reuses proof.js's self-assign creation
// (identical defaults, idempotent on (screen, candidate)); no plan metering here because the
// invite endpoint already metered the screen at send time. Best-effort per invite: one bad row
// must never break the dashboard, and unpublished screens stay unclaimed until they publish.
async function claimPendingInvites(user) {
  let email = user && user.email;
  if (!email && user) {
    // Rare profiles lack an email column value; the auth record is authoritative.
    const { data } = await supabaseAdmin.auth.admin.getUserById(user.id);
    email = data && data.user && data.user.email;
  }
  if (!email) return;
  const { data: invites } = await supabaseAdmin
    .from('work_sample_invites')
    .select('id, work_sample_id')
    .eq('email', String(email).toLowerCase())
    .is('claimed_at', null);
  if (!Array.isArray(invites) || !invites.length) return;
  // Candidate-safe view, published only: mirrors the ?ws self-assign gate in proof.js.
  const wsIds = [...new Set(invites.map((i) => i.work_sample_id))];
  const { data: screens } = await supabaseAdmin
    .from('work_samples_candidate')
    .select('id, duration_minutes, job_id')
    .in('id', wsIds).eq('status', 'published');
  const screenById = Object.fromEntries((screens || []).map((s) => [s.id, s]));
  for (const inv of invites) {
    try {
      const ws = screenById[inv.work_sample_id];
      if (!ws) continue;
      let sub = await findSubmission(ws.id, user.id);
      if (!sub) {
        const { data, error } = await createSubmission(ws, user.id);
        if (error) throw new Error(error.message);
        sub = data;
      }
      await supabaseAdmin.from('work_sample_invites')
        .update({ claimed_by: user.id, claimed_at: new Date().toISOString(), submission_id: sub.id })
        .eq('id', inv.id).is('claimed_at', null);
    } catch (e) {
      // PII-free: the invite id only, never the address.
      console.warn('invite claim failed:', inv.id, e.message);
    }
  }
}

// GET /api/portal/assignments: my submissions grouped Pending / In-progress / Completed /
// Expired / Declined (108: a declined screen leaves Pending instead of lingering there).
router.get('/assignments', async (req, res) => {
  try {
    // Convert pending email invites into real submissions BEFORE reading the list, so an invited
    // candidate's first dashboard load already shows the screen (best-effort, never blocks the list).
    await claimPendingInvites(req.user).catch(() => {});
    const { data: subs } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, status, started_at, deadline_at, submitted_at, created_at')
      .eq('candidate_id', req.user.id)
      .order('created_at', { ascending: false });
    const byScreen = await screensFor((subs || []).map((s) => s.work_sample_id));
    const groups = { pending: [], in_progress: [], completed: [], expired: [], declined: [] };
    for (const s of subs || []) {
      const item = { ...s, screen: byScreen[s.work_sample_id] || null };
      if (s.status === 'submitted' || s.status === 'scored' || s.status === 'pending_scoring' || s.status === 'needs_review') groups.completed.push(item);
      else if (s.status === 'expired') groups.expired.push(item);
      else if (s.status === 'in_progress') groups.in_progress.push(item);
      else if (s.status === 'declined') groups.declined.push(item);
      else groups.pending.push(item);
    }
    res.json({ groups, total: (subs || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/portal/credentials — my verified credentials with public verify links.
router.get('/credentials', async (req, res) => {
  try {
    const { data: creds } = await supabaseAdmin
      .from('verified_credentials')
      .select('id, submission_id, public_token, issued_at, score, direction_score')
      .eq('candidate_id', req.user.id)
      .order('issued_at', { ascending: false });
    const subIds = [...new Set((creds || []).map((c) => c.submission_id).filter(Boolean))];
    let subToWs = {};
    if (subIds.length) {
      const { data: ss } = await supabaseAdmin.from('work_sample_submissions').select('id, work_sample_id').in('id', subIds);
      subToWs = Object.fromEntries((ss || []).map((s) => [s.id, s.work_sample_id]));
    }
    const byScreen = await screensFor(Object.values(subToWs));
    const credentials = (creds || []).map((c) => ({
      id: c.id, issued_at: c.issued_at, score: c.score, direction_score: c.direction_score,
      verify_url: FRONTEND ? `${FRONTEND}/verify/${c.public_token}` : null,
      screen: byScreen[subToWs[c.submission_id]] || null,
    }));
    res.json({ credentials });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/portal/results — my completed screens + any issued credential. By default NO raw score
// internals (outcome visibility is employer-controlled; the credential is the candidate-facing
// artifact). A screen can OPT IN to candidate-visible results via rubric.candidate_results_visible
// = true (same jsonb-flag pattern as rubric.ai_allowed, default off): then the candidate sees
// their own score, the overall explanation, and the per-criterion reasoning once scoring lands.
// pending_scoring / needs_review are included so a submission never silently disappears from the
// candidate's list while the scoring pipeline retries or waits on a human.
router.get('/results', async (req, res) => {
  try {
    const { data: subs } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, status, submitted_at, test_results')
      .eq('candidate_id', req.user.id)
      .in('status', ['submitted', 'scored', 'pending_scoring', 'needs_review'])
      .order('submitted_at', { ascending: false });
    const { data: creds } = await supabaseAdmin
      .from('verified_credentials').select('submission_id, public_token, issued_at, score')
      .eq('candidate_id', req.user.id);
    const credBySub = Object.fromEntries((creds || []).map((c) => [c.submission_id, c]));
    const byScreen = await screensFor((subs || []).map((s) => s.work_sample_id));

    // Per-screen results opt-in lives in the owner-side rubric jsonb; only the derived fields
    // below ever reach the browser — never the rubric, and never raw test_results (whose hidden
    // cases carry input/expected).
    const wsIds = [...new Set((subs || []).map((s) => s.work_sample_id))];
    let visibleByWs = {};
    if (wsIds.length) {
      const { data: wsRows } = await supabaseAdmin
        .from('work_samples').select('id, rubric').in('id', wsIds);
      visibleByWs = Object.fromEntries(
        (wsRows || []).map((w) => [w.id, Boolean(w.rubric && w.rubric.candidate_results_visible === true)]),
      );
    }
    const visibleSubIds = (subs || []).filter((s) => visibleByWs[s.work_sample_id]).map((s) => s.id);
    const scoreBySub = {};
    if (visibleSubIds.length) {
      const { data: scores } = await supabaseAdmin
        .from('proof_scores')
        .select('submission_id, normalized_score, overall_explanation, per_criterion, created_at')
        .in('submission_id', visibleSubIds).is('superseded_by', null)
        .order('created_at', { ascending: true });
      for (const sc of scores || []) scoreBySub[sc.submission_id] = sc; // last write = latest live score
    }

    const results = (subs || []).map((s) => {
      const cred = credBySub[s.id];
      const item = {
        id: s.id, status: s.status, submitted_at: s.submitted_at,
        screen: byScreen[s.work_sample_id] || null,
        credential: cred ? { verify_url: FRONTEND ? `${FRONTEND}/verify/${cred.public_token}` : null, issued_at: cred.issued_at } : null,
      };
      if (visibleByWs[s.work_sample_id]) {
        const sc = scoreBySub[s.id];
        const t = s.test_results;
        item.results_visibility = 'full';
        item.result = sc ? {
          score: sc.normalized_score,
          explanation: sc.overall_explanation || null,
          per_criterion: Array.isArray(sc.per_criterion)
            ? sc.per_criterion.map((c) => ({
                id: c.id, verdict: c.verdict, points_awarded: c.points_awarded,
                points_possible: c.points_possible, explanation: c.explanation || null,
              }))
            : [],
          tests: t && t.ran && t.total > 0 ? { passed: t.passedCount, total: t.total } : null,
          scored_at: sc.created_at,
        } : null;
      }
      return item;
    });
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/portal/export — the candidate's own data (privacy: data portability). Downloadable JSON.
router.get('/export', async (req, res) => {
  try {
    const uid = req.user.id;
    const [{ data: profile }, { data: submissions }, { data: credentials }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, email, first_name, last_name, account_type, created_at').eq('id', uid).single(),
      supabaseAdmin.from('work_sample_submissions').select('id, work_sample_id, status, response_text, response_code, started_at, submitted_at, created_at').eq('candidate_id', uid),
      supabaseAdmin.from('verified_credentials').select('id, submission_id, public_token, issued_at, score').eq('candidate_id', uid),
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="touchstones-my-data.json"');
    res.json({ exported_at: new Date().toISOString(), profile, submissions: submissions || [], credentials: credentials || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/portal/delete-account — the candidate erases THEIR OWN account + data (right to erasure).
// All data mutations happen INSIDE one transactional RPC (erase_candidate, migration 083) so they
// commit or roll back atomically — no half-deleted accounts. The RPC also fails CLOSED on every
// guard (must be a candidate, own no screens, be in no workspace), and picks the right strategy:
//   * unscored candidate (no immutable proof_audit_log rows) → hard-delete; we then drop the auth user.
//   * scored candidate → the audit chain is append-only and blocks hard deletion, so the RPC
//     anonymizes PII instead (right-to-erasure via scrubbing); we then scrub the auth identity + ban
//     sign-in. Anonymized data is not personal data, and the immutable trust record stays intact.
router.post('/delete-account', async (req, res) => {
  try {
    if ((req.body || {}).confirm !== 'DELETE') return res.status(400).json({ error: 'confirmation required (confirm: "DELETE")' });
    const uid = req.user.id;
    // ADR-002: collect the candidate's archived-bundle paths BEFORE the erase RPC (afterwards the
    // rows are gone and the blob names — tenants/{owner}/submissions/{id}.json — can't be derived).
    // Collected regardless of the sweep flag: blobs uploaded while archiving was on must still be
    // erased after the owner pauses it (deleteSubmissionArchives gates on creds, not the flag).
    const { data: subs, error: subsErr } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_samples ( owner_id )')
      .eq('candidate_id', uid);
    // Can't enumerate while the archive is reachable → stop BEFORE the RPC. Nothing is erased
    // yet, so the candidate just retries; proceeding would orphan their blobs unfindably.
    if (subsErr && storageClient.isConfigured()) {
      return res.status(503).json({ error: 'Temporary failure preparing erasure. Please try again in a minute.' });
    }
    const archiveEntries = (subs || [])
      .map((s) => ({ submissionId: s.id, ownerId: s.work_samples?.owner_id }))
      .filter((e) => e.ownerId);
    const { data: result, error: rpcErr } = await supabaseAdmin.rpc('erase_candidate', { p_uid: uid });
    if (rpcErr) return res.status(500).json({ error: rpcErr.message });
    // Erasure extends to the archive. Whatever could NOT be deleted (Azure down, creds unset) is
    // reported in the founder erasure email below — a durable record, never a silent orphan.
    let orphanedArchives = [];
    if (result && result.ok === true && archiveEntries.length) {
      orphanedArchives = await assessmentArchiveService
        .deleteSubmissionArchives(archiveEntries)
        .catch(() => archiveEntries);
    }
    // Founder awareness of erasures (fire-and-forget, PII-free: id + mode only — the data is gone).
    if (result && result.ok === true) {
      const founderTo = process.env.FOUNDER_NOTIFY_EMAIL || process.env.DEMO_REQUEST_INBOX;
      if (founderTo) {
        const orphanNote = orphanedArchives.length
          ? `\n\nACTION NEEDED: ${orphanedArchives.length} archived assessment bundle(s) could not be deleted from Azure (ADR-002). Delete manually: ${orphanedArchives.map((o) => `tenants/${o.ownerId}/submissions/${o.submissionId}.json`).join(', ')}`
          : '';
        emailService
          .sendEmail({
            to: founderTo,
            subject: 'Account erased (right to erasure)',
            body: `A candidate erased their account.\n\nProfile id: ${uid}\nMode: ${result.mode || 'unknown'}${orphanNote}`,
            html: emailTemplates.founderNotice({
              heading: 'Account erased (right to erasure)',
              intro: 'A candidate deleted their own account. Their data has been erased/anonymized — this notice carries ids only.',
              rows: [
                ['Profile id', uid],
                ['Mode', result.mode || 'unknown'],
                ...(orphanedArchives.length
                  ? [['Archive blobs needing manual deletion', orphanedArchives.map((o) => `tenants/${o.ownerId}/submissions/${o.submissionId}.json`).join('; ')]]
                  : []),
              ],
              preheader: 'Account erased (right to erasure)',
            }),
            fromName: 'Touchstones',
          })
          .catch(() => {});
      }
    }
    if (!result || result.ok !== true) {
      const reason = result && result.reason;
      const msg = reason === 'owns_screens' || reason === 'workspace_member' || reason === 'not_candidate'
        ? 'This account manages screens or a team — contact support to delete it.'
        : 'Could not delete this account.';
      return res.status(409).json({ error: msg });
    }
    if (result.mode === 'hard') {
      // No immutable audit rows → remove the auth identity too (cascade is clean: profile only).
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
      if (delErr) return res.status(500).json({ error: 'Data erased, but sign-in could not be removed — contact support.' });
      return res.json({ deleted: true });
    }
    // Anonymized path: can't delete the auth user (append-only audit blocks the cascade). Scrub the
    // auth identity and ban sign-in so the (now PII-free) account can never be used or tied to a person.
    try {
      await supabaseAdmin.auth.admin.updateUserById(uid, {
        email: `deleted-${uid}@deleted.invalid`, user_metadata: {}, ban_duration: '876000h',
      });
    } catch (_) { /* the data scrub already committed; auth scrub is best-effort */ }
    return res.json({ deleted: true, anonymized: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
