/**
 * Confluent Cloud producer — thin, lazy wrapper around @confluentinc/kafka-javascript used only
 * by eventRelay. Dormant unless the three CONFLUENT_* producer env vars exist; the module can be
 * required safely on boxes without the native binary because the client library is only loaded
 * on first produce. Never crashes the app: connection/produce failures throw to the caller
 * (the relay leaves rows unpublished and retries next tick).
 *
 * Envelope (wire format, one JSON object per Kafka message):
 *   { event_id, event_type, schema_version: 1, sequence, occurred_at, source, payload }
 * sequence is the outbox bigserial: Kafka orders per partition only, so consumers re-establish
 * cross-topic causality from sequence and dedupe on event_id (delivery is at-least-once).
 *
 * COMPLIANCE: payloads are pseudonymous by construction (SQL builders, migration 113). As
 * defense in depth, buildEnvelope re-checks every payload key against a PII denylist and throws
 * rather than publish — failing closed beats leaking.
 */
const { logger } = require('../config/observability');

// Reject any payload key containing one of these tokens (split on _). Catches email,
// first_name/last_name, response_text/response_code, decline_reason, meta/metadata, etc.
const PII_KEY_TOKENS = new Set([
  'email', 'name', 'content', 'code', 'transcript', 'text', 'message',
  'phone', 'address', 'reason', 'body', 'response', 'meta', 'metadata',
]);

function piiKeyViolations(payload, path = '') {
  if (!payload || typeof payload !== 'object') return [];
  const violations = [];
  for (const [key, value] of Object.entries(payload)) {
    const tokens = key.toLowerCase().split(/[_.-]/);
    if (tokens.some((t) => PII_KEY_TOKENS.has(t))) violations.push(path + key);
    if (value && typeof value === 'object') violations.push(...piiKeyViolations(value, `${path}${key}.`));
  }
  return violations;
}

function buildEnvelope(row) {
  const violations = piiKeyViolations(row.payload);
  if (violations.length) {
    throw new Error(`domain event ${row.id} (${row.event_type}) payload has PII-ish keys: ${violations.join(', ')}`);
  }
  return {
    event_id: row.id,
    event_type: row.event_type,
    schema_version: 1,
    sequence: row.seq,
    occurred_at: row.occurred_at,
    source: 'touchstones-api',
    payload: row.payload,
  };
}

function isConfigured() {
  return Boolean(
    process.env.CONFLUENT_BOOTSTRAP_SERVERS &&
    process.env.CONFLUENT_KAFKA_API_KEY &&
    process.env.CONFLUENT_KAFKA_API_SECRET
  );
}

let producer = null;     // connected producer singleton
let connecting = null;   // in-flight connect, so concurrent callers share one attempt

async function getProducer() {
  if (producer) return producer;
  if (!connecting) {
    connecting = (async () => {
      // Lazy load: keeps boot independent of the native librdkafka binary when disabled.
      const { Kafka } = require('@confluentinc/kafka-javascript').KafkaJS;
      const kafka = new Kafka({});
      const p = kafka.producer({
        'bootstrap.servers': process.env.CONFLUENT_BOOTSTRAP_SERVERS,
        'security.protocol': 'SASL_SSL',
        'sasl.mechanisms': 'PLAIN',
        'sasl.username': process.env.CONFLUENT_KAFKA_API_KEY,
        'sasl.password': process.env.CONFLUENT_KAFKA_API_SECRET,
        'enable.idempotence': true,   // broker dedupes producer retries
        'acks': -1,                   // acks=all before the relay stamps published_at
        'message.timeout.ms': 30000,  // fail a produce within one relay tick horizon
        'socket.connection.setup.timeout.ms': 10000,
      });
      await p.connect();
      producer = p;
      return p;
    })();
    connecting.catch(() => { connecting = null; }); // allow a fresh attempt next tick
  }
  return connecting;
}

async function produce({ topic, key, envelope }) {
  const p = await getProducer();
  await p.send({ topic, messages: [{ key, value: JSON.stringify(envelope) }] });
}

async function disconnect() {
  const p = producer;
  producer = null;
  connecting = null;
  if (p) {
    try { await p.disconnect(); } catch (e) { logger.warn({ e }, 'confluent producer disconnect failed'); }
  }
}

module.exports = { buildEnvelope, piiKeyViolations, isConfigured, produce, disconnect };
