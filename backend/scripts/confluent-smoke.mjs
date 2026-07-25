#!/usr/bin/env node
/**
 * Confluent Cloud smoke test for the event backbone (PROJECT-DOCUMENTATION/16-EVENT-BACKBONE.md).
 * With producer creds set it: (1) ensures the four touchstones.*.v1 topics exist (creates them
 * with 3 partitions if missing), (2) produces one synthetic envelope to the lifecycle topic,
 * (3) consumes it back, printing PASS/FAIL per step. Without creds it prints the vars to set and
 * exits 0 so CI and cred-less laptops are never broken by it.
 *
 * Usage: node backend/scripts/confluent-smoke.mjs
 * (source ops/confluent/.env first; both the backend CONFLUENT_* names and the MCP names work)
 */
import { randomUUID } from 'node:crypto';

const BOOTSTRAP = process.env.CONFLUENT_BOOTSTRAP_SERVERS || process.env.BOOTSTRAP_SERVERS;
const API_KEY = process.env.CONFLUENT_KAFKA_API_KEY || process.env.KAFKA_API_KEY;
const API_SECRET = process.env.CONFLUENT_KAFKA_API_SECRET || process.env.KAFKA_API_SECRET;

const TOPICS = [
  'touchstones.lifecycle.v1',
  'touchstones.consent.v1',
  'touchstones.integrity.v1',
  'touchstones.deletion.v1',
];
const LIFECYCLE = TOPICS[0];
const CONSUME_TIMEOUT_MS = 30000;

if (!BOOTSTRAP || !API_KEY || !API_SECRET) {
  console.log('confluent-smoke: no credentials set; nothing attempted (exit 0).');
  console.log('Set these (see ops/confluent/.env.example):');
  console.log('  CONFLUENT_BOOTSTRAP_SERVERS (or BOOTSTRAP_SERVERS)');
  console.log('  CONFLUENT_KAFKA_API_KEY     (or KAFKA_API_KEY)');
  console.log('  CONFLUENT_KAFKA_API_SECRET  (or KAFKA_API_SECRET)');
  process.exit(0);
}

const { KafkaJS } = await import('@confluentinc/kafka-javascript');
const { Kafka } = KafkaJS;

const connection = {
  'bootstrap.servers': BOOTSTRAP,
  'security.protocol': 'SASL_SSL',
  'sasl.mechanisms': 'PLAIN',
  'sasl.username': API_KEY,
  'sasl.password': API_SECRET,
};

const kafka = new Kafka({});
let failed = false;
const step = (name, ok, detail = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) || (ok || (failed = true));

// Step 1: topics exist (create with 3 partitions if missing; never repartition later, the
// key-to-partition mapping is what gives per-subject ordering).
const admin = kafka.admin(connection);
try {
  await admin.connect();
  const existing = await admin.listTopics();
  const missing = TOPICS.filter((t) => !existing.includes(t));
  if (missing.length) {
    await admin.createTopics({ topics: missing.map((topic) => ({ topic, numPartitions: 3 })) });
  }
  step('topics exist', true, missing.length ? `created: ${missing.join(', ')}` : 'all present');
} catch (e) {
  step('topics exist', false, e.message);
} finally {
  await admin.disconnect().catch(() => {});
}

// Step 2: produce one synthetic envelope (same wire format as confluentProducer.buildEnvelope).
const eventId = randomUUID();
const envelope = {
  event_id: eventId,
  event_type: 'smoke.ping',
  schema_version: 1,
  sequence: 0,
  occurred_at: new Date().toISOString(),
  source: 'touchstones-api',
  payload: { submission_id: randomUUID(), status: 'smoke' },
};
const producer = kafka.producer({ ...connection, 'enable.idempotence': true, 'acks': -1 });
try {
  await producer.connect();
  await producer.send({
    topic: LIFECYCLE,
    messages: [{ key: envelope.payload.submission_id, value: JSON.stringify(envelope) }],
  });
  step('produce envelope', true, `event_id ${eventId}`);
} catch (e) {
  step('produce envelope', false, e.message);
} finally {
  await producer.disconnect().catch(() => {});
}

// Step 3: consume it back with a throwaway group reading from the beginning.
const consumer = kafka.consumer({
  ...connection,
  'group.id': `confluent-smoke-${Date.now()}`,
  'auto.offset.reset': 'earliest',
});
try {
  await consumer.connect();
  await consumer.subscribe({ topic: LIFECYCLE });
  const seen = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), CONSUME_TIMEOUT_MS);
    consumer.run({
      eachMessage: async ({ message }) => {
        try {
          if (JSON.parse(message.value.toString()).event_id === eventId) {
            clearTimeout(timer);
            resolve(true);
          }
        } catch { /* non-JSON message on the topic; keep scanning */ }
      },
    });
  });
  step('consume envelope back', seen, seen ? 'round trip complete' : `not seen within ${CONSUME_TIMEOUT_MS / 1000}s`);
} catch (e) {
  step('consume envelope back', false, e.message);
} finally {
  await consumer.disconnect().catch(() => {});
}

console.log(failed ? 'confluent-smoke: FAIL' : 'confluent-smoke: PASS');
process.exit(failed ? 1 : 0);
