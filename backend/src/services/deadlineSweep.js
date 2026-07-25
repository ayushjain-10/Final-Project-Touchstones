/**
 * Deadline sweep — keeps the screening workflow from dead-ending on time:
 *   1) reminds a candidate whose screen is due soon (once, claimed via reminder_sent_at), and
 *   2) flips an un-submitted past-deadline screen to 'expired' and notifies the recruiter.
 * Runs on an interval. Every step is best-effort + idempotent (atomic claim per row), so two ticks
 * can't double-send. Cheap: two indexed queries per tick.
 */
const { supabaseAdmin } = require('../config/supabase');
const workflowNotify = require('./workflowNotify');

const REMIND_WITHIN_MS = Number(process.env.DEADLINE_REMIND_WITHIN_HOURS || 24) * 3600000;
const ACTIVE = ['assigned', 'in_progress'];

// Start gate (migration 107): deadline_at is NULL until the candidate presses Start. Both scans
// below filter on deadline_at ranges (gt/lte and lt), and PostgREST compiles those to SQL
// comparisons where NULL is never true, so unstarted rows are never reminded about or expired.

async function runSweep() {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + REMIND_WITHIN_MS);

    // 1) Reminders — due within the window, not yet reminded, not already past.
    const { data: dueSoon } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, candidate_id, deadline_at, status')
      .in('status', ACTIVE)
      .is('reminder_sent_at', null)
      .gt('deadline_at', now.toISOString())
      .lte('deadline_at', soon.toISOString())
      .limit(200);
    for (const sub of dueSoon || []) {
      const { data: claimed } = await supabaseAdmin
        .from('work_sample_submissions')
        .update({ reminder_sent_at: now.toISOString() })
        .eq('id', sub.id)
        .is('reminder_sent_at', null)
        .select('id');
      if (Array.isArray(claimed) && claimed.length) {
        await workflowNotify.candidateDeadlineReminder(sub);
      }
    }

    // 2) Expiry — past deadline, still active → 'expired' + tell the recruiter.
    const { data: lapsed } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, candidate_id, deadline_at, status')
      .in('status', ACTIVE)
      .lt('deadline_at', now.toISOString())
      .limit(200);
    for (const sub of lapsed || []) {
      const { data: flipped } = await supabaseAdmin
        .from('work_sample_submissions')
        .update({ status: 'expired' })
        .eq('id', sub.id)
        .in('status', ACTIVE)
        .select('id');
      if (Array.isArray(flipped) && flipped.length) {
        await workflowNotify.recruiterScreenExpired(sub);
      }
    }
  } catch (e) {
    console.warn('deadlineSweep failed (non-blocking):', e.message);
  }
}

let timer = null;
function start({ intervalMs = 15 * 60 * 1000 } = {}) {
  if (timer) return;
  setTimeout(() => runSweep().catch(() => {}), 30000); // shortly after boot
  timer = setInterval(() => runSweep().catch(() => {}), intervalMs);
  if (timer.unref) timer.unref();
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { runSweep, start, stop };
