/**
 * Supabase Database Webhook target — /api/hooks (PUBLIC path)
 *
 * The waitlist signup happens client-side (browser → Supabase), so the backend never sees it. A
 * Postgres trigger (pg_net) on `waitlist` INSERT posts the new row here, and we (a) add the contact
 * to the Resend audience and (b) send a one-time thank-you. Because the DB is shared between dev and
 * prod, this also covers the PRODUCTION waitlist without touching the frozen prod app.
 *
 * Security: FAIL-CLOSED. Requires `x-webhook-secret` == SUPABASE_WEBHOOK_SECRET (the pg_net trigger
 * sends it); with the secret unset the endpoint refuses everything (503). After auth it returns an
 * IDENTICAL `{ ok: true }` for every outcome (no-email / not-a-signup / sent) so it can't be used as
 * a waitlist-membership enumeration oracle. Defense in depth: the email is still validated against
 * the `waitlist` table and each signup is welcomed exactly once (atomic welcomed_at claim). If the
 * secret isn't configured, the every-30-min reconciliation cron still welcomes new signups.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');

// Constant-time secret comparison (hash both to a fixed length first — no length leak, no early-exit).
function secretMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(a, b);
}
const emailService = require('../../services/emailService');
const emailTemplates = require('../../services/emailTemplates');
const emailCompliance = require('../../services/emailCompliance');
const resendAudience = require('../../services/resendAudience');

const norm = (e) => String(e || '').trim().toLowerCase();
const valid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const firstNameOf = (full) => String(full || '').trim().split(/\s+/)[0] || '';
// Strip control chars + cap length before untrusted fields enter the founder email (no injection).
const clean = (v, max = 400) =>
  typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

// P1-3: tell the founder a new demo/waitlist request landed. Recipient from env (falls back to the
// existing demo-request inbox); no-op with no hardcoded address when neither is set.
async function notifyFounder(row) {
  const to = process.env.FOUNDER_NOTIFY_EMAIL || process.env.DEMO_REQUEST_INBOX;
  if (!to) return; // no recipient configured → nothing to send (never a hardcoded address)
  const isDemo = row.kind === 'demo';
  const label = isDemo ? 'demo request' : 'waitlist signup';
  const body = [
    `New Touchstones ${label}:`,
    '',
    `Email: ${clean(row.email, 200)}`,
    row.name ? `Name: ${clean(row.name, 120)}` : '',
    row.company ? `Company: ${clean(row.company, 160)}` : '',
    isDemo && row.message ? `Message: ${clean(row.message, 1000)}` : '',
  ].filter(Boolean).join('\n');
  const html = emailTemplates.founderNotice({
    heading: isDemo ? 'New demo request' : 'New waitlist signup',
    intro: isDemo
      ? 'Someone asked for a demo from the marketing site.'
      : 'A new signup landed on the waitlist.',
    rows: [
      ['Email', clean(row.email, 200)],
      ['Name', clean(row.name, 120)],
      ['Company', clean(row.company, 160)],
      isDemo ? ['Message', clean(row.message, 1000)] : ['', ''],
    ],
    footnote: 'Sent automatically on insert. Reply goes to your own inbox, not the requester.',
    preheader: `New ${label}${row.company ? `: ${clean(row.company, 80)}` : ''}`,
  });
  await emailService.sendEmail({
    to,
    subject: `New ${label}${row.company ? `: ${clean(row.company, 80)}` : ''}`,
    body,
    html,
    fromName: 'Touchstones',
  });
}

router.post('/resend-signup', async (req, res) => {
  // Fail closed: the secret MUST be configured, and the caller MUST present it.
  const secret = process.env.SUPABASE_WEBHOOK_SECRET || '';
  if (!secret) return res.status(503).json({ error: 'not configured' });
  if (!secretMatches(req.get('x-webhook-secret'), secret)) return res.status(401).json({ error: 'unauthorized' });

  // Uniform response for every post-auth outcome — no enumeration oracle. Do the work after acking.
  res.json({ ok: true });

  (async () => {
    try {
      const record = (req.body && (req.body.record || req.body.new)) || req.body || {};
      const email = norm(record.email);
      if (!valid(email)) return;

      // Defense in depth: only act on a real waitlist signup.
      const { data: row } = await supabaseAdmin
        .from('waitlist').select('email, name, company, kind, message, welcomed_at').eq('email', email).maybeSingle();
      if (!row) return;

      resendAudience.upsertContact({ email, fullName: row.name || '' }).catch(() => {});

      // Welcome exactly once: claim by stamping welcomed_at (only one update wins the race). The
      // founder notification rides the SAME once-only claim so it fires exactly once per signup.
      if (!row.welcomed_at) {
        const { data: claimed } = await supabaseAdmin
          .from('waitlist').update({ welcomed_at: new Date().toISOString() })
          .eq('email', email).is('welcomed_at', null).select('email');
        if (Array.isArray(claimed) && claimed.length) {
          // CAN-SPAM: waitlist mail carries an unsubscribe link + List-Unsubscribe headers (the
          // shared shell adds the postal footer to the HTML; textFooter covers the plain body).
          const unsubscribeUrl = await emailCompliance.getUnsubscribeUrl(email);
          const html = emailTemplates.waitlistWelcome({ firstName: firstNameOf(row.name), unsubscribeUrl });
          const text =
            "Thanks for joining the Touchstones waitlist. We're onboarding teams gradually. We'll reach " +
            'out as we open up early access to design partners.\n\nTouchstones' +
            emailCompliance.textFooter(unsubscribeUrl);
          await emailService.sendEmail({
            to: email, subject: "You're on the Touchstones waitlist", body: text, html,
            fromName: 'Touchstones', headers: emailCompliance.listUnsubscribeHeaders(unsubscribeUrl),
          });
          // P1-3: notify the founder within seconds of a demo/waitlist insert. Recipient from env
          // (no hardcoded address); no-op when unset. Non-blocking — a notify failure never affects
          // the requester's welcome.
          notifyFounder(row).catch((e) => console.warn('founder notify failed (non-blocking):', e.message));
        }
      }
    } catch (_) { /* best-effort; the reconciliation cron is the backstop */ }
  })();
});

module.exports = router;
