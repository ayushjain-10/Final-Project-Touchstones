/**
 * workflowNotify — transactional stage emails for the candidate/recruiter journey, so nobody hits a
 * dead end. Every function is BEST-EFFORT: it fetches the recipients via service role, sends via
 * emailService (branded HTML when emails/ is deployed, plain-text fallback otherwise), and NEVER
 * throws — a notification failure must not break submit/score/credential. Score internals are never
 * sent to a candidate (outcome visibility is employer-controlled).
 */
const { supabaseAdmin } = require('../config/supabase');
const emailService = require('./emailService');
const emailTemplates = require('./emailTemplates');

const FRONTEND = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
const nameOf = (p) => (p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() : '');

// Write an in-app notification row (the bell). type='system' (the workflow events aren't in the
// notification_type enum); a click-through link rides in `data.link`. Best-effort, never blocks.
async function createInApp(userId, title, message, link) {
  try {
    if (!userId) return;
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'system',
      title,
      message,
      data: link ? { link } : {},
    });
  } catch (_) {
    /* best-effort */
  }
}

// Resolve the screen + candidate + recruiter for a submission (service role — RLS would hide them).
async function context(submission) {
  if (!submission || !submission.work_sample_id) return null;
  const { data: ws } = await supabaseAdmin
    .from('work_samples').select('id, title, owner_id').eq('id', submission.work_sample_id).single();
  if (!ws) return null;
  const [{ data: candidate }, { data: owner }] = await Promise.all([
    submission.candidate_id
      ? supabaseAdmin.from('profiles').select('email, first_name, last_name').eq('id', submission.candidate_id).single()
      : Promise.resolve({ data: null }),
    ws.owner_id
      ? supabaseAdmin.from('profiles').select('email, first_name, last_name').eq('id', ws.owner_id).single()
      : Promise.resolve({ data: null }),
  ]);
  return { ws, candidate, owner };
}

// Candidate — "we received your submission" (on submit).
async function candidateSubmissionReceived(submission) {
  try {
    const ctx = await context(submission);
    if (!ctx?.candidate?.email) return;
    const screenTitle = ctx.ws.title || 'your screen';
    const firstName = ctx.candidate.first_name || '';
    const homeUrl = FRONTEND ? `${FRONTEND}/candidate/home` : undefined;
    const body = [
      `Hi ${firstName || 'there'},`,
      '',
      `We received your submission for "${screenTitle}". The hiring team will review your work and follow up about next steps — nothing more to do right now.`,
      homeUrl ? `\nYour assessments: ${homeUrl}` : '',
      '',
      'The Touchstones team',
    ].filter((l) => l !== undefined).join('\n');
    await emailService.sendEmail({
      to: ctx.candidate.email,
      subject: `Received: ${screenTitle}`,
      body,
      html: emailTemplates.submissionReceived({ firstName, screenTitle, homeUrl }),
      fromName: 'Touchstones',
    });
    await createInApp(submission.candidate_id, 'Submission received', `We received your work on "${screenTitle}".`, homeUrl);
  } catch (e) {
    console.warn('candidateSubmissionReceived failed (non-blocking):', e.message);
  }
}

// Recruiter — bell-only "a candidate just submitted" (on submit). The actionable EMAIL is sent by
// notifyOwnerOfSubmission in the submit route; this lights up the in-app bell so the two stay
// consistent (the recruiter's "Result ready" in-app fires later, once scoring completes).
async function recruiterSubmissionReceived(submission) {
  try {
    const ctx = await context(submission);
    if (!ctx?.ws?.owner_id) return;
    const screenTitle = ctx.ws.title || 'your screen';
    const candidateLabel = nameOf(ctx.candidate) || ctx.candidate?.email || 'A candidate';
    const reviewUrl = FRONTEND ? `${FRONTEND}/app/result?submission=${submission.id}` : null;
    await createInApp(ctx.ws.owner_id, 'New submission', `${candidateLabel} completed "${screenTitle}" — scoring now.`, reviewUrl);
  } catch (e) {
    console.warn('recruiterSubmissionReceived failed (non-blocking):', e.message);
  }
}

