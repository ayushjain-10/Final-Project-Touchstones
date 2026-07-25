'use strict';

// Bridge from the app to the shared email design system at the repo root (emails/render.js).
// Every function returns null on ANY failure, so callers keep their existing plain-text `body`
// as the fallback — a missing emails/ dir, a bad template, or a render error can never break a
// transactional send (emailService uses `html || convertToHtml(body)`, so null => text email).

const path = require('path');

let renderEmail = null;
try {
  // backend/src/services -> repo root -> emails/render.js
  ({ renderEmail } = require(path.join(__dirname, '..', '..', '..', 'emails', 'render')));
} catch (_) {
  renderEmail = null; // emails/ not deployed in this environment — fall back to plain text.
}

// A-8 (codebase-scan): the branded-HTML → plain-text fallback used to be SILENT. render.yaml's
// rootDir means the bridge reaches outside the service root, so a future deploy-layout change could
// strip branding from every transactional email (incl. the candidate's first-touch invite) with no
// signal. Log the resolved state at boot and alert (prod) when it's off.
if (renderEmail) {
  console.log('email templates: branded HTML ON');
} else {
  console.warn('email templates: branded HTML OFF — emails/ not reachable; sending plain-text fallback');
  try {
    if (process.env.NODE_ENV === 'production') {
      require('../config/observability').getSentry()?.captureMessage?.(
        'email templates: branded HTML fallback (renderEmail is null)', 'warning');
    }
  } catch (_) { /* observability optional */ }
}

function render(name, vars) {
  try {
    return typeof renderEmail === 'function' ? renderEmail(name, vars) : null;
  } catch (_) {
    return null;
  }
}

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// CAN-SPAM: footer unsubscribe link for marketing/nurture emails, injected into the shell's
// [[footer_extra]] slot. Empty string when no URL (transactional emails pass nothing).
const unsubFooter = (url) =>
  url ? `<a href="${url}" style="color:#897B67; text-decoration:underline;">Unsubscribe</a><br>` : '';

// Brand-bordered italic quote block for an optional personal note. Empty string when no message.
function quoteBlock(message) {
  const text = String(message || '').trim();
  if (!text) return '';
  const safe = esc(text.slice(0, 500));
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>' +
    '<td style="padding:2px 0 2px 16px; border-left:3px solid #3448C5;">' +
    '<p style="margin:0; font-family:\'Inter\',-apple-system,Helvetica,Arial,sans-serif; font-style:italic; font-size:15px; line-height:23px; color:#6A5D4D;">' +
    '&ldquo;' + safe + '&rdquo;</p></td></tr></table>'
  );
}

// Candidate screen invite (app, sent via Resend). Returns branded HTML or null.
function candidateInvite({ from, screenTitle, message, link, aiAllowed = true }) {
  const aiPolicyBlock = aiAllowed
    ? '<p class="email-text" style="margin:0 0 16px; font-family:\'Inter\', -apple-system, Helvetica, Arial, sans-serif; font-size:16px; line-height:25px; color:#4D4437;"><strong style="color:#221E18;">AI is allowed for this screen.</strong> The assistant is available, and how you direct and verify it becomes reviewable context.</p>'
    : '<p class="email-text" style="margin:0 0 16px; font-family:\'Inter\', -apple-system, Helvetica, Arial, sans-serif; font-size:16px; line-height:25px; color:#4D4437;"><strong style="color:#221E18;">This screen is independent work.</strong> The in-browser AI assistant is disabled for this task.</p>';
  return render('app/candidate-invite', {
    from: esc(from) || 'A hiring team',
    screen_title: screenTitle ? ': “' + esc(screenTitle) + '”' : '',
    message_block: quoteBlock(message),
    ai_policy_block: aiPolicyBlock,
    button_url: link,
    button_label: 'Start the screen',
    preheader: aiAllowed
      ? 'A short, real-work screen with AI allowed.'
      : 'A short, independent-work screen.',
  });
}

// Team workspace invite (app, sent via Resend). Returns branded HTML or null.
function teamInvite({ from, invitedEmail, link }) {
  return render('app/team-invite', {
    from: esc(from) || 'A teammate',
    invited_email: esc(invitedEmail) || 'your email',
    button_url: link,
    button_label: 'Accept invite',
    preheader: 'Join your team workspace on Touchstones.',
  });
}

// Account welcome (recruiter signs up). Returns branded HTML or null.
function accountWelcome({ firstName, appUrl } = {}) {
  return render('app/welcome', {
    first_name: esc(firstName) || 'there',
    button_url: appUrl || 'https://touchstones.ai/app',
    button_label: 'Go to your dashboard',
    preheader: 'Your Touchstones account is ready.',
  });
}

