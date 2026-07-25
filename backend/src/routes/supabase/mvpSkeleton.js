/**
 * MVP Buildout Skeleton
 *
 * Flag-gated planning surface for the July MVP backlog. These endpoints expose
 * light contracts and safe placeholders so frontend flows can be wired without
 * pretending unfinished automation is production-ready.
 */
const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const integrityDigestService = require('../../services/integrityDigestService');
const verifyService = require('../../services/verifyService');
const emailService = require('../../services/emailService');
const emailTemplates = require('../../services/emailTemplates');

router.use(supabaseAuth);
router.use(requireRecruiter);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

const roadmap = [
  {
    key: 'review_queue',
    title: 'Recruiter Review Queue',
    status: 'partially_live',
    owner_surface: '/app/mvp-buildout',
    target_surface: '/app/activity',
    next: 'Founder queue is live here. Promote saved filters into the main Activity page.',
  },
  {
    key: 'client_notifications',
    title: 'Client Review Notifications',
    status: 'partially_live',
    owner_surface: '/app/result',
    target_surface: '/api/client-reviews',
    next: 'Resend, revoke, and comment/decision emails are live. Add reminder scheduling next.',
  },
  {
    key: 'role_templates',
    title: 'Role Template Library',
    status: 'partially_live',
    owner_surface: '/app/library',
    target_surface: '/api/assessments',
    next: 'Seed 8 to 12 polished role templates with reference solutions.',
  },
  {
    key: 'jd_to_screen',
    title: 'JD to Screen Wizard',
    status: 'partially_live',
    owner_surface: '/app/author?tab=ai',
    target_surface: '/api/screen-gen/from-jd',
    next: 'Add review checklist and hidden-test suggestions before publish.',
  },
  {
    key: 'candidate_preflight',
    title: 'Candidate Preflight and Reminders',
    status: 'partially_live',
    owner_surface: '/candidate',
    target_surface: '/api/mvp-skeleton/candidate-reminders/:submissionId',
    next: 'Manual deadline reminder email is live. Add system check, extension, and scheduling.',
  },
  {
    key: 'decision_packet',
    title: 'One-Page Decision Packet',
    status: 'partially_live',
    owner_surface: '/app/result',
    target_surface: '/api/mvp-skeleton/decision-packets/:submissionId',
    next: 'Packet JSON is live. Add printable PDF or public share page next.',
  },
  {
    key: 'ashby_polish',
    title: 'Ashby End-to-End Polish',
    status: 'partially_live',
    owner_surface: '/app/developers',
    target_surface: '/api/integrations/ashby',
    next: 'Show setup state, write-back fields, and a partner-test checklist.',
  },
  {
    key: 'mvp_analytics',
    title: 'MVP Analytics Dashboard',
    status: 'skeleton',
    owner_surface: '/app/insights',
    target_surface: '/api/mvp-skeleton/analytics',
    next: 'Read real funnel events from Amplitude or warehouse exports.',
  },
];

const analyticsEvents = [
  'invite_sent',
  'candidate_started',
  'candidate_submitted',
  'submission_scored',
  'result_viewed',
  'client_invited',
  'client_decision_submitted',
  'candidate_advanced',
];

function emptySummary() {
  return {
    screens: 0,
    assigned: 0,
    submitted: 0,
    scored: 0,
    client_reviews: 0,
    client_decisions: 0,
  };
}

function readinessItem(key, label, ready, detail, next) {
  return {
    key,
    label,
    status: ready ? 'ready' : 'missing',
    detail,
    next,
  };
}