// Recruiter — "a screen result is ready" (on scored). The actionable email with the review link.
async function recruiterResultReady(submission) {
  try {
    const ctx = await context(submission);
    if (!ctx?.owner?.email) return;
    const screenTitle = ctx.ws.title || 'your screen';
    const candidateLabel = nameOf(ctx.candidate) || ctx.candidate?.email || 'A candidate';
    const reviewUrl = FRONTEND ? `${FRONTEND}/app/result?submission=${submission.id}` : undefined;
    const body = [
      `Hi ${ctx.owner.first_name || 'there'},`,
      '',
      `${candidateLabel} completed "${screenTitle}" and it's been scored.`,
      'Open one explainable score with the reasoning, the candidate’s work, and how they directed the AI.',
      reviewUrl ? `\nView the result: ${reviewUrl}` : '',
      '',
      'The Touchstones team',
    ].filter((l) => l !== undefined).join('\n');
    await emailService.sendEmail({
      to: ctx.owner.email,
      subject: `Result ready: ${screenTitle}`,
      body,
      html: emailTemplates.resultReadyRecruiter({ firstName: ctx.owner.first_name, screenTitle, candidateLabel, reviewUrl }),
      fromName: 'Touchstones',
    });
    await createInApp(ctx.ws.owner_id, 'Result ready', `${candidateLabel} completed "${screenTitle}".`, reviewUrl);
  } catch (e) {
    console.warn('recruiterResultReady failed (non-blocking):', e.message);
  }
}

// Candidate — "you earned a verified credential" (on credential issue).
async function candidateCredentialIssued({ candidateId, submissionId, verifyUrl } = {}) {
  try {
    if (!candidateId) return;
    const { data: candidate } = await supabaseAdmin
      .from('profiles').select('email, first_name').eq('id', candidateId).single();
    if (!candidate?.email) return;
    let screenTitle = 'a Touchstones screen';
    if (submissionId) {
      const { data: sub } = await supabaseAdmin
        .from('work_sample_submissions').select('work_sample_id').eq('id', submissionId).single();
      if (sub?.work_sample_id) {
        const { data: ws } = await supabaseAdmin.from('work_samples').select('title').eq('id', sub.work_sample_id).single();
        if (ws?.title) screenTitle = ws.title;
      }
    }
    const firstName = candidate.first_name || '';
    const body = [
      `Hi ${firstName || 'there'},`,
      '',
      `Nice work — your performance on "${screenTitle}" is now a portable, publicly-verifiable credential.`,
      verifyUrl ? `\nView and share it: ${verifyUrl}` : '',
      'Anyone with the link can verify it independently — no login required.',
      '',
      'The Touchstones team',
    ].filter((l) => l !== undefined).join('\n');
    await emailService.sendEmail({
      to: candidate.email,
      subject: 'Your verified credential is ready',
      body,
      html: emailTemplates.credentialIssued({ firstName, screenTitle, verifyUrl }),
      fromName: 'Touchstones',
    });
    await createInApp(candidateId, 'Credential issued', `Your verified credential for "${screenTitle}" is ready.`, verifyUrl);
  } catch (e) {
    console.warn('candidateCredentialIssued failed (non-blocking):', e.message);
  }
}

// Candidate — invited/assigned to a screen (when a recruiter assigns them via API/ATS, not the
// email-invite route). Mirrors /invite so an assigned candidate isn't left uninvited.
async function candidateAssignedToScreen({ candidateId, workSampleId, inviterId } = {}) {
  try {
    if (!candidateId || !workSampleId) return;
    const { data: candidate } = await supabaseAdmin
      .from('profiles').select('email, first_name').eq('id', candidateId).single();
    if (!candidate?.email) return;
    const { data: ws } = await supabaseAdmin.from('work_samples').select('title, rubric').eq('id', workSampleId).single();
    let fromLabel = 'A hiring team';
    if (inviterId) {
      const { data: inviter } = await supabaseAdmin
        .from('profiles').select('first_name, last_name, company').eq('id', inviterId).single();
      fromLabel = inviter?.company || nameOf(inviter) || fromLabel;
    }
    const screenTitle = ws?.title || '';
    const aiAllowed = ws?.rubric?.ai_allowed !== false;
    const link = FRONTEND ? `${FRONTEND}/candidate?ws=${workSampleId}` : 'https://touchstones.ai';
    const body = [
      `Hi ${candidate.first_name || 'there'},`,
      '',
      `${fromLabel} invited you to a short, real-work Touchstones screen${screenTitle ? `: "${screenTitle}"` : ''}.`,
      aiAllowed
        ? 'AI is allowed for this screen. How you direct and verify it becomes reviewable context.'
        : 'This screen is independent work. The in-browser AI assistant is disabled for this task.',
      `\nStart the screen: ${link}`,
      '',
      'The Touchstones team',
    ].join('\n');
    await emailService.sendEmail({
      to: candidate.email,
      subject: `You're invited to a Touchstones screen${screenTitle ? `: ${screenTitle}` : ''}`,
      body,
      html: emailTemplates.candidateInvite({ from: fromLabel, screenTitle, message: '', link, aiAllowed }),
      fromName: 'Touchstones',
    });
  } catch (e) {
    console.warn('candidateAssignedToScreen failed (non-blocking):', e.message);
  }
}

