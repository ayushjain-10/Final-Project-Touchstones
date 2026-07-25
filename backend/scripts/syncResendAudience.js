'use strict';

/**
 * syncResendAudience.js — add every Touchstones contact into the Resend audience.
 *
 * Sources (deduped by email): waitlist signups, candidate pool (candidate_submissions), and
 * recruiter accounts (auth.users). Idempotent — safe to re-run; existing contacts are left as-is.
 * Use as a one-time backfill now, and on a schedule (e.g. a Render cron) to keep the list current.
 *
 *   RESEND_AUDIENCE_ID=<id> RESEND_AUDIENCE_API_KEY=<key> node backend/scripts/syncResendAudience.js
 *
 * Reads Supabase creds + Resend key from env (loaded via dotenv from backend/.env). No secrets here.
 * Does NOT send any email — purely list membership (welcome emails fire on real signups, not backfill).
 */
require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');
const resendAudience = require('../src/services/resendAudience');

const norm = (e) => String(e || '').trim().toLowerCase();
const valid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function collect() {
  const byEmail = new Map(); // email -> { email, fullName, firstName, lastName }
  const add = (email, rec) => {
    const e = norm(email);
    if (!valid(e) || byEmail.has(e)) return;
    byEmail.set(e, { email: e, ...rec });
  };

  // 1) Waitlist
  try {
    const { data } = await supabaseAdmin.from('waitlist').select('email, name');
    (data || []).forEach((r) => add(r.email, { fullName: r.name || '' }));
  } catch (e) { console.warn('waitlist read skipped:', e.message); }

  // 2) Candidate pool
  try {
    const { data } = await supabaseAdmin.from('candidate_submissions').select('email, full_name');
    (data || []).forEach((r) => add(r.email, { fullName: r.full_name || '' }));
  } catch (e) { console.warn('candidate_submissions read skipped:', e.message); }

  // 3) Recruiter accounts (auth.users — the source of truth for account emails)
  try {
    let page = 1;
    for (;;) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data?.users || [];
      users.forEach((u) => {
        const m = u.user_metadata || {};
        add(u.email, { firstName: m.first_name || '', lastName: m.last_name || '', fullName: m.full_name || m.name || '' });
      });
      if (users.length < 1000) break;
      page += 1;
    }
  } catch (e) { console.warn('auth.users read skipped:', e.message); }

  return [...byEmail.values()];
}

// Reliable backstop for the pg_net real-time trigger: welcome any waitlist signup not yet welcomed.
// The free dev backend can sleep, so this guarantees each signup is welcomed exactly once. Sends
// first, then stamps welcomed_at only on success (a transient send failure simply retries next run).
async function welcomeNewWaitlist() {
  let sent = 0;
  let emailService, emailTemplates, emailCompliance;
  try {
    emailService = require('../src/services/emailService');
    emailTemplates = require('../src/services/emailTemplates');
    emailCompliance = require('../src/services/emailCompliance');
  }
  catch { return 0; }
  try {
    const { data } = await supabaseAdmin.from('waitlist').select('email, name').is('welcomed_at', null);
    for (const r of data || []) {
      const email = norm(r.email);
      if (!valid(email)) continue;
      const firstName = String(r.name || '').trim().split(/\s+/)[0] || '';
      // CAN-SPAM: unsubscribe link + List-Unsubscribe headers on waitlist mail (same treatment as
      // the real-time hooks.js path; the shared shell adds the postal footer to the HTML).
      const unsubscribeUrl = await emailCompliance.getUnsubscribeUrl(email);
      const html = emailTemplates.waitlistWelcome({ firstName, unsubscribeUrl });
      const body =
        "Thanks for joining the Touchstones waitlist. We're onboarding teams gradually. We'll reach " +
        'out as we open up early access to design partners.\n\nTouchstones' +
        emailCompliance.textFooter(unsubscribeUrl);
      const res = await emailService.sendEmail({
        to: email, subject: "You're on the Touchstones waitlist", body, html,
        fromName: 'Touchstones', headers: emailCompliance.listUnsubscribeHeaders(unsubscribeUrl),
      });
      if (res && res.success) {
        await supabaseAdmin.from('waitlist').update({ welcomed_at: new Date().toISOString() }).eq('email', email).is('welcomed_at', null);
        sent += 1;
      }
    }
  } catch (e) { console.warn('welcome step skipped:', e.message); }
  return sent;
}

(async () => {
  if (!resendAudience.isConfigured()) {
    console.error('Not configured — set RESEND_AUDIENCE_ID and RESEND_AUDIENCE_API_KEY (or RESEND_API_KEY with audience perms).');
    process.exit(1);
  }
  const contacts = await collect();
  console.log(`Collected ${contacts.length} unique contacts. Syncing to Resend audience…`);
  let ok = 0, existed = 0, failed = 0;
  for (const c of contacts) {
    const r = await resendAudience.upsertContact(c);
    if (r.ok && r.existed) existed += 1;
    else if (r.ok) ok += 1;
    else { failed += 1; if (failed <= 5) console.warn('  failed:', c.email, r.error || r.reason); }
  }
  const welcomed = await welcomeNewWaitlist();
  console.log(`Done. added=${ok} alreadyThere=${existed} failed=${failed} total=${contacts.length} welcomed=${welcomed}`);
})().catch((e) => { console.error('sync error:', e.message); process.exit(1); });
