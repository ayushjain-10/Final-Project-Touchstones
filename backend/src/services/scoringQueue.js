/**
 * Async scoring queue + Node worker (SYSTEM_DESIGN.md roadmap #8/#2a).
 *
 * Scoring leaves the request path for AVAILABILITY — one Render worker cannot block
 * 3–8s on an LLM under concurrency. `POST /score` enqueues a row and returns 202; this
 * worker (same codebase, NOT a separate service) drains the queue, scores via
 * proofScoringService, and flips status so Supabase Realtime pushes the result.
 *
 * Enabled by USE_SCORING_QUEUE=true. When off, the route scores inline (the default,
 * and the path the tests + current frontend exercise). One queue, one code path; the
 * interactive/batch choice is a per-job flag, not a forked architecture.
 */
const { supabaseAdmin } = require('../config/supabase');
const proofScoringService = require('./proofScoringService');
const { logger, captureException } = require('../config/observability');

const MAX_ATTEMPTS = parseInt(process.env.SCORING_JOB_MAX_ATTEMPTS || '3', 10);

// Enqueue is idempotent on (submission_id, rubric_version): a rubric bump makes a NEW
// job; re-enqueue for the same pair is a no-op (the intended dedup).
async function enqueue(submissionId, rubricVersion, { interactive = true } = {}) {
  const { data, error } = await supabaseAdmin
    .from('scoring_jobs')
    .upsert(
      { submission_id: submissionId, rubric_version: rubricVersion, status: 'queued', interactive },
      { onConflict: 'submission_id,rubric_version' }
    )
    .select('id, status')
    .single();
  if (error) throw new Error('enqueue failed: ' + error.message);
  return data;
}

// Claim one queued job. The conditional UPDATE (.eq('status','queued')) is an optimistic
// guard so two workers can't both process the same row — the loser's update matches no
// row and returns null. Adequate for the single-worker MVP; for multi-worker, move the
// claim into a SECURITY DEFINER `FOR UPDATE SKIP LOCKED` RPC.
async function claimNext() {
  const { data: jobs, error } = await supabaseAdmin
    .from('scoring_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !jobs || !jobs.length) return null;
  const job = jobs[0];
  const { data: claimed } = await supabaseAdmin
    .from('scoring_jobs')
    .update({ status: 'processing', attempts: (job.attempts || 0) + 1 })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('*')
    .single();
  return claimed || null;
}

async function processJob(job) {
  const dedupKey = `${job.submission_id}:${job.rubric_version}`;
  try {
    // Re-score safety rail (SYSTEM_DESIGN §2a step 3): if this (submission, rubric) was
    // already scored, do NOT re-spend on the LLM — mark scored and return. This actually
    // READS processed_events (previously it was only written), closing the duplicate-
    // score / double-spend window on a retry after a successful score.
    const { data: seen } = await supabaseAdmin.from('processed_events')
      .select('event_key').eq('event_key', dedupKey).maybeSingle();
    if (seen) {
      await supabaseAdmin.from('scoring_jobs').update({ status: 'scored', last_error: null }).eq('id', job.id);
      return { id: job.id, status: 'scored', cached: true };
    }

    const result = await proofScoringService.scoreSubmission(job.submission_id, {});

    // LLM unavailable (graceful degradation #9): requeue so the worker re-drains on
    // recovery — bounded by MAX_ATTEMPTS. This is NOT a terminal status (the previous
    // code wrote 'pending_scoring' terminal, parking the job forever).
    if (result.status === 'pending_scoring') {
      const exhausted = (job.attempts || 0) >= MAX_ATTEMPTS;
      await supabaseAdmin.from('scoring_jobs')
        .update({ status: exhausted ? 'failed' : 'queued', last_error: 'llm_unavailable' })
        .eq('id', job.id);
      return { id: job.id, status: exhausted ? 'failed' : 'requeued' };
    }

    const status = result.status === 'needs_review' ? 'needs_review' : 'scored';
    await supabaseAdmin.from('scoring_jobs').update({ status, last_error: null }).eq('id', job.id);
    // Record that we handled this pair (only on a real terminal score/needs_review).
    await supabaseAdmin.from('processed_events')
      .upsert({ event_key: dedupKey, source: 'scoring', result: { status } }, { onConflict: 'event_key' });
    return { id: job.id, status };
  } catch (err) {
    const exhausted = (job.attempts || 0) >= MAX_ATTEMPTS;
    await supabaseAdmin.from('scoring_jobs')
      .update({ status: exhausted ? 'failed' : 'queued', last_error: String(err.message || err).slice(0, 500) })
      .eq('id', job.id);
    logger.error({ err, jobId: job.id, exhausted }, 'scoring job failed');
    captureException(err, { jobId: job.id });
    return { id: job.id, status: exhausted ? 'failed' : 'requeued' };
  }
}

// Drain a single job (returns null when the queue is empty). Useful for tests/cron.
async function drainOnce() {
  const job = await claimNext();
  if (!job) return null;
  return processJob(job);
}

let running = false;
function startWorker({ intervalMs = Number(process.env.SCORING_WORKER_INTERVAL_MS || 2000) } = {}) {
  if (running) return;
  running = true;
  const tick = async () => {
    if (!running) return;
    try {
      let r;
      do { r = await drainOnce(); } while (r && running); // burst-drain until empty
    } catch (e) {
      logger.error({ e }, 'scoring worker tick error');
    }
    if (running) setTimeout(tick, intervalMs).unref();
  };
  setTimeout(tick, intervalMs).unref();
  logger.info('scoring worker started');
}
function stopWorker() { running = false; }

module.exports = { enqueue, claimNext, processJob, drainOnce, startWorker, stopWorker };
