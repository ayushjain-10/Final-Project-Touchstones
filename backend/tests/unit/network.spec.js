/**
 * Candidate Network / "Apply with Touchstones" (CC3/v3) — pure-logic + migration-invariant
 * unit tests (no DB). Locks the four security properties the feature must preserve:
 *   1. candidate-owns-credential RLS  (migration 072 — the 060 lesson, cross-candidate isolation)
 *   2. server-authoritative trust/lifecycle columns  (migration 072 grants + buildApplicationInsert — the 061 lesson)
 *   3. no-PII public redaction  (pickPublicReq)
 *   4. locked public-read RPCs  (migration 073 — the strict 062 lesson)
 * plus the token shape and the reuse-count math. These run in CI (env-independent) and fail
 * loudly if a migration is reverted/weakened.
 */
const fs = require('fs');
const path = require('path');
const {
  tokenValid,
  tokenFromInput,
  normalizeReqTitle,
  pickPublicReq,
  PUBLIC_REQ_KEYS,
  buildApplicationInsert,
  APPLICATION_INSERT_KEYS,
  APPLICATION_STATUSES,
  summarizeReuse,
  MAX_NOTE,
  MAX_TITLE,
} = require('../../src/services/networkService');

const mig = (name) =>
  fs.readFileSync(path.join(__dirname, '../../supabase/migrations', name), 'utf8');

describe('tokenValid / tokenFromInput', () => {
  test.each(['abc123', 'A1b2C3', 'f'.repeat(32), 'f'.repeat(128)])('accepts %j', (t) => {
    expect(tokenValid(t)).toBe(true);
  });
  test.each([['', 'empty'], ['has space', 'space'], ['a-b', 'hyphen'], ['x'.repeat(129), 'too long'], [null, 'null'], [42, 'non-string']])(
    'rejects %j (%s)',
    (t) => {
      expect(tokenValid(t)).toBe(false);
    },
  );
  test('tokenFromInput pulls the token out of a pasted link', () => {
    expect(tokenFromInput('https://x.y/apply/abc123')).toBe('abc123');
    expect(tokenFromInput('https://x.y/apply/abc123/')).toBe('abc123');
    expect(tokenFromInput('abc123')).toBe('abc123');
    expect(tokenFromInput('  abc123  ')).toBe('abc123');
    expect(tokenFromInput('')).toBe('');
  });
});

describe('normalizeReqTitle', () => {
  test('trims and keeps a non-empty title', () => {
    expect(normalizeReqTitle('  Senior Backend Engineer  ')).toBe('Senior Backend Engineer');
  });
  test('clips to MAX_TITLE', () => {
    expect(normalizeReqTitle('x'.repeat(MAX_TITLE + 50)).length).toBe(MAX_TITLE);
  });
  test.each([['', 'empty'], ['   ', 'whitespace'], [null, 'null'], [99, 'non-string']])(
    'rejects %j (%s) → null',
    (t) => {
      expect(normalizeReqTitle(t)).toBeNull();
    },
  );
});

describe('pickPublicReq (no-PII redaction guard)', () => {
  test('keeps only the allowlisted public fields', () => {
    const out = pickPublicReq({
      title: 'Backend Engineer',
      role_family: 'backend',
      company_label: 'Acme',
      is_open: true,
      created_at: '2026-06-26',
      // none of these may survive:
      id: 'REQ-UUID',
      owner_id: 'SECRET-OWNER-UUID',
      public_token: 'tok',
      updated_at: 'x',
    });
    expect(Object.keys(out).sort()).toEqual([...PUBLIC_REQ_KEYS].sort());
    expect(out).not.toHaveProperty('owner_id');
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('public_token');
  });
  test('does not invent keys for absent fields', () => {
    expect(pickPublicReq({ title: 'X' })).toEqual({ title: 'X' });
  });
  test('non-object → {}', () => {
    expect(pickPublicReq(null)).toEqual({});
    expect(pickPublicReq(undefined)).toEqual({});
  });
});

describe('buildApplicationInsert (server-authoritative columns guard — the 061 lesson)', () => {
  test('emits ONLY the candidate-ownable base columns', () => {
    const out = buildApplicationInsert({
      reqId: 'r', candidateId: 'c', credentialId: 'cred', note: 'hi',
    });
    expect(Object.keys(out).sort()).toEqual([...APPLICATION_INSERT_KEYS].sort());
    expect(out).toEqual({ req_id: 'r', candidate_id: 'c', credential_id: 'cred', note: 'hi' });
  });
  test('NEVER carries client-supplied trust/lifecycle columns even if passed', () => {
    const out = buildApplicationInsert({
      reqId: 'r', candidateId: 'c', credentialId: 'cred', note: 'hi',
      // a hostile client tries to forge these — they must be dropped:
      status: 'accepted',
      accepted_at: '2026-06-26',
      public_token: 'someone-elses-token',
      id: 'forced-id',
    });
    expect(out).not.toHaveProperty('status');
    expect(out).not.toHaveProperty('accepted_at');
    expect(out).not.toHaveProperty('public_token');
    expect(out).not.toHaveProperty('id');
  });
  test('clips an overlong note to MAX_NOTE', () => {
    const out = buildApplicationInsert({ reqId: 'r', candidateId: 'c', credentialId: 'cred', note: 'x'.repeat(MAX_NOTE + 100) });
    expect(out.note.length).toBe(MAX_NOTE);
  });
  test('coerces a non-string note to null', () => {
    expect(buildApplicationInsert({ reqId: 'r', candidateId: 'c', credentialId: 'cred', note: { x: 1 } }).note).toBeNull();
  });
  test('status enum is exactly the four lifecycle states', () => {
    expect(APPLICATION_STATUSES).toEqual(['submitted', 'accepted', 'declined', 'withdrawn']);
  });
});

