/**
 * Unit tests for the Verify API key service (src/services/apiKeyService.js).
 * Env-independent + PURE → runs in CI, never touches a real Supabase server.
 *
 * Covers: key format (tsk_<mode>_<base62>), hash/verify round-trip, mintAccountJwt claims
 * (decoded + asserted), the null-when-secret-unset contract, and apiTenantDb branch
 * selection (RLS-scoped client vs supabaseAdmin fallback).
 */

// Mock the supabase config so apiTenantDb's branches are observable without a real client.
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { __id: 'ADMIN' },
  createAuthenticatedClient: jest.fn((token) => ({ __id: 'SCOPED', token })),
}));

const crypto = require('crypto');
const { createAuthenticatedClient, supabaseAdmin } = require('../../src/config/supabase');
const {
  generateKey,
  hashKey,
  verifyKey,
  modeFromKey,
  mintAccountJwt,
  apiTenantDb,
} = require('../../src/services/apiKeyService');

// base64url → JSON decode helper for asserting JWT segments.
const decodeSegment = (seg) => JSON.parse(
  Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
);

const SAVED_SECRET = process.env.SUPABASE_JWT_SECRET;
afterEach(() => {
  if (SAVED_SECRET === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = SAVED_SECRET;
  jest.clearAllMocks();
});

describe('generateKey', () => {
  test("produces tsk_<mode>_<base62> for live and test", () => {
    for (const mode of ['live', 'test']) {
      const { plaintext, prefix, last4 } = generateKey(mode);
      expect(plaintext.startsWith(`tsk_${mode}_`)).toBe(true);
      // secret body is base62 only and non-trivially long (>=32 bytes → ~43 base62 chars).
      const body = plaintext.slice(`tsk_${mode}_`.length);
      expect(body).toMatch(/^[0-9A-Za-z]+$/);
      expect(body.length).toBeGreaterThanOrEqual(40);
      expect(prefix).toBe(plaintext.slice(0, 12));
      expect(last4).toBe(plaintext.slice(-4));
    }
  });

  test('keys are unique across calls (CSPRNG)', () => {
    const keys = new Set();
    for (let i = 0; i < 50; i++) keys.add(generateKey('live').plaintext);
    expect(keys.size).toBe(50);
  });

  test('rejects an invalid mode', () => {
    expect(() => generateKey('admin')).toThrow();
    expect(() => generateKey('')).toThrow();
  });

  test('modeFromKey parses the prefix', () => {
    expect(modeFromKey('tsk_live_abc')).toBe('live');
    expect(modeFromKey('tsk_test_abc')).toBe('test');
    expect(modeFromKey('nope')).toBe(null);
    expect(modeFromKey('')).toBe(null);
  });
});

describe('hashKey / verifyKey', () => {
  test('hashKey is sha256 hex of the plaintext', () => {
    const { plaintext } = generateKey('test');
    const expected = crypto.createHash('sha256').update(plaintext).digest('hex');
    expect(hashKey(plaintext)).toBe(expected);
    expect(hashKey(plaintext)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('verifyKey accepts the matching plaintext and rejects others', () => {
    const { plaintext } = generateKey('live');
    const stored = hashKey(plaintext);
    expect(verifyKey(plaintext, stored)).toBe(true);
    expect(verifyKey(plaintext + 'x', stored)).toBe(false);
    expect(verifyKey('tsk_live_other', stored)).toBe(false);
    expect(verifyKey('', stored)).toBe(false);
    expect(verifyKey(plaintext, '')).toBe(false);
    expect(verifyKey(plaintext, 'not-hex-zz')).toBe(false);
  });
});

describe('mintAccountJwt', () => {
  const ACCOUNT = '11111111-1111-1111-1111-111111111111';

  test('returns null when SUPABASE_JWT_SECRET is unset', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    expect(mintAccountJwt(ACCOUNT)).toBe(null);
  });

  test('builds an HS256 JWT with the expected header + claims', () => {
    process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-value';
    const token = mintAccountJwt(ACCOUNT);
    expect(typeof token).toBe('string');
    const [h, p, sig] = token.split('.');
    expect(h && p && sig).toBeTruthy();

    const header = decodeSegment(h);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });

    const claims = decodeSegment(p);
    expect(claims.sub).toBe(ACCOUNT);
    expect(claims.role).toBe('authenticated');
    expect(claims.aud).toBe('authenticated');
    expect(typeof claims.iat).toBe('number');
    expect(claims.exp).toBe(claims.iat + 300);
  });

  test('signature verifies against the secret (HMAC-SHA256, base64url)', () => {
    process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-value';
    const token = mintAccountJwt(ACCOUNT);
    const [h, p, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', 'super-secret-jwt-value')
      .update(`${h}.${p}`)
      .digest('base64')
      .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(sig).toBe(expected);
  });
});

describe('apiTenantDb', () => {
  const ACCOUNT = '22222222-2222-2222-2222-222222222222';

  test('falls back to supabaseAdmin when SUPABASE_JWT_SECRET is unset', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const db = apiTenantDb(ACCOUNT);
    expect(db).toBe(supabaseAdmin);
    expect(createAuthenticatedClient).not.toHaveBeenCalled();
  });

  test('returns an RLS-scoped client built from the minted JWT when the secret is set', () => {
    process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-value';
    const db = apiTenantDb(ACCOUNT);
    expect(createAuthenticatedClient).toHaveBeenCalledTimes(1);
    const passedToken = createAuthenticatedClient.mock.calls[0][0];
    // The token's sub claim must be the account → genuinely account-scoped.
    const claims = decodeSegment(passedToken.split('.')[1]);
    expect(claims.sub).toBe(ACCOUNT);
    expect(db.__id).toBe('SCOPED');
  });
});