function buildReadiness(queue) {
  const summary = queue.summary || emptySummary();
  const rows = queue.rows || [];
  const emailStatus = emailService.getStatus();
  const pendingRows = rows.filter((row) => row.status === 'assigned' || row.status === 'in_progress');
  const recentResult = rows.find((row) => row.score !== null && row.score !== undefined);
  const readyClientDecision = summary.client_decisions > 0;
  const items = [
    readinessItem(
      'published_screen',
      'One strong screen exists',
      summary.screens > 0,
      `${summary.screens} active screen${summary.screens === 1 ? '' : 's'}`,
      'Create or polish one screen for the first design partner role.',
    ),
    readinessItem(
      'candidate_flow',
      'Candidate flow has been exercised',
      summary.assigned + summary.submitted + summary.scored > 0,
      `${summary.assigned + summary.submitted + summary.scored} submission${summary.assigned + summary.submitted + summary.scored === 1 ? '' : 's'} in flight or complete`,
      'Send the screen to at least one candidate or internal test account.',
    ),
    readinessItem(
      'scored_result',
      'A scored result exists',
      summary.scored > 0,
      `${summary.scored} scored result${summary.scored === 1 ? '' : 's'}`,
      'Complete scoring for one submission before inviting a client reviewer.',
    ),
    readinessItem(
      'client_review',
      'Client review loop is proven',
      summary.client_reviews > 0,
      `${summary.client_reviews} client review invite${summary.client_reviews === 1 ? '' : 's'}`,
      'Invite one hiring manager or design partner to review a scored result.',
    ),
    readinessItem(
      'client_decision',
      'Client decision captured',
      readyClientDecision,
      `${summary.client_decisions} client decision${summary.client_decisions === 1 ? '' : 's'}`,
      'Ask the reviewer to choose advance, reject, or needs more signal.',
    ),
    readinessItem(
      'email_delivery',
      'Transactional email configured',
      Boolean(emailStatus.configured),
      emailStatus.configured ? `Provider: ${emailStatus.provider || 'configured'}` : 'Email provider not configured',
      'Configure Resend or SMTP before sending external pilots.',
    ),
  ];
  const readyCount = items.filter((item) => item.status === 'ready').length;
  return {
    status: readyCount === items.length ? 'ready' : readyCount >= 4 ? 'nearly_ready' : 'setup_needed',
    ready_count: readyCount,
    total_count: items.length,
    score: Math.round((readyCount / items.length) * 100),
    items,
    next_best_actions: items.filter((item) => item.status !== 'ready').slice(0, 3).map((item) => item.next),
    pilot_focus: recentResult
      ? {
          submission_id: recentResult.submission_id,
          candidate: recentResult.candidate,
          screen_title: recentResult.screen_title,
          score: recentResult.score,
        }
      : null,
    pending_candidate_count: pendingRows.length,
  };
}

function buildPilotPlan(queue) {
  const summary = queue.summary || emptySummary();
  const rows = queue.rows || [];
  const scoredRows = rows.filter((row) => row.score !== null && row.score !== undefined);
  const pendingRows = rows.filter((row) => row.status === 'assigned' || row.status === 'in_progress');
  return {
    status: summary.client_decisions > 0 ? 'decision_captured' : summary.client_reviews > 0 ? 'client_reviewing' : summary.scored > 0 ? 'ready_for_client_review' : summary.assigned > 0 ? 'candidate_in_flight' : 'setup_needed',
    stages: [
      {
        key: 'pick_role',
        title: 'Pick one design-partner role',
        status: summary.screens > 0 ? 'done' : 'next',
        evidence: `${summary.screens} active screen${summary.screens === 1 ? '' : 's'}`,
      },
      {
        key: 'send_candidate',
        title: 'Send one candidate or test account',
        status: summary.assigned + summary.submitted + summary.scored > 0 ? 'done' : summary.screens > 0 ? 'next' : 'blocked',
        evidence: `${summary.assigned} active, ${summary.submitted} submitted, ${summary.scored} scored`,
      },
      {
        key: 'review_score',
        title: 'Review one scored result',
        status: summary.scored > 0 ? 'done' : pendingRows.length ? 'next' : 'blocked',
        evidence: scoredRows[0] ? `${scoredRows[0].candidate}: ${scoredRows[0].score}` : 'No scored result yet',
      },
      {
        key: 'invite_client',
        title: 'Invite the hiring manager',
        status: summary.client_reviews > 0 ? 'done' : summary.scored > 0 ? 'next' : 'blocked',
        evidence: `${summary.client_reviews} client review invite${summary.client_reviews === 1 ? '' : 's'}`,
      },
      {
        key: 'capture_decision',
        title: 'Capture advance, reject, or needs more signal',
        status: summary.client_decisions > 0 ? 'done' : summary.client_reviews > 0 ? 'next' : 'blocked',
        evidence: `${summary.client_decisions} client decision${summary.client_decisions === 1 ? '' : 's'}`,
      },
    ],
    next_script: [
      'Pick one role where the pain is obvious and the hiring manager can review within 24 hours.',
      'Send a short screen to one candidate or internal test account.',
      'Open the scored result, invite the hiring manager, and ask for a structured decision.',
      'Use the decision packet as the follow-up artifact for the design partner conversation.',
    ],
  };
}

