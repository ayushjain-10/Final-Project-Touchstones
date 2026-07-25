/**
 * Waitlist nurture sweep — sends a demo requester ONE follow-up email ~48h after they asked for a
 * demo (P1-3 activation emails). Mirrors deadlineSweep.js: an interval-driven, best-effort,
 * idempotent sweep with a once-only claim column (waitlist.nurtured_at, migration 086).
 *
 * SAFETY (the DB is shared dev/prod): the sweep is AGE-BANDED — it only touches rows created between
 * NURTURE_AFTER and NURTURE_AFTER+BAND ago (default 48–96h). Combined with the nurtured_at claim and
 * the default-OFF WAITLIST_NURTURE_ENABLED flag, enabling this can never blast the pre-existing
 * waitlist backlog: ancient rows fall outside the band, and each eligible row is nurtured exactly
 * once. Scoped to kind='demo' (the high-intent "requester" the strategy cares about), never plain
 * waitlist signups. Any error (incl. a missing column before 086 is applied) is logged and no-ops.
 */
const { supabaseAdmin } = require('../config/supabase');
const emailService = require('./emailService');
const emailTemplates = require('./emailTemplates');
const emailCompliance = require('./emailCompliance');

const HOUR_MS = 3600000;
const NURTURE_AFTER_MS = Number(process.env.WAITLIST_NURTURE_AFTER_HOURS || 48) * HOUR_MS;
const BAND_MS = Number(process.env.WAITLIST_NURTURE_BAND_HOURS || 48) * HOUR_MS;

function nurtureEnabled() {
  return process.env.WAITLIST_NURTURE_ENABLED === 'true';
}

const firstNameOf = (full) => String(full || '').trim().split(/\s+/)[0] || '';

async function runSweep() {
  if (!nurtureEnabled()) return;
  try {
    const now = Date.now();
    const olderThan = new Date(now - NURTURE_AFTER_MS).toISOString();   // created at least 48h ago
    const withinBand = new Date(now - NURTURE_AFTER_MS - BAND_MS).toISOString(); // but not older than 96h

    // Demo requests aged into the band, not yet nurtured. Bounded + capped so a first run can only
    // ever touch a small, recent set — never the historical backlog.
    const { data: due, error } = await supabaseAdmin
      .from('waitlist')
      .select('email, name, created_at')
      .eq('kind', 'demo')
      .is('nurtured_at', null)
      .lte('created_at', olderThan)
      .gte('created_at', withinBand)
      .limit(200);
    if (error) throw new Error(error.message);

    const demoUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/candidate` : undefined;

    for (const row of due || []) {
      // Atomic once-only claim: only the update that flips NULL -> timestamp wins, so two ticks
      // (or two instances) can never double-send.
      const { data: claimed } = await supabaseAdmin
        .from('waitlist')
        .update({ nurtured_at: new Date().toISOString() })
        .eq('email', row.email)
        .eq('kind', 'demo')
        .is('nurtured_at', null)
        .select('email');
      if (!Array.isArray(claimed) || !claimed.length) continue;

      // CAN-SPAM: this is marketing mail, so honor prior opt-outs (the claim above already
      // consumed the row, so a suppressed recipient is never retried) and carry an unsubscribe
      // link + List-Unsubscribe headers on what we do send.
      if (await emailCompliance.isSuppressed(row.email)) continue;
      const unsubscribeUrl = await emailCompliance.getUnsubscribeUrl(row.email);

      const firstName = firstNameOf(row.name);
      await emailService.sendEmail({
        to: row.email,
        subject: 'A quick follow-up on your Touchstones demo',
        body:
          `Hi${firstName ? ' ' + firstName : ''}, thanks for asking about a Touchstones demo. ` +
          "You don't have to wait for a call: you can try a real 5-minute screen yourself (no signup), " +
          "and I'll happily author a task from one of your open engineering reqs and walk you through a " +
          'scored report. Just reply and tell me which role.\n\nTouchstones' +
          emailCompliance.textFooter(unsubscribeUrl),
        html: emailTemplates.demoNurture({ firstName, demoUrl, unsubscribeUrl }),
        fromName: 'Touchstones',
        headers: emailCompliance.listUnsubscribeHeaders(unsubscribeUrl),
      }).catch((e) => console.warn('waitlistNurture send failed (non-blocking):', e.message));
    }
  } catch (e) {
    console.warn('waitlistNurture sweep failed (non-blocking):', e.message);
  }
}

let timer = null;
function start({ intervalMs = 30 * 60 * 1000 } = {}) {
  if (timer) return;
  if (!nurtureEnabled()) {
    console.log('waitlistNurture: disabled (set WAITLIST_NURTURE_ENABLED=true to enable).');
    return;
  }
  setTimeout(() => runSweep().catch(() => {}), 45000); // shortly after boot
  timer = setInterval(() => runSweep().catch(() => {}), intervalMs);
  if (timer.unref) timer.unref();
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { runSweep, start, stop };
