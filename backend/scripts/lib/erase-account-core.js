/**
 * Core logic for scripts/erase-account.mjs, kept in CommonJS so the jest suite
 * (tests/unit/eraseAccountScript.spec.js) can exercise it without ESM plumbing.
 * The .mjs entrypoint owns env loading, client construction and process.exit.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// argv: everything after `node scripts/erase-account.mjs`.
// Returns { target, mode, yes } or { error }.
function parseArgs(argv) {
  const args = [...argv];
  let target = null;
  let mode = 'strict';
  let yes = false;
  while (args.length) {
    const a = args.shift();
    if (a === '--yes') { yes = true; continue; }
    if (a === '--mode') {
      mode = args.shift();
      if (mode !== 'strict' && mode !== 'detach') return { error: `invalid --mode "${mode}" (strict | detach)` };
      continue;
    }
    if (a.startsWith('--')) return { error: `unknown flag ${a}` };
    if (target) return { error: 'exactly one <email|uid> target expected' };
    target = a;
  }
  if (!target) return { error: 'usage: node scripts/erase-account.mjs <email|uid> [--mode strict|detach] [--yes]' };
  return { target, mode, yes };
}

// Resolve an email or uuid to { uid, profile } via the profiles table.
// A uuid with no profile row still resolves (the RPC reports not_found itself).
async function resolveTarget(admin, target) {
  const byId = UUID_RE.test(target);
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, account_type, first_name, last_name')
    .eq(byId ? 'id' : 'email', target)
    .maybeSingle();
  if (error) return { error: `profile lookup failed: ${error.message}` };
  if (!data && !byId) return { error: `no profile with email ${target}` };
  return { uid: byId ? target : data.id, profile: data };
}

// ADR-002: archived assessment bundles live at tenants/{ownerId}/submissions/{submissionId}.json
// and become unfindable once the rows are gone, so collect the candidate paths BEFORE the RPC
// (mirrors POST /api/portal/delete-account). Best-effort: lookup errors return [].
async function collectArchivePaths(admin, uid) {
  const paths = [];
  const { data: asOwner } = await admin
    .from('work_sample_submissions')
    .select('id, work_samples!inner ( owner_id )')
    .eq('work_samples.owner_id', uid);
  for (const s of asOwner || []) paths.push(`tenants/${uid}/submissions/${s.id}.json`);
  const { data: asCandidate } = await admin
    .from('work_sample_submissions')
    .select('id, work_samples ( owner_id )')
    .eq('candidate_id', uid);
  for (const s of asCandidate || []) {
    const owner = s.work_samples && s.work_samples.owner_id;
    if (owner && owner !== uid) paths.push(`tenants/${owner}/submissions/${s.id}.json`);
  }
  return paths;
}

// Call the RPC and, on success, mirror the erase_candidate auth handling (portal.js):
// hard -> delete the auth user; anonymized -> tombstone the email + ban sign-in.
async function eraseAccount(admin, { uid, mode }) {
  const { data: result, error } = await admin.rpc('erase_account', { p_uid: uid, p_mode: mode });
  if (error) return { ok: false, rpcError: error.message };
  if (!result || result.ok !== true) return { ok: false, result };

  let authAction = null;
  let authError = null;
  if (result.mode === 'hard') {
    authAction = 'deleteUser';
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) authError = delErr.message;
  } else {
    authAction = 'banUser';
    // supabase-js GoTrue admin methods resolve with { error } instead of throwing, so the failure
    // must be destructured (matching the deleteUser branch above). A thrown try/catch would never
    // fire, leaving authError null and reporting a failed erasure as success.
    const { error: banErr } = await admin.auth.admin.updateUserById(uid, {
      email: `deleted-${uid}@deleted.invalid`, user_metadata: {}, ban_duration: '876000h',
    });
    if (banErr) authError = banErr.message;
  }
  return { ok: true, result, authAction, authError };
}

module.exports = { parseArgs, resolveTarget, collectArchivePaths, eraseAccount };
