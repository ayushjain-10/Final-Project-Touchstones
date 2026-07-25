/**
 * AV start-gate enforcement (TOU-147, migration 112).
 * avConsentError is the pure gate POST /api/proof/submissions/:id/start runs before stamping:
 * a screen with av_required only starts with an explicit { av_consent: true } body; anything
 * else gets the 400 payload with code av_consent_required. recordAvConsent writes the consent
 * evidence at a stamped start: per-modality proof_consent rows (camera + microphone, 025/088)
 * plus one av_consent_granted event on the integrity chain, and is best-effort throughout (a
 * ledger hiccup never costs the candidate their consented start).
 * Supabase is mocked (same pattern as declineReset.spec.js) so the test is offline.
 */
let mockState;
jest.mock('../../src/config/supabase', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  supabaseAdmin: {
    from: (table) => ({
      insert: async (rows) => {
        mockState.inserts.push({ table, rows });
        return { error: mockState.insertError || null };
      },
    }),
    rpc: async (fn, args) => {
      mockState.rpcs.push({ fn, args });
      return { data: null, error: mockState.rpcError || null };
    },
  },
  createAuthenticatedClient: () => ({}),
}));

const { avConsentError, recordAvConsent } = require('../../src/routes/supabase/proof');

describe('avConsentError (start-gate AV enforcement)', () => {
  test('lets a non-AV screen start with any body', () => {
    expect(avConsentError({ av_required: false }, {})).toBeNull();
    expect(avConsentError({}, {})).toBeNull();
    expect(avConsentError(null, {})).toBeNull();
  });

  test('blocks an AV screen without consent, with the machine-readable code', () => {
    const err = avConsentError({ av_required: true }, {});
    expect(err).toMatchObject({ code: 'av_consent_required' });
    expect(typeof err.error).toBe('string');
    expect(avConsentError({ av_required: true }, undefined)).toMatchObject({ code: 'av_consent_required' });
  });

  test('requires a strict boolean true (no truthy coercion)', () => {
    expect(avConsentError({ av_required: true }, { av_consent: 'true' })).toMatchObject({ code: 'av_consent_required' });
    expect(avConsentError({ av_required: true }, { av_consent: 1 })).toMatchObject({ code: 'av_consent_required' });
    expect(avConsentError({ av_required: true }, { av_consent: true })).toBeNull();
  });
});

describe('recordAvConsent (consent evidence at a stamped start)', () => {
  const submission = { id: 'sub-1', candidate_id: 'cand-1' };

  beforeEach(() => {
    mockState = { inserts: [], rpcs: [], insertError: null, rpcError: null };
  });

  test('writes camera + microphone proof_consent grants with a server-stamped copy hash', async () => {
    await recordAvConsent(submission);
    expect(mockState.inserts).toHaveLength(1);
    const { table, rows } = mockState.inserts[0];
    expect(table).toBe('proof_consent');
    expect(rows.map((r) => r.modality).sort()).toEqual(['camera', 'microphone']);
    for (const row of rows) {
      expect(row).toMatchObject({
        candidate_id: 'cand-1',
        submission_id: 'sub-1',
        decision: 'granted',
        context: { via: 'av_requirement' },
      });
      expect(row.consent_version).toBeTruthy();
      expect(row.consent_copy_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('appends one server-observed av_consent_granted event to the integrity chain', async () => {
    await recordAvConsent(submission);
    expect(mockState.rpcs).toHaveLength(1);
    const { fn, args } = mockState.rpcs[0];
    expect(fn).toBe('append_integrity_event');
    expect(args).toMatchObject({
      p_submission_id: 'sub-1',
      p_type: 'av_consent_granted',
      p_category: 'av',
      p_source: 'server_observed',
    });
    expect(args.p_meta.modalities.sort()).toEqual(['camera', 'microphone']);
  });

  test('a ledger failure never throws and still appends the chain event', async () => {
    mockState.insertError = { message: 'proof_consent unavailable' };
    await expect(recordAvConsent(submission)).resolves.toBeUndefined();
    expect(mockState.rpcs).toHaveLength(1);
  });

  test('a chain failure never throws either', async () => {
    mockState.rpcError = { message: 'chain unavailable' };
    await expect(recordAvConsent(submission)).resolves.toBeUndefined();
    expect(mockState.inserts).toHaveLength(1);
  });
});
