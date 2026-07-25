/**
 * Event relay — publishes domain_events outbox rows (migration 113) to Confluent Cloud topics.
 * Interval poller in the scoringSweep mold: start() from app.js, env-tunable interval, inert in
 * tests, and fully dormant unless CONFLUENT_STREAMING_ENABLED=true AND the producer env exists
 * (one info line at startup, then silence).
 *
 * Semantics: fetch unpublished rows ordered by seq, produce SEQUENTIALLY per row (idempotent
 * producer, acks=all), stamp published_at after each ack. A crash between produce and stamp
 * redelivers the row next tick, so delivery is at-least-once; consumers dedupe on event_id. A
 * produce failure stops the batch (later rows must not overtake earlier ones) and leaves
 * everything unstamped for the next tick. Error logging is capped so a dead broker cannot spam.
 *
 * Single instance assumption: dev runs one container. Before scaling replicas, add a Postgres
 * advisory lock around the tick (see PROJECT-DOCUMENTATION/16-EVENT-BACKBONE.md).
 */
const { supabaseAdmin } = require('../config/supabase');
const producer = require('./confluentProducer');
const { logger } = require('../config/observability');

const BATCH_SIZE = 200;
const ERROR_LOG_CAP = 3;    // log the first N consecutive failures, then every 50th

let running = false;        // single-flight: ticks never overlap
let consecutiveErrors = 0;

function enabled() {
  return process.env.CONFLUENT_STREAMING_ENABLED === 'true' && producer.isConfigured();
}

async function runTick() {
  if (!enabled() || running) return { published: 0, skipped: true };
  running = true;
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('domain_events')
      .select('id, seq, occurred_at, event_type, topic, partition_key, payload')
      .is('published_at', null)
      .order('seq', { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw error;
    if (!rows || !rows.length) {
      consecutiveErrors = 0;
      return { published: 0 };
    }

    let published = 0;
    for (const row of rows) {
      let envelope;
      try {
        envelope = producer.buildEnvelope(row); // throws on PII-ish keys: fail closed
      } catch (buildErr) {
        // A row that fails the no-PII guard must NEVER reach Kafka. It is a data defect in an
        // emitter, not a transient fault, so do not abort the batch (that would head-of-line block
        // every later row forever). Quarantine it: stamp published_at so it stops being refetched,
        // log loudly and uncapped for investigation. The row stays in domain_events as the record;
        // it is simply never sent downstream.
        logger.error({ err: buildErr.message, rowId: row.id, eventType: row.event_type },
          'domain event failed the no-PII guard; quarantined, NOT published to Kafka');
        await supabaseAdmin.from('domain_events')
          .update({ published_at: new Date().toISOString() }).eq('id', row.id);
        continue;
      }
      await producer.produce({ topic: row.topic, key: row.partition_key, envelope });
      const { error: stampError } = await supabaseAdmin
        .from('domain_events')
        .update({ published_at: new Date().toISOString() })
        .eq('id', row.id);
      if (stampError) throw stampError;
      published++;
    }
    consecutiveErrors = 0;
    if (published) logger.info({ published }, 'event relay tick');
    return { published };
  } catch (e) {
    consecutiveErrors++;
    if (consecutiveErrors <= ERROR_LOG_CAP || consecutiveErrors % 50 === 0) {
      logger.warn({ e, consecutiveErrors }, 'event relay tick failed; rows stay unpublished for retry');
    }
    return { published: 0, error: e.message };
  } finally {
    running = false;
  }
}

let timer = null;
function start({ intervalMs = Number(process.env.EVENT_RELAY_INTERVAL_MS || 5000) } = {}) {
  if (timer) return;
  if (!enabled()) {
    logger.info('event relay disabled (CONFLUENT_STREAMING_ENABLED != true or producer env missing)');
    return;
  }
  timer = setInterval(() => runTick().catch(() => {}), intervalMs);
  if (timer.unref) timer.unref();
  logger.info({ intervalMs }, 'event relay started');
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { runTick, start, stop, enabled };
