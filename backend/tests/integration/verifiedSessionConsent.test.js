/**
 * Verified-session CONSENT routes (ADR-001 Phase 2) — routes/supabase/verifiedSession.js.
 *
 * These assertions are the ones that DON'T depend on migration 088 being applied or on a real DB:
 *   • kill-switch: ENABLE_VERIFIED_SESSION off => the whole surface 404s (surface invisible);
 *   • fail-closed / validation: bad modality, bad decision, a grant on a stale consent-copy version,
 *     and a missing submission_id are all rejected BEFORE any DB write.
 * The write-path persistence assertions (a grant/decline row is stored with the server-stamped copy
 * hash; withdraw flips withdrawn_at; a decline is never recruiter-visible) require migration 088
 * applied to a real dev DB and live in the migration-gated block at the bottom (skipped in mock/CI).
 *
 * The flag is a module-load constant, so each state loads the router in an isolated registry with the
 * env set — no leakage between cases.
 */
const request = require('supertest');
const express = require('express');

const VALID_SUB = '11111111-1111-4111-8111-111111111111';

// Build a minimal app mounting a FRESH copy of the router with the flag set to `flagOn`.
function appWith(flagOn) {
  let router;
  const prev = process.env.ENABLE_VERIFIED_SESSION;
  jest.isolateModules(() => {
    if (flagOn) process.env.ENABLE_VERIFIED_SESSION = 'true';
    else delete process.env.ENABLE_VERIFIED_SESSION;
    router = require('../../src/routes/supabase/verifiedSession');
  });
  process.env.ENABLE_VERIFIED_SESSION = prev; // module already captured its constant
  const app = express();
  app.use(express.json());
  app.use('/api/verified-session', router);
  return app;
}

describe('verified-session consent — kill-switch (ENABLE_VERIFIED_SESSION off)', () => {
  const app = appWith(false);

  it('404s the consent-copy read', async () => {
    const r = await request(app).get('/api/verified-session/consent-copy');
    expect(r.status).toBe(404);
  });
  it('404s the consent POST', async () => {
    const r = await request(app).post('/api/verified-session/consent').send({ modality: 'camera', decision: 'granted' });
    expect(r.status).toBe(404);
  });
  it('404s the consent read-back', async () => {
    const r = await request(app).get('/api/verified-session/consent').query({ submission_id: VALID_SUB });
    expect(r.status).toBe(404);
  });
  it('404s the withdraw', async () => {
    const r = await request(app).post('/api/verified-session/consent/withdraw').send({ submission_id: VALID_SUB, modality: 'camera' });
    expect(r.status).toBe(404);
  });
});

describe('verified-session consent — flag ON, validation + fail-closed', () => {
  const app = appWith(true);

  it('serves the current consent-copy version + structured blocks', async () => {
    const r = await request(app).get('/api/verified-session/consent-copy');
    expect(r.status).toBe(200);
    expect(r.body.consent_version).toBe('vs-2026-07-01');
    expect(Array.isArray(r.body.blocks)).toBe(true);
    // two distinct affirmative-act (collect + share) blocks per ADR §8
    const acks = r.body.blocks.filter((b) => b.type === 'ack').map((b) => b.id).sort();
    expect(acks).toEqual(['collect', 'share']);
    expect(typeof r.body.text).toBe('string'); // derived plain-text fallback
  });

  it('rejects an unknown modality (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ submission_id: VALID_SUB, modality: 'behavioral', decision: 'granted', consent_version: 'vs-2026-07-01' });
    expect(r.status).toBe(400);
  });

  it('rejects an unknown decision (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ submission_id: VALID_SUB, modality: 'camera', decision: 'maybe' });
    expect(r.status).toBe(400);
  });

  it('FAIL-CLOSED: rejects a grant on a stale consent-copy version (409) before any DB write', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ submission_id: VALID_SUB, modality: 'camera', decision: 'granted', consent_version: 'stale-version' });
    expect(r.status).toBe(409);
  });

  it('accepts a `modalities` ARRAY (unified release) — still fail-closed on stale version (409)', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ submission_id: VALID_SUB, modalities: ['camera', 'microphone', 'walkthrough_recording'], decision: 'granted', consent_version: 'stale' });
    expect(r.status).toBe(409);
  });

  it('rejects an empty modalities array (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ submission_id: VALID_SUB, modalities: [], consent_version: 'vs-2026-07-01' });
    expect(r.status).toBe(400);
  });

  it('rejects an array containing an invalid modality (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ submission_id: VALID_SUB, modalities: ['camera', 'bogus'], decision: 'granted', consent_version: 'vs-2026-07-01' });
    expect(r.status).toBe(400);
  });

  it('requires a submission_id for a decline (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent')
      .send({ modality: 'camera', decision: 'declined' });
    expect(r.status).toBe(400);
  });

  it('requires a submission_id on the read-back (400)', async () => {
    const r = await request(app).get('/api/verified-session/consent');
    expect(r.status).toBe(400);
  });

  it('validates modality on withdraw (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent/withdraw')
      .send({ submission_id: VALID_SUB, modality: 'nope' });
    expect(r.status).toBe(400);
  });

  it('validates the submission uuid on withdraw (400)', async () => {
    const r = await request(app).post('/api/verified-session/consent/withdraw')
      .send({ submission_id: 'not-a-uuid', modality: 'camera' });
    expect(r.status).toBe(400);
  });
});

// ── Migration-gated (needs 088 applied to a real dev DB + real candidate/submission) ─────────────
// Run explicitly once the founder applies migration 088 to dev; skipped in mock/CI so nothing here
// depends on the unapplied schema. Documents the write-path contract the endpoints guarantee.
describe.skip('verified-session consent — persistence (requires migration 088 + live dev DB)', () => {
  it.todo('a grant stores a proof_consent row with a SERVER-stamped consent_copy_hash (client never supplies it)');
  it.todo('a decline stores decision=declined and is NEVER returned to a recruiter (candidate-scoped RLS)');
  it.todo('withdraw flips withdrawn_at NULL->timestamp on the caller\'s own active grant only');
  it.todo('the DB trigger blocks any candidate UPDATE other than the withdrawn_at NULL->timestamp transition');
  it.todo('consent_granted / consent_declined / consent_withdrawn events append to the integrity chain');
});