function timeLeftLabel(deadlineAt) {
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'less than an hour';
  const hrs = Math.round(ms / 3600000);
  if (hrs >= 24) { const d = Math.round(hrs / 24); return d === 1 ? '1 day' : `${d} days`; }
  if (hrs >= 1) return hrs === 1 ? '1 hour' : `${hrs} hours`;
  const mins = Math.max(1, Math.round(ms / 60000));
  return `${mins} minutes`;
}

// Candidate — deadline reminder ("X left to finish"). Sent by the deadline sweep.
async function candidateDeadlineReminder(submission) {
  try {
    const ctx = await context(submission);
    if (!ctx?.candidate?.email) return;
    const screenTitle = ctx.ws.title || 'your screen';
    const label = timeLeftLabel(submission.deadline_at);
    const link = FRONTEND ? `${FRONTEND}/candidate?ws=${ctx.ws.id}` : 'https://touchstones.ai';
    const body = [
      `Hi ${ctx.candidate.first_name || 'there'},`,
      '',
      `Quick heads-up — your Touchstones screen "${screenTitle}" is due in ${label}. Your work is saved; pick up where you left off.`,
      `\nResume: ${link}`,
      '',
      'The Touchstones team',
    ].join('\n');
    await emailService.sendEmail({
      to: ctx.candidate.email,
      subject: `${label} left: ${screenTitle}`,
      body,
      html: emailTemplates.deadlineReminder({ firstName: ctx.candidate.first_name, screenTitle, timeLeftLabel: label, link }),
      fromName: 'Touchstones',
    });
    await createInApp(submission.candidate_id, `${label} left on your screen`, `"${screenTitle}" is due soon.`, link);
  } catch (e) {
    console.warn('candidateDeadlineReminder failed (non-blocking):', e.message);
  }
}

// Recruiter — a screen expired un-submitted. Sent by the deadline sweep.
async function recruiterScreenExpired(submission) {
  try {
    const ctx = await context(submission);
    if (!ctx?.owner?.email) return;
    const screenTitle = ctx.ws.title || 'your screen';
    const candidateLabel = nameOf(ctx.candidate) || ctx.candidate?.email || 'A candidate';
    const body = [
      `Hi ${ctx.owner.first_name || 'there'},`,
      '',
      `${candidateLabel}'s time on "${screenTitle}" ran out before they submitted. You can re-invite them to give another window.`,
      '',
      'The Touchstones team',
    ].join('\n');
    await emailService.sendEmail({
      to: ctx.owner.email,
      subject: `Screen expired: ${screenTitle}`,
      body,
      html: emailTemplates.screenExpired({ firstName: ctx.owner.first_name, candidateLabel, screenTitle }),
      fromName: 'Touchstones',
    });
    await createInApp(ctx.ws.owner_id, 'Screen expired', `${candidateLabel}'s time on "${screenTitle}" ran out before they submitted.`, FRONTEND ? `${FRONTEND}/app` : null);
  } catch (e) {
    console.warn('recruiterScreenExpired failed (non-blocking):', e.message);
  }
}

// Recruiter: the candidate declined an assigned screen before starting (migration 108).
// The optional reason is candidate-supplied: it rides in this notification only and is never
// logged server-side (the catch below only logs the error message).
async function recruiterScreenDeclined({ submission, reason } = {}) {
  try {
    const ctx = await context(submission);
    if (!ctx?.owner?.email) return;
    const screenTitle = ctx.ws.title || 'your screen';
    const candidateLabel = nameOf(ctx.candidate) || ctx.candidate?.email || 'A candidate';
    const activityUrl = FRONTEND ? `${FRONTEND}/app` : null;
    const quoted = String(reason || '').trim().slice(0, 500);
    const body = [
      `Hi ${ctx.owner.first_name || 'there'},`,
      '',
      `${candidateLabel} declined "${screenTitle}" before starting.`,
      quoted ? `\n"${quoted}"` : '',
      activityUrl ? `\nSee your screen activity: ${activityUrl}` : '',
      '',
      'The Touchstones team',
    ].filter((l) => l !== undefined).join('\n');
    await emailService.sendEmail({
      to: ctx.owner.email,
      subject: `Screen declined: ${screenTitle}`,
      body,
      html: emailTemplates.screenDeclined({ candidateLabel, screenTitle, reason: quoted, activityUrl }),
      fromName: 'Touchstones',
    });
    await createInApp(ctx.ws.owner_id, 'Screen declined', `${candidateLabel} declined "${screenTitle}".`, activityUrl);
  } catch (e) {
    console.warn('recruiterScreenDeclined failed (non-blocking):', e.message);
  }
}

module.exports = {
  candidateSubmissionReceived,
  recruiterSubmissionReceived,
  recruiterResultReady,
  candidateCredentialIssued,
  candidateAssignedToScreen,
  candidateDeadlineReminder,
  recruiterScreenExpired,
  recruiterScreenDeclined,
};