describe('summarizeReuse (network signal — distinct accepting teams per credential)', () => {
  test('counts DISTINCT accepting accounts per credential', () => {
    const rows = [
      { credential_id: 'A', accepting_account_id: 't1' },
      { credential_id: 'A', accepting_account_id: 't2' },
      { credential_id: 'A', accepting_account_id: 't1' }, // dup team — not double-counted
      { credential_id: 'B', accepting_account_id: 't1' },
    ];
    expect(summarizeReuse(rows, ['A', 'B', 'C'])).toEqual({ A: 2, B: 1, C: 0 });
  });
  test('ignores rows for credentials not in the owned set (isolation)', () => {
    const rows = [{ credential_id: 'X-not-mine', accepting_account_id: 't1' }];
    expect(summarizeReuse(rows, ['A'])).toEqual({ A: 0 });
  });
  test('tolerates empty / malformed input', () => {
    expect(summarizeReuse(null, ['A'])).toEqual({ A: 0 });
    expect(summarizeReuse([{ bad: 1 }, null], ['A'])).toEqual({ A: 0 });
    expect(summarizeReuse([], [])).toEqual({});
  });
});

// ── Migration 072 — candidate-owns-credential RLS + server-authoritative columns ──
// This is THE cross-candidate isolation invariant (the 060/S4-1 P0 lesson, applied to
// applications) + the server-authoritative columns invariant (the 061/S4-1b lesson). The test
// fails loudly if 072 is reverted/weakened.
describe('migration 072 — credential_applications RLS + grants', () => {
  const sql = mig('072_credential_applications.sql');

  test('[candidate-owns-credential] INSERT WITH CHECK requires identity AND credential ownership', () => {
    expect(sql).toMatch(/app_candidate_insert/);
    expect(sql).toMatch(/candidate_id\s*=\s*auth\.uid\(\)/i);
    // the cross-candidate isolation: credential_id must be one of the CALLER's own credentials.
    expect(sql).toMatch(/credential_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+public\.verified_credentials\s+WHERE\s+candidate_id\s*=\s*auth\.uid\(\)/i);
  });

  test('candidate reads/withdraws only their OWN applications', () => {
    expect(sql).toMatch(/app_candidate_select[\s\S]*USING\s*\(candidate_id\s*=\s*auth\.uid\(\)\)/i);
    expect(sql).toMatch(/app_candidate_delete[\s\S]*USING\s*\(candidate_id\s*=\s*auth\.uid\(\)\)/i);
  });

  test('the accepting account sees applications to ITS reqs only', () => {
    expect(sql).toMatch(/app_req_owner_select/);
    expect(sql).toMatch(/req_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+public\.network_reqs\s+WHERE\s+owner_id\s*=\s*auth\.uid\(\)/i);
  });

  test('[server-authoritative] table-level INSERT/UPDATE revoked; only base cols re-granted', () => {
    expect(sql).toMatch(/REVOKE\s+INSERT\s+ON\s+public\.credential_applications\s+FROM\s+authenticated/i);
    expect(sql).toMatch(/REVOKE\s+UPDATE\s+ON\s+public\.credential_applications\s+FROM\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+INSERT\s*\(req_id, candidate_id, credential_id, note\)/i);
    // the trust/lifecycle columns must NEVER appear in a GRANT statement (no client write path).
    // Strip comment lines first so the prose "…and GRANT back…status…" can't false-positive.
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/GRANT[^;]*(status|accepted_at|public_token)/i);
  });

  test('one application per (req, credential) — idempotent re-apply', () => {
    expect(sql).toMatch(/UNIQUE\s*\(req_id,\s*credential_id\)/i);
  });
});

// ── Migration 071 — network_reqs owner-only RLS ──
describe('migration 071 — network_reqs RLS', () => {
  const sql = mig('071_network_reqs.sql');
  test('RLS enabled + owner-scoped policies', () => {
    expect(sql).toMatch(/ALTER TABLE public\.network_reqs ENABLE ROW LEVEL SECURITY/i);
    for (const p of ['req_owner_select', 'req_owner_insert', 'req_owner_update', 'req_owner_delete']) {
      expect(sql).toMatch(new RegExp(p));
    }
    expect(sql).toMatch(/owner_id\s*=\s*auth\.uid\(\)/i);
  });
});

