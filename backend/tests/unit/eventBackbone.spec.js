/**
 * Event backbone (migration 113 + eventRelay + confluentProducer) unit coverage:
 *   1) envelope builder wire format + the PII-key fail-closed guard
 *   2) static no-PII scan of the migration's SQL payload builders
 *   3) relay gating (dormant by default), batching/claiming, ordering, single-flight
 * The producer's produce/isConfigured are mocked (no broker in tests); buildEnvelope and the
 * PII guard are the real implementations so the relay tests exercise them end to end.
 */
const fs = require('fs');
const path = require('path');

// Controllable supabase stub: select chain resolves the unpublished fixture; update().eq()
// records the stamped row ids (the relay's claim step).
const mockDb = {
  rows: [],
  stamped: [],
  selectError: null,
  stampError: null,
  reset() { this.rows = []; this.stamped = []; this.selectError = null; this.stampError = null; },
};

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => {
        const q = {};
        for (const m of ['is', 'order', 'limit']) q[m] = () => q;
        q.then = (resolve, reject) =>
          Promise.resolve({ data: mockDb.rows, error: mockDb.selectError }).then(resolve, reject);
        return q;
      },
      update: () => ({
        eq: (_col, id) => {
          if (mockDb.stampError) return Promise.resolve({ error: mockDb.stampError });
          mockDb.stamped.push(id);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

jest.mock('../../src/services/confluentProducer', () => {
  const actual = jest.requireActual('../../src/services/confluentProducer');
  return { ...actual, produce: jest.fn(), isConfigured: jest.fn(() => false) };
});

const producer = require('../../src/services/confluentProducer');
const relay = require('../../src/services/eventRelay');

const { buildEnvelope, piiKeyViolations } = producer;

function outboxRow(overrides = {}) {
  return {
    id: 'evt-1',
    seq: 1,
    occurred_at: '2026-07-14T00:00:00Z',
    event_type: 'session.started',
    topic: 'touchstones.lifecycle.v1',
    partition_key: 'sub-1',
    payload: { submission_id: 'sub-1', work_sample_id: 'ws-1', candidate_id: 'cand-1', started_at: '2026-07-14T00:00:00Z' },
    ...overrides,
  };
}

afterEach(() => {
  mockDb.reset();
  producer.produce.mockReset();
  producer.isConfigured.mockReset();
  producer.isConfigured.mockReturnValue(false);
  delete process.env.CONFLUENT_STREAMING_ENABLED;
  relay.stop();
});

describe('buildEnvelope (wire format)', () => {
  test('maps an outbox row to the versioned envelope', () => {
    const env = buildEnvelope(outboxRow());
    expect(env).toEqual({
      event_id: 'evt-1',
      event_type: 'session.started',
      schema_version: 1,
      sequence: 1,
      occurred_at: '2026-07-14T00:00:00Z',
      source: 'touchstones-api',
      payload: outboxRow().payload,
    });
  });

  test('accepts every payload shape the 113 triggers emit', () => {
    const shapes = [
      { invite_id: 'i', work_sample_id: 'w', invited_by: 'p', invited_at: 't' },
      { consent_id: 'c', candidate_id: 'p', submission_id: 's', modality: 'behavioral', consent_version: 'v1', granted_at: 't' },
      { submission_id: 's', work_sample_id: 'w', candidate_id: 'p', submitted_at: 't', status: 'submitted' },
      { submission_id: 's', work_sample_id: 'w', declined_at: 't' },
      { integrity_event_id: 'e', submission_id: 's', kind: 'tab_blur', category: 'proctoring', chain_seq: 4, server_ts: 't' },
      { score_id: 'x', submission_id: 's', rubric_version: 2, normalized_score: 82, outcome: 'review' },
      { erasure_id: 'e', candidate_id: 'p', mode: 'hard', erased_at: 't' },
    ];
    for (const payload of shapes) {
      expect(() => buildEnvelope(outboxRow({ payload }))).not.toThrow();
    }
  });

  test('fails closed on PII-ish payload keys, including nested ones', () => {
    const bad = [
      { email: 'x@y.z' },
      { candidate_email: 'x@y.z' },
      { first_name: 'Ada' },
      { response_text: 'essay' },
      { response_code: 'code' },
      { decline_reason: 'busy' },
      { meta: { anything: 1 } },
      { details: { transcript: 'words' } },
    ];
    for (const payload of bad) {
      expect(() => buildEnvelope(outboxRow({ payload }))).toThrow(/PII-ish keys/);
    }
  });
});

describe('migration 113 payload builders (static no-PII scan)', () => {
  test('no jsonb payload key token-matches the PII denylist', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/113_domain_events.sql'), 'utf8');
    // Payload keys are always a quoted literal whose value is drawn from the row (new.*),
    // e.g. 'submission_id', new.id. Function-result keys ('ok', 'reason', ...) never reach Kafka.
    const keys = [...sql.matchAll(/'([a-z_]+)',\s*new\./g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(25); // all eight builders matched
    const violations = piiKeyViolations(Object.fromEntries(keys.map((k) => [k, 1])));
    expect(violations).toEqual([]);
  });
});

describe('eventRelay (dormant by default)', () => {
  test('no-ops without the flag, and with the flag but no producer env', async () => {
    await expect(relay.runTick()).resolves.toEqual({ published: 0, skipped: true });
    process.env.CONFLUENT_STREAMING_ENABLED = 'true';
    await expect(relay.runTick()).resolves.toEqual({ published: 0, skipped: true });
    expect(producer.produce).not.toHaveBeenCalled();
    expect(relay.enabled()).toBe(false);
  });

  test('start() is inert when disabled', () => {
    expect(() => relay.start()).not.toThrow();
    expect(() => relay.stop()).not.toThrow();
  });
});

describe('eventRelay (enabled)', () => {
  beforeEach(() => {
    process.env.CONFLUENT_STREAMING_ENABLED = 'true';
    producer.isConfigured.mockReturnValue(true);
  });

  test('publishes the batch in seq order with topic + partition key, then stamps published_at', async () => {
    mockDb.rows = [
      outboxRow({ id: 'e1', seq: 1 }),
      outboxRow({ id: 'e2', seq: 2, event_type: 'integrity.signal', topic: 'touchstones.integrity.v1', payload: { submission_id: 'sub-1', kind: 'paste' } }),
      outboxRow({ id: 'e3', seq: 3, event_type: 'candidate.erased', topic: 'touchstones.deletion.v1', partition_key: 'cand-1', payload: { erasure_id: 'x', candidate_id: 'cand-1', mode: 'hard' } }),
    ];
    producer.produce.mockResolvedValue();

    await expect(relay.runTick()).resolves.toEqual({ published: 3 });
    expect(producer.produce).toHaveBeenCalledTimes(3);
    expect(producer.produce.mock.calls.map(([a]) => a.envelope.sequence)).toEqual([1, 2, 3]);
    expect(producer.produce.mock.calls[1][0]).toMatchObject({
      topic: 'touchstones.integrity.v1',
      key: 'sub-1',
      envelope: { event_id: 'e2', schema_version: 1, source: 'touchstones-api' },
    });
    expect(mockDb.stamped).toEqual(['e1', 'e2', 'e3']);
  });

  test('a produce failure stops the batch and leaves rows unpublished for retry (at-least-once)', async () => {
    mockDb.rows = [outboxRow({ id: 'e1', seq: 1 }), outboxRow({ id: 'e2', seq: 2 })];
    producer.produce.mockResolvedValueOnce().mockRejectedValueOnce(new Error('broker unreachable'));

    const result = await relay.runTick();
    expect(result.published).toBe(0);
    expect(result.error).toMatch(/broker unreachable/);
    expect(mockDb.stamped).toEqual(['e1']); // e2 and anything after stay unpublished
  });

  test('a PII-ish payload is quarantined (never produced, but stamped) and does not block later rows', async () => {
    // A row whose payload trips the no-PII guard must never reach Kafka, but it must also not
    // head-of-line block every later row forever. It is quarantined: stamped so it stops being
    // refetched, never produced, and the good row after it still publishes on the same tick.
    mockDb.rows = [
      outboxRow({ id: 'poison', seq: 1, payload: { email: 'x@y.z' } }),
      outboxRow({ id: 'good', seq: 2 }),
    ];
    producer.produce.mockResolvedValue();
    const result = await relay.runTick();
    expect(result.published).toBe(1);
    expect(producer.produce).toHaveBeenCalledTimes(1);
    expect(producer.produce.mock.calls[0][0].envelope.event_id).toBe('good');
    expect(mockDb.stamped).toEqual(['poison', 'good']); // poison stamped (quarantined), never produced
  });

  test('single-flight: a tick never overlaps a running tick', async () => {
    mockDb.rows = [outboxRow()];
    let release;
    producer.produce.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const first = relay.runTick();
    await expect(relay.runTick()).resolves.toEqual({ published: 0, skipped: true });
    while (!release) await new Promise((resolve) => setImmediate(resolve)); // first tick reaches produce
    release();
    await expect(first).resolves.toEqual({ published: 1 });
  });
});
