/**
 * Scoring sweep — self-healing rail for submissions whose auto-score never landed
 * (LLM outage, container restart mid-score, transient DB error). Finds submissions
 * stuck in 'submitted'/'pending_scoring' past a grace window, enqueues them into the
 * existing scoring_jobs queue (idempotent upsert), and drains the queue in-process.
 *
 * Safe by construction: enqueue dedups on (submission_id, rubric_version); processJob
 * consults processed_events before spending on the LLM; exhausted jobs ('failed',
 * attempts >= max) are skipped here so a poison submission cannot burn spend every tick.
 * Runs regardless of USE_SCORING_QUEUE — when the worker is also on, the optimistic
 * claim in claimNext keeps the two drains from double-processing.
 */
const { supabaseAdmin } = require('../config/supabase');
const scoringQueue = require('./scoringQueue');
const { logger } = require('../config/observability');

const GRACE_MS = Number(process.env.SCORING_SWEEP_GRACE_MS || 5 * 60 * 1000);
const STUCK = ['submitted', 'pending_scoring'];

async function runSweep() {
  try {
    const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
    const { data: stuck } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, work_sample_id, submitted_at')
      .in('status', STUCK)
      .lt('submitted_at', cutoff)
      .limit(25);
    if (!stuck || !stuck.length) return { enqueued: 0, drained: 0 };

    let enqueued = 0;
    for (const sub of stuck) {
      const { data: ws } = await supabaseAdmin
        .from('work_samples').select('rubric_version').eq('id', sub.work_sample_id).single();
      const rubricVersion = ws?.rubric_version ?? 1;
      // Skip pairs the queue has already given up on — re-enqueueing would reset
      // 'failed' back to 'queued' and retry a poison submission forever.
      const { data: job } = await supabaseAdmin
        .from('scoring_jobs')
        .select('status')
        .eq('submission_id', sub.id).eq('rubric_version', rubricVersion)
        .maybeSingle();
      if (job && (job.status === 'failed' || job.status === 'processing')) continue;
      if (!job) {
        await scoringQueue.enqueue(sub.id, rubricVersion, { interactive: false });
        enqueued++;
      }
    }

    // Drain whatever is queued (ours or leftovers), bounded per tick.
    let drained = 0;
    for (let i = 0; i < 25; i++) {
      const r = await scoringQueue.drainOnce();
      if (!r) break;
      drained++;
    }
    if (enqueued || drained) logger.info({ enqueued, drained }, 'scoring sweep tick');
    return { enqueued, drained };
  } catch (e) {
    logger.warn({ e }, 'scoringSweep failed (non-blocking)');
    return { enqueued: 0, drained: 0, error: e.message };
  }
}

let timer = null;
function start({ intervalMs = Number(process.env.SCORING_SWEEP_INTERVAL_MS || 5 * 60 * 1000) } = {}) {
  if (timer) return;
  setTimeout(() => runSweep().catch(() => {}), 45000); // shortly after boot, offset from deadlineSweep
  timer = setInterval(() => runSweep().catch(() => {}), intervalMs);
  if (timer.unref) timer.unref();
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { runSweep, start, stop };