// ── Migration 073 — public-read RPCs are LOCKED (the strict 062 lesson) ──
// SECURITY DEFINER + SET search_path + REVOKE FROM PUBLIC, anon, authenticated + GRANT
// service_role ONLY. A "locked" RPC stays callable by anon unless anon is explicitly revoked.
describe('migration 073 — network RPCs locked to service_role (the 062 lesson)', () => {
  const sql = mig('073_network_rpcs.sql');
  test.each(['get_req(text)', 'get_req_applications(uuid)'])('%s is definer + search_path + service-role-only', (fn) => {
    const name = fn.split('(')[0];
    expect(sql).toMatch(new RegExp(`FUNCTION public\\.${name}`));
    // explicit revoke from PUBLIC, anon AND authenticated (not just PUBLIC):
    expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon, authenticated`, 'i'));
    expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} TO service_role`, 'i'));
  });
  test('every function is SECURITY DEFINER with a pinned search_path', () => {
    const definers = sql.match(/SECURITY DEFINER SET search_path = public/gi) || [];
    expect(definers.length).toBeGreaterThanOrEqual(2);
  });
  test('no grant of these RPCs to anon/authenticated (only service_role)', () => {
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[^;]*TO\s+(anon|authenticated)/i);
  });
});

// ── Migration 074 — additive acceptance→req link + self-acceptance counter-forgery guard ──
describe('migration 074 — acceptance req_id link + self-accept guard', () => {
  const sql = mig('074_acceptance_req_link.sql');
  test('adds a nullable req_id column (IF NOT EXISTS) — no destructive column/table drop, no REVOKE', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS req_id UUID REFERENCES public\.network_reqs/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
  test('[self-accept guard] tightens cred_acceptance_owner_insert to forbid accepting your OWN credential', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS cred_acceptance_owner_insert ON public\.credential_acceptances/i);
    expect(sql).toMatch(/accepting_account_id\s*=\s*auth\.uid\(\)/i);
    // the new clause: accepting_account_id must NOT equal the credential's owner.
    expect(sql).toMatch(/accepting_account_id\s*<>\s*COALESCE\(\s*\(\s*SELECT\s+candidate_id\s+FROM\s+public\.verified_credentials\s+WHERE\s+id\s*=\s*credential_id\s*\)/i);
  });
});

// ── Route source lock — accept reuses the idempotent accept-prior upsert ──
// Accept idempotency is enforced by credential_acceptances' UNIQUE(credential_id,
// accepting_account_id) (058) + the route upserting with that exact onConflict target. The
// behavioral idempotency assertion lives in tests/integration/network.test.js; this locks the
// construction so a refactor can't silently drop the conflict target.
describe('network route — accept reuses the idempotent accept-prior upsert', () => {
  const route = fs.readFileSync(path.join(__dirname, '../../src/routes/supabase/network.js'), 'utf8');
  const accept058 = mig('058_credential_acceptances.sql');
  test('058 declares the per-team uniqueness', () => {
    expect(accept058).toMatch(/UNIQUE\s*\(credential_id,\s*accepting_account_id\)/i);
  });
  test('the accept route upserts on (credential_id, accepting_account_id)', () => {
    expect(route).toMatch(/onConflict:\s*'credential_id,accepting_account_id'/);
  });
  test('the accept route never writes status/accepted_at via the candidate-scoped client', () => {
    // status/accepted_at transitions go through supabaseAdmin (service role) only.
    expect(route).toMatch(/supabaseAdmin[\s\S]*\.update\(\s*\{\s*status:\s*'accepted'/);
  });
  test('[auth-gate] accept gates on network_reqs OWNERSHIP (not the OR-ed application read) + blocks self-accept', () => {
    // The real tenant gate is an RLS-scoped read of network_reqs (owner-only SELECT, 071) —
    // NOT a read of credential_applications (whose SELECT policy is OR-ed with the candidate's
    // own-row policy). Plus an explicit self-acceptance guard. Regression-locks the P1 fix.
    expect(route).toMatch(/from\('network_reqs'\)[\s\S]{0,160}\.eq\('id',\s*app\.req_id\)/);
    expect(route).toMatch(/app\.candidate_id\s*===\s*req\.user\.id/);
  });

  // CF-2 (v3-hardening-2): a REVOKED credential is hidden on every public surface, so the owner
  // dashboard must report reuse_count = 0 for it — never a stale "accepted by N teams" signal.
  test('[CF-2] the /credentials dashboard zeroes reuse_count for a revoked credential', () => {
    expect(route).toMatch(/reuse_count:\s*c\.revoked_at\s*\?\s*0\s*:/);
  });
});