async function loadReviewQueue(req) {
  const { data: samples } = await req.user.supabase
    .from('work_samples')
    .select('id, title, role_family, owner_id')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(100);
  const sampleRows = samples || [];
  const sampleIds = sampleRows.map((sample) => sample.id);
  if (!sampleIds.length) return { summary: emptySummary(), rows: [] };

  const { data: submissions } = await supabaseAdmin
    .from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, status, submitted_at, deadline_at, created_at')
    .in('work_sample_id', sampleIds)
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = submissions || [];
  const submissionIds = rows.map((row) => row.id);
  const candidateIds = [...new Set(rows.map((row) => row.candidate_id).filter(Boolean))];

  const [{ data: scores }, { data: invites }, { data: profiles }] = await Promise.all([
    submissionIds.length
      ? supabaseAdmin
        .from('proof_scores')
        .select('id, submission_id, normalized_score, created_at')
        .in('submission_id', submissionIds)
        .is('superseded_by', null)
      : Promise.resolve({ data: [] }),
    submissionIds.length
      ? supabaseAdmin
        .from('client_review_invites')
        .select('id, submission_id, status, decided_at')
        .in('submission_id', submissionIds)
      : Promise.resolve({ data: [] }),
    candidateIds.length
      ? supabaseAdmin
        .from('profiles')
        .select('id, email, first_name, last_name')
        .in('id', candidateIds)
      : Promise.resolve({ data: [] }),
  ]);

  const sampleById = Object.fromEntries(sampleRows.map((sample) => [sample.id, sample]));
  const profileById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile]));
  const scoresBySubmission = {};
  for (const score of scores || []) {
    const current = scoresBySubmission[score.submission_id];
    if (!current || String(score.created_at || '') > String(current.created_at || '')) {
      scoresBySubmission[score.submission_id] = score;
    }
  }
  const invitesBySubmission = {};
  for (const invite of invites || []) {
    if (!invitesBySubmission[invite.submission_id]) invitesBySubmission[invite.submission_id] = [];
    invitesBySubmission[invite.submission_id].push(invite);
  }

  const summary = {
    ...emptySummary(),
    screens: sampleRows.length,
    assigned: rows.filter((row) => row.status === 'assigned' || row.status === 'in_progress').length,
    submitted: rows.filter((row) => row.status === 'submitted').length,
    scored: rows.filter((row) => row.status === 'scored').length,
    client_reviews: (invites || []).length,
    client_decisions: (invites || []).filter((invite) => invite.status === 'decided' || invite.decided_at).length,
  };

  return {
    summary,
    rows: rows.map((row) => {
      const sample = sampleById[row.work_sample_id] || {};
      const profile = profileById[row.candidate_id] || {};
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
      const score = scoresBySubmission[row.id] || null;
      const clientReviews = invitesBySubmission[row.id] || [];
      return {
        submission_id: row.id,
        screen_title: sample.title || 'Untitled screen',
        role_family: sample.role_family || null,
        candidate: name || profile.email || 'Candidate',
        status: row.status,
        submitted_at: row.submitted_at,
        deadline_at: row.deadline_at,
        score: score ? score.normalized_score : null,
        client_review_status: clientReviews.find((invite) => invite.status === 'decided')?.status || clientReviews[0]?.status || null,
        client_review_count: clientReviews.length,
      };
    }),
  };
}