// Candidate pool "thanks for joining" (via the flexible notification template). Returns HTML or null.
function candidateWelcome({ firstName, unsubscribeUrl } = {}) {
  return render('app/notification', {
    heading: 'You’re in the Touchstones talent pool',
    body:
      `Thanks for joining${firstName ? ', ' + esc(firstName) : ''}. Recruiters hiring for roles like yours can ` +
      'now find you by what you can actually do, not just keywords. We’ll email you when there’s a relevant, real-work screen.',
    detail_block: '',
    button_url: 'https://touchstones.ai',
    button_label: 'See how it works',
    footnote: 'No spam, only real opportunities. You can opt out anytime.',
    footer_extra: unsubFooter(unsubscribeUrl),
    preheader: 'You’re in the Touchstones talent pool.',
  });
}

// Waitlist "thanks for joining" (via the flexible notification template). Returns HTML or null.
function waitlistWelcome({ firstName, unsubscribeUrl } = {}) {
  return render('app/notification', {
    heading: 'You’re on the Touchstones waitlist',
    body:
      `Thanks for joining${firstName ? ', ' + esc(firstName) : ''}. We’re onboarding teams gradually. ` +
      'We’ll reach out as we open up early access to design partners.',
    detail_block: '',
    button_url: 'https://touchstones.ai',
    button_label: 'Explore Touchstones',
    footnote: '',
    footer_extra: unsubFooter(unsubscribeUrl),
    preheader: 'You’re on the Touchstones waitlist.',
  });
}

// Demo-request 48h nurture (via the flexible notification template). Returns HTML or null.
// Sent once, ~48h after a `kind:'demo'` request, by the waitlistNurture sweep.
function demoNurture({ firstName, demoUrl, unsubscribeUrl } = {}) {
  return render('app/notification', {
    heading: 'Want to see Touchstones on your own req?',
    body:
      `Hi${firstName ? ' ' + esc(firstName) : ''}, thanks for asking about a Touchstones demo. ` +
      'You don’t have to wait for a call: you can try a real 5-minute screen yourself (no signup), ' +
      'and I’ll happily author a task from one of your open engineering reqs and walk you through a ' +
      'scored report. Just reply and tell me which role.',
    detail_block: '',
    button_url: demoUrl || 'https://touchstones.ai',
    button_label: 'Try a screen yourself',
    footnote: 'Reply anytime. A real person (the founder) reads these.',
    footer_extra: unsubFooter(unsubscribeUrl),
    preheader: 'Try a real screen yourself, or I’ll run one on your req.',
  });
}

// Candidate: "we received your submission" (sent on submit). Returns HTML or null.
function submissionReceived({ firstName, screenTitle, homeUrl } = {}) {
  return render('app/notification', {
    heading: 'We received your submission',
    body:
      `Thanks${firstName ? ', ' + esc(firstName) : ''}, your work on “${esc(screenTitle) || 'the screen'}” is in. ` +
      'The hiring team will review it and follow up about next steps. There’s nothing more you need to do right now.',
    detail_block: '',
    button_url: homeUrl || 'https://touchstones.ai',
    button_label: 'View your assessments',
    footnote: '',
    preheader: 'Your submission was received.',
  });
}

// Recruiter: "a screen result is ready to review" (sent when a submission is scored). HTML or null.
function resultReadyRecruiter({ firstName, screenTitle, candidateLabel, reviewUrl } = {}) {
  return render('app/notification', {
    heading: 'A screen result is ready',
    body:
      `${esc(candidateLabel) || 'A candidate'} completed “${esc(screenTitle) || 'your screen'}” and it’s been scored. ` +
      'Open one explainable score with the reasoning, the candidate’s actual work, and how they directed the AI.',
    detail_block: '',
    button_url: reviewUrl || 'https://touchstones.ai/app',
    button_label: 'View the result',
    footnote: '',
    preheader: 'A screen result is ready to review.',
  });
}

// Candidate: "you earned a verified credential" (sent when a recruiter issues one). HTML or null.
function credentialIssued({ firstName, screenTitle, verifyUrl } = {}) {
  return render('app/notification', {
    heading: 'You earned a verified credential',
    body:
      `Nice work${firstName ? ', ' + esc(firstName) : ''}. Your performance on “${esc(screenTitle) || 'a Touchstones screen'}” ` +
      'is now a portable, publicly-verifiable credential. Share the link with anyone, no login required.',
    detail_block: '',
    button_url: verifyUrl || 'https://touchstones.ai',
    button_label: 'View your credential',
    footnote: 'Anyone with the link can verify it independently.',
    preheader: 'Your verified credential is ready.',
  });
}

// Recruiter: "a candidate completed your screen" (sent on submit). Returns HTML or null.
function submissionCompletedRecruiter({ firstName, candidateLabel, screenTitle, reviewUrl } = {}) {
  return render('app/notification', {
    heading: 'A candidate completed your screen',
    body:
      `${esc(candidateLabel) || 'A candidate'} just completed “${esc(screenTitle) || 'your screen'}”. ` +
      'It’s being scored now. You’ll get one explainable score with the reasoning, the candidate’s work, and how they directed the AI.',
    detail_block: '',
    button_url: reviewUrl || 'https://touchstones.ai/app',
    button_label: 'Open the result',
    footnote: '',
    preheader: 'A candidate completed your screen.',
  });
}

