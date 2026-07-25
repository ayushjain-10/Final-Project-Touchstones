/**
 * scripts/erase-account.mjs core logic (scripts/lib/erase-account-core.js): argument handling,
 * email/uid resolution, and the RPC -> auth.admin follow-up that mirrors the erase_candidate
 * flow (hard -> deleteUser, anonymized -> tombstone + ban). The RPC itself (erase_account,
 * migration 110) is pure SQL and is exercised against the live dev DB, not here.
 */
const { parseArgs, resolveTarget, eraseAccount } = require('../../scripts/lib/erase-account-core');

const UID = '11111111-2222-3333-4444-555555555555';

describe('parseArgs', () => {
  test('requires a target', () => {
    expect(parseArgs([]).error).toMatch(/usage/);
  });

  test('defaults to strict mode, no --yes', () => {
    expect(parseArgs(['a@b.co'])).toEqual({ target: 'a@b.co', mode: 'strict', yes: false });
  });

  test('parses --mode detach and --yes in any order', () => {
    expect(parseArgs(['--yes', UID, '--mode', 'detach'])).toEqual({ target: UID, mode: 'detach', yes: true });
  });

  test('rejects an invalid mode', () => {
    expect(parseArgs(['a@b.co', '--mode', 'nuke']).error).toMatch(/invalid --mode/);
  });

  test('rejects unknown flags and extra targets', () => {
    expect(parseArgs(['a@b.co', '--force']).error).toMatch(/unknown flag/);
    expect(parseArgs(['a@b.co', 'c@d.co']).error).toMatch(/exactly one/);
  });
});

describe('resolveTarget', () => {
  const adminWithProfile = (row, error = null) => ({
    from: () => ({ select: () => ({ eq: (col, val) => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
  });

  test('resolves an email to its profile id', async () => {
    const out = await resolveTarget(adminWithProfile({ id: UID, email: 'a@b.co' }), 'a@b.co');
    expect(out).toEqual({ uid: UID, profile: { id: UID, email: 'a@b.co' } });
  });

  test('errors when the email has no profile', async () => {
    const out = await resolveTarget(adminWithProfile(null), 'ghost@b.co');
    expect(out.error).toMatch(/no profile/);
  });

  test('a uuid resolves even without a profile row (the RPC reports not_found)', async () => {
    const out = await resolveTarget(adminWithProfile(null), UID);
    expect(out.uid).toBe(UID);
  });

  test('surfaces lookup errors', async () => {
    const out = await resolveTarget(adminWithProfile(null, { message: 'boom' }), 'a@b.co');
    expect(out.error).toMatch(/boom/);
  });
});

describe('eraseAccount', () => {
  const mockAdmin = (rpcResponse) => ({
    rpc: jest.fn(async () => rpcResponse),
    auth: {
      admin: {
        deleteUser: jest.fn(async () => ({ error: null })),
        updateUserById: jest.fn(async () => ({ data: {}, error: null })),
      },
    },
  });

  test('passes uid and mode to the RPC', async () => {
    const admin = mockAdmin({ data: { ok: true, mode: 'hard' }, error: null });
    await eraseAccount(admin, { uid: UID, mode: 'detach' });
    expect(admin.rpc).toHaveBeenCalledWith('erase_account', { p_uid: UID, p_mode: 'detach' });
  });

  test('a structured refusal never touches auth', async () => {
    const refusal = { ok: false, reason: 'third_party_evidence', blocking_work_samples: ['ws-1'] };
    const admin = mockAdmin({ data: refusal, error: null });
    const out = await eraseAccount(admin, { uid: UID, mode: 'strict' });
    expect(out).toEqual({ ok: false, result: refusal });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  test('an RPC error never touches auth', async () => {
    const admin = mockAdmin({ data: null, error: { message: 'db down' } });
    const out = await eraseAccount(admin, { uid: UID, mode: 'strict' });
    expect(out).toEqual({ ok: false, rpcError: 'db down' });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  test('hard mode deletes the auth user', async () => {
    const admin = mockAdmin({ data: { ok: true, mode: 'hard', detached_work_samples: [] }, error: null });
    const out = await eraseAccount(admin, { uid: UID, mode: 'strict' });
    expect(out.ok).toBe(true);
    expect(out.authAction).toBe('deleteUser');
    expect(out.authError).toBeNull();
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(UID);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  test('anonymized mode tombstones the auth identity and bans sign-in', async () => {
    const admin = mockAdmin({ data: { ok: true, mode: 'anonymized', detached_work_samples: ['ws-1'] }, error: null });
    const out = await eraseAccount(admin, { uid: UID, mode: 'detach' });
    expect(out.ok).toBe(true);
    expect(out.authAction).toBe('banUser');
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(UID, {
      email: `deleted-${UID}@deleted.invalid`, user_metadata: {}, ban_duration: '876000h',
    });
  });

  test('a failed auth delete is reported, not swallowed', async () => {
    const admin = mockAdmin({ data: { ok: true, mode: 'hard' }, error: null });
    admin.auth.admin.deleteUser = jest.fn(async () => ({ error: { message: 'auth 500' } }));
    const out = await eraseAccount(admin, { uid: UID, mode: 'strict' });
    expect(out.ok).toBe(true);
    expect(out.authError).toBe('auth 500');
  });
});