function profileName(profile) {
  if (!profile) return null;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  return name || profile.email || null;
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function timeLeftLabel(deadlineAt) {
  if (!deadlineAt) return 'some time';
  const diffMs = new Date(deadlineAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return 'some time';
  if (diffMs <= 0) return 'no time';
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

async function loadCandidateReminderContext(req, submissionId) {
  const { data: submission, error } = await req.user.supabase
    .from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, status, started_at, submitted_at, deadline_at, created_at')
    .eq('id', submissionId)
    .single();
  if (error || !submission) return null;

  const [{ data: workSample }, { data: candidate }] = await Promise.all([
    supabaseAdmin
      .from('work_samples')
      .select('id, title, role_family, owner_id')
      .eq('id', submission.work_sample_id)
      .single(),
    supabaseAdmin
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('id', submission.candidate_id)
      .single(),
  ]);
  if (!workSample || !candidate) return null;
  // OWNER-ONLY (mirrors the proof.js work-sample delete gate): the RLS read above passes for
  // the candidate and for workspace teammates (migration 038 ws_member_select), but the callers
  // write deadline_at and email the candidate via supabaseAdmin, so assert ownership first.
  if (workSample.owner_id !== req.user.id) return null;
  return { submission, workSample, candidate };
}

async function loadDecisionPacket(req, submissionId) {
  const { data: submission, error } = await req.user.supabase
    .from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, status, started_at, submitted_at, deadline_at, created_at')
    .eq('id', submissionId)
    .single();
  if (error || !submission) return null;

  const [{ data: workSample }, { data: candidate }] = await Promise.all([
    supabaseAdmin
      .from('work_samples')
      .select('id, title, role_family, response_type, duration_minutes, owner_id')
      .eq('id', submission.work_sample_id)
      .single(),
    supabaseAdmin
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('id', submission.candidate_id)
      .single(),
  ]);
  if (!workSample) return null;
  // OWNER-ONLY (same gate as loadCandidateReminderContext): the RLS read above also passes for
  // the candidate and for workspace teammates, but everything below is loaded via supabaseAdmin
  // (client emails, decision reasoning, audit hashes, AI direction scores), so assert ownership
  // before any of those reads.
  if (workSample.owner_id !== req.user.id) return null;

  const { data: scoreRows } = await supabaseAdmin
    .from('proof_scores')
    .select('id, normalized_score, raw_points_awarded, raw_points_possible, outcome, per_criterion, model_id, model_version, created_at')
    .eq('submission_id', submission.id)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const score = Array.isArray(scoreRows) ? scoreRows[0] || null : null;

  const [{ data: audit }, digest, { data: direction }, { data: invites }] = await Promise.all([
    score
      ? supabaseAdmin
        .from('proof_audit_log')
        .select('decision_id, proof_score_id, normalized_score, row_hash, input_hash, model_id, model_version, rubric_version, prompt_version, created_at')
        .eq('proof_score_id', score.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    integrityDigestService.computeDigest(submission.id).catch(() => null),
    supabaseAdmin
      .from('ai_direction_scores')
      .select('direction_score, prompt_quality, error_catching, verification_rigor, interaction_count, reasoning, created_at')
      .eq('submission_id', submission.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('client_review_invites')
      .select('id, client_email, client_name, status, decided_at')
      .eq('submission_id', submission.id)
      .order('created_at', { ascending: false }),
  ]);

  const proofState = verifyService.deriveProofOfHumanState(digest);
  const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const inviteIds = (invites || []).map((invite) => invite.id);
  const { data: decisions } = inviteIds.length
    ? await supabaseAdmin
      .from('client_review_decisions')
      .select('invite_id, decision, reasoning, created_at')
      .in('invite_id', inviteIds)
    : { data: [] };
  const decisionByInvite = Object.fromEntries((decisions || []).map((decision) => [decision.invite_id, decision]));
  const clientDecision = (invites || [])
    .map((invite) => ({
      invite_id: invite.id,
      client: invite.client_name || invite.client_email,
      status: invite.status,
      decided_at: invite.decided_at,
      decision: decisionByInvite[invite.id] || null,
    }))
    .find((row) => row.decision) || null;

  return {
    status: 'ready',
    submission_id: submission.id,
    packet_url: `${frontend}/app/result?submission=${submission.id}`,
    generated_at: new Date().toISOString(),
    candidate: {
      id: candidate?.id || submission.candidate_id,
      label: profileName(candidate) || 'Candidate',
    },
    screen: {
      id: workSample.id,
      title: workSample.title || 'Untitled screen',
      role_family: workSample.role_family,
      response_type: workSample.response_type,
      duration_minutes: workSample.duration_minutes,
    },
    submission: {
      status: submission.status,
      started_at: submission.started_at,
      submitted_at: submission.submitted_at,
      deadline_at: submission.deadline_at,
    },
    score: score
      ? {
          id: score.id,
          normalized_score: score.normalized_score,
          raw_points_awarded: score.raw_points_awarded,
          raw_points_possible: score.raw_points_possible,
          outcome: score.outcome,
          per_criterion: score.per_criterion || [],
          model_id: score.model_id,
          model_version: score.model_version,
          created_at: score.created_at,
        }
      : null,
    proof_of_human: {
      state: proofState,
      verified_chain: digest ? Boolean(digest.verified_chain) : null,
      head_hash: digest?.head_hash || null,
      event_count: digest?.event_count || 0,
      summary: digest?.summary || {},
    },
    ai_direction: direction || null,
    client_decision: clientDecision,
    audit: audit
      ? {
          decision_id: audit.decision_id,
          row_hash: audit.row_hash,
          input_hash: audit.input_hash,
          rubric_version: audit.rubric_version,
          prompt_version: audit.prompt_version,
          created_at: audit.created_at,
        }
      : null,
  };
}

router.get('/roadmap', async (_req, res) => {
  res.json({
    enabled: true,
    roadmap,
    analytics_events: analyticsEvents,
  });
});

router.get('/review-queue', async (req, res) => {
  try {
    res.json(await loadReviewQueue(req));
  } catch (e) {
    console.warn('mvp review queue skeleton failed:', e.message);
    res.json({ summary: emptySummary(), rows: [], warning: 'review queue data is not available yet' });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const queue = await loadReviewQueue(req);
    const s = queue.summary || emptySummary();
    res.json({
      status: 'skeleton',
      events: analyticsEvents.map((event) => ({ event, instrumented: ['result_viewed', 'client_invited', 'client_decision_submitted', 'candidate_advanced'].includes(event) })),
      funnel: [
        { step: 'Screens', count: s.screens },
        { step: 'Assigned or started', count: s.assigned },
        { step: 'Submitted', count: s.submitted + s.scored },
        { step: 'Scored', count: s.scored },
        { step: 'Client reviews', count: s.client_reviews },
        { step: 'Client decisions', count: s.client_decisions },
      ],
    });
  } catch (e) {
    res.json({ status: 'skeleton', events: analyticsEvents, funnel: [] });
  }
});

router.get('/readiness', async (req, res) => {
  try {
    const queue = await loadReviewQueue(req);
    res.json(buildReadiness(queue));
  } catch (e) {
    console.warn('mvp readiness failed:', e.message);
    res.json({
      status: 'setup_needed',
      ready_count: 0,
      total_count: 0,
      score: 0,
      items: [],
      next_best_actions: ['Apply pending migrations, then reload the MVP buildout surface.'],
      warning: 'readiness data is not available yet',
    });
  }
});

router.get('/pilot-plan', async (req, res) => {
  try {
    const queue = await loadReviewQueue(req);
    res.json(buildPilotPlan(queue));
  } catch (e) {
    console.warn('mvp pilot plan failed:', e.message);
    res.json({
      status: 'setup_needed',
      stages: [],
      next_script: ['Apply pending migrations, then run one end-to-end design partner pilot.'],
      warning: 'pilot plan data is not available yet',
    });
  }
});

router.get('/ashby-polish', (_req, res) => {
  res.json({
    status: 'skeleton',
    checklist: [
      'Confirm Ashby API key configured and encrypted',
      'Show assessment setup state in the UI',
      'Push score, result URL, and proof state back on completion',
      'Exercise list, start, update, cancel, and report paths with one design partner',
    ],
  });
});

router.post('/candidate-deadlines/:submissionId/extend', async (req, res) => {
  if (!isUUID(req.params.submissionId)) return fail(res, 400, 'invalid submission id');
  try {
    const minutes = Number(req.body?.minutes || 1440);
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 10080) {
      return fail(res, 400, 'minutes must be between 15 and 10080');
    }
    const context = await loadCandidateReminderContext(req, req.params.submissionId);
    if (!context) return fail(res, 404, 'submission not found or not accessible');
    const { submission, workSample, candidate } = context;
    if (['submitted', 'scored'].includes(submission.status)) {
      return fail(res, 409, 'submission is already complete');
    }
    const base = submission.deadline_at ? new Date(submission.deadline_at).getTime() : Date.now();
    const newDeadline = new Date(Math.max(base, Date.now()) + minutes * 60000).toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('work_sample_submissions')
      .update({ deadline_at: newDeadline })
      .eq('id', submission.id)
      .select('id, status, deadline_at, work_sample_id, candidate_id')
      .single();
    if (error) return fail(res, 500, error.message);
    res.json({
      status: 'extended',
      submission: updated,
      extension: {
        minutes,
        candidate: profileName(candidate) || 'Candidate',
        screen_title: workSample.title || 'Untitled screen',
        deadline_at: newDeadline,
      },
    });
  } catch (e) {
    console.warn('candidate deadline extension failed:', e.message);
    fail(res, 500, 'could not extend candidate deadline');
  }
});

router.post('/client-reviews/:inviteId/resend', async (req, res) => {
  if (!isUUID(req.params.inviteId)) return fail(res, 400, 'invalid invite id');
  res.status(202).json({
    status: 'skeleton',
    invite_id: req.params.inviteId,
    queued: false,
    next: 'Wire to emailService after resend and revoke UX are finalized.',
  });
});

router.post('/candidate-reminders/:submissionId', async (req, res) => {
  if (!isUUID(req.params.submissionId)) return fail(res, 400, 'invalid submission id');
  try {
    const context = await loadCandidateReminderContext(req, req.params.submissionId);
    if (!context) return fail(res, 404, 'submission not found or not accessible');
    const { submission, workSample, candidate } = context;
    if (['submitted', 'scored'].includes(submission.status)) {
      return fail(res, 409, 'submission is already complete');
    }
    if (!candidate.email) return fail(res, 409, 'candidate email is not available');

    const link = `${frontendBaseUrl()}/candidate?ws=${workSample.id}`;
    const timeLeft = timeLeftLabel(submission.deadline_at);
    const firstName = candidate.first_name || null;
    const screenTitle = workSample.title || 'your Touchstones screen';
    const body = [
      `Hi ${firstName || 'there'},`,
      '',
      `A quick reminder that ${screenTitle} is due in ${timeLeft}.`,
      'Your work is saved, and you can resume where you left off.',
      '',
      `Resume your screen: ${link}`,
      '',
      'Touchstones',
    ].join('\n');

    const result = await emailService.sendEmail({
      to: candidate.email,
      subject: `Reminder: ${screenTitle}`,
      body,
      html: emailTemplates.deadlineReminder({ firstName, screenTitle, timeLeftLabel: timeLeft, link }),
      fromName: 'Touchstones',
    });

    res.status(202).json({
      status: result?.success ? 'sent' : 'not_sent',
      submission_id: submission.id,
      email_sent: !!result?.success,
      email_error: result?.error || null,
      reminder: {
        candidate: profileName(candidate) || 'Candidate',
        screen_title: screenTitle,
        deadline_at: submission.deadline_at,
        time_left: timeLeft,
      },
    });
  } catch (e) {
    console.warn('candidate reminder failed:', e.message);
    fail(res, 500, 'could not send candidate reminder');
  }
});

router.post('/decision-packets/:submissionId', async (req, res) => {
  if (!isUUID(req.params.submissionId)) return fail(res, 400, 'invalid submission id');
  try {
    const packet = await loadDecisionPacket(req, req.params.submissionId);
    if (!packet) return fail(res, 404, 'submission not found or not accessible');
    res.json({ packet });
  } catch (e) {
    console.warn('decision packet build failed:', e.message);
    fail(res, 500, 'could not build decision packet');
  }
});

router.get('/decision-packets/:submissionId', async (req, res) => {
  if (!isUUID(req.params.submissionId)) return fail(res, 400, 'invalid submission id');
  try {
    const packet = await loadDecisionPacket(req, req.params.submissionId);
    if (!packet) return fail(res, 404, 'submission not found or not accessible');
    res.json({ packet });
  } catch (e) {
    console.warn('decision packet read failed:', e.message);
    fail(res, 500, 'could not load decision packet');
  }
});

module.exports = router;
