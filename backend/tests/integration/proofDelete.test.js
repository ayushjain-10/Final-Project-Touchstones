/**
 * DELETE /api/proof/work-samples/:id — owner-scoped delete.
 * The ownership gate is an RLS-scoped read (only the owner can read their own work sample); the
 * delete then runs via service-role. A non-owner must get 404, the owner 200.
 *
 * supabaseAuth + config/supabase are mocked: the RLS-scoped client returns the work sample only
 * to its owner; supabaseAdmin.delete removes it from the in-memory store.
 */
let mockWS; // the single work_samples row under test (null once deleted)
let mockMembers; // uids that can READ the row via ws_member_select but are not the owner

jest.mock('../../src/config/supabase', () => {
  const wsQuery = () => {
    const q = {};
    q.select = () => q; q.eq = () => q;
    q.single = async () => ({ data: mockWS, error: mockWS ? null : { code: 'PGRST116' } });
    // update({status}).eq('id').eq('owner_id') — soft-delete (archive). Chainable thenable that
    // merges the patch onto the row on await (so the test can assert status became 'archived').
    q.update = (patch) => {
      const chain = {};
      chain.eq = () => chain;
      chain.then = (resolve) => { if (mockWS) mockWS = { ...mockWS, ...patch }; resolve({ error: null }); };
      return chain;
    };
    return q;
  };
  return {
    supabaseAdmin: { from: () => wsQuery() },
    createAuthenticatedClient: () => ({ from: () => wsQuery() }),
  };
});

jest.mock('../../src/middleware/supabaseAuth', () => ({
  supabaseAuth: (req, res, next) => {
    const uid = req.headers['x-test-user'] || 'owner-1';
    // RLS-scoped client: the work sample is READABLE by its owner AND by active workspace
    // teammates (migration 038 ws_member_select). mockMembers models the teammate set.
    const scoped = {
      from: () => {
        const q = {};
        q.select = () => q; q.eq = () => q;
        q.single = async () => {
          const visible = mockWS && (mockWS.owner_id === uid || mockMembers.includes(uid)) ? mockWS : null;
          return { data: visible, error: visible ? null : { code: 'PGRST116' } };
        };
        return q;
      },
    };
    req.user = { id: uid, supabase: scoped };
    next();
  },
  optionalSupabaseAuth: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const proofRouter = require('../../src/routes/supabase/proof');

const app = express();
app.use(express.json());
app.use('/api/proof', proofRouter);

const WS_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { mockWS = { id: WS_ID, owner_id: 'owner-1' }; mockMembers = []; });

describe('DELETE /api/proof/work-samples/:id', () => {
  test('non-member non-owner → 404 (cannot see it under RLS), row not deleted', async () => {
    const r = await request(app).delete(`/api/proof/work-samples/${WS_ID}`).set('x-test-user', 'someone-else');
    expect(r.status).toBe(404);
    expect(mockWS).not.toBeNull(); // untouched
  });

  test('workspace TEAMMATE (can read, not owner) → 403, NOT archived (the privilege-escalation fix)', async () => {
    mockMembers = ['teammate-1']; // can READ via ws_member_select, but is not the owner
    const r = await request(app).delete(`/api/proof/work-samples/${WS_ID}`).set('x-test-user', 'teammate-1');
    expect(r.status).toBe(403);
    expect(mockWS.status).toBeUndefined(); // owner's screen untouched
  });

  test('owner → 200 { deleted:true }, screen ARCHIVED (soft-delete, evidence preserved)', async () => {
    const r = await request(app).delete(`/api/proof/work-samples/${WS_ID}`).set('x-test-user', 'owner-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deleted: true, id: WS_ID });
    expect(mockWS.status).toBe('archived'); // soft-deleted, not hard-removed
  });

  test('invalid id → 400', async () => {
    const r = await request(app).delete('/api/proof/work-samples/not-a-uuid').set('x-test-user', 'owner-1');
    expect(r.status).toBe(400);
  });
});