// Password reset (app-native reset link). Returns HTML or null.
function passwordReset({ firstName, resetUrl } = {}) {
  return render('app/notification', {
    heading: 'Reset your password',
    body:
      `Hi${firstName ? ' ' + esc(firstName) : ''}, we received a request to reset your Touchstones password. ` +
      'Use the button below to choose a new one. It expires in 1 hour and can only be used once. If you didn’t request this, you can safely ignore this email.',
    detail_block: '',
    button_url: resetUrl || 'https://touchstones.ai',
    button_label: 'Choose a new password',
    footnote: 'For your security, this link expires in one hour.',
    preheader: 'Reset your Touchstones password.',
  });
}

// Candidate: deadline reminder ("X left to finish"). Returns HTML or null.
function deadlineReminder({ firstName, screenTitle, timeLeftLabel, link } = {}) {
  return render('app/notification', {
    heading: `${timeLeftLabel || 'Time'} left on your screen`,
    body:
      `Hi${firstName ? ' ' + esc(firstName) : ''}, a quick heads-up: your Touchstones screen ` +
      `“${esc(screenTitle) || 'your screen'}” is due in ${esc(timeLeftLabel) || 'a little while'}. ` +
      'Pick up where you left off. Your work is saved.',
    detail_block: '',
    button_url: link || 'https://touchstones.ai',
    button_label: 'Resume your screen',
    footnote: '',
    preheader: `${timeLeftLabel || 'Time'} left to finish your screen.`,
  });
}

// Recruiter: a screen expired un-submitted. Returns HTML or null.
function screenExpired({ firstName, candidateLabel, screenTitle } = {}) {
  return render('app/notification', {
    heading: 'A screen expired un-submitted',
    body:
      `${esc(candidateLabel) || 'A candidate'}’s time on “${esc(screenTitle) || 'your screen'}” ran out before they submitted. ` +
      'You can re-invite them if you’d like to give them another window.',
    detail_block: '',
    button_url: 'https://touchstones.ai/app',
    button_label: 'Open your dashboard',
    footnote: '',
    preheader: 'A screen expired before submission.',
  });
}

// Recruiter: a candidate declined a screen before starting (108). The candidate's optional
// reason renders as the standard quote block. Returns HTML or null.
function screenDeclined({ candidateLabel, screenTitle, reason, activityUrl } = {}) {
  return render('app/notification', {
    heading: 'A candidate declined a screen',
    body:
      `${esc(candidateLabel) || 'A candidate'} declined “${esc(screenTitle) || 'your screen'}” before starting.`,
    detail_block: quoteBlock(reason),
    button_url: activityUrl || 'https://touchstones.ai/app',
    button_label: 'Open your dashboard',
    footnote: '',
    preheader: 'A candidate declined a screen.',
  });
}

// Key/value details table for internal notices (founder/ops). Matches the design system's
// muted-label / ink-value styling. Rows = [[label, value], ...]; empty values are skipped;
// everything is escaped. Returns '' when there is nothing to show.
function detailRows(rows) {
  const items = (rows || []).filter(([, v]) => v != null && String(v).trim() !== '');
  if (!items.length) return '';
  const tr = items
    .map(
      ([label, value]) =>
        '<tr>' +
        '<td style="padding:5px 14px 5px 0; vertical-align:top; white-space:nowrap; font-family:\'Inter\',-apple-system,Helvetica,Arial,sans-serif; font-size:14px; line-height:22px; color:#897B67;">' +
        esc(label) +
        '</td>' +
        '<td style="padding:5px 0; vertical-align:top; font-family:\'Inter\',-apple-system,Helvetica,Arial,sans-serif; font-size:14px; line-height:22px; color:#221E18; word-break:break-word;">' +
        esc(String(value).slice(0, 600)) +
        '</td></tr>',
    )
    .join('');
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="margin:0 0 18px; border-top:1px solid #E9E2D6; border-bottom:1px solid #E9E2D6; padding:6px 0;">' +
    tr +
    '</table>'
  );
}

// Internal founder/ops notice (new recruiter, demo request, waitlist signup, …) via the flexible
// notification template — so even internal emails carry the brand. Returns HTML or null.
function founderNotice({ heading, intro, rows, footnote, ctaUrl, ctaLabel, preheader } = {}) {
  return render('app/notification', {
    heading: esc(heading) || 'Touchstones notification',
    body: esc(intro) || '',
    detail_block: detailRows(rows),
    button_url: ctaUrl || '',
    button_label: ctaUrl ? esc(ctaLabel) || 'Open Touchstones' : '',
    footnote: esc(footnote) || '',
    preheader: esc(preheader) || esc(heading) || '',
  });
}

module.exports = {
  candidateInvite,
  teamInvite,
  accountWelcome,
  candidateWelcome,
  waitlistWelcome,
  demoNurture,
  submissionReceived,
  resultReadyRecruiter,
  credentialIssued,
  submissionCompletedRecruiter,
  passwordReset,
  deadlineReminder,
  screenExpired,
  screenDeclined,
  founderNotice,
  quoteBlock,
  render,
};
