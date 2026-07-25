/**
 * Right-to-erasure for RECRUITER / MIXED-ROLE accounts (the ones erase_candidate refuses).
 * Calls the transactional RPC public.erase_account (migration 110) with service-role creds,
 * prints the structured result, and on success mirrors the erase_candidate auth handling:
 * hard -> auth.admin.deleteUser, anonymized -> tombstone the auth email + ban sign-in.
 *
 *   node scripts/erase-account.mjs <email|uid> [--mode strict|detach] [--yes]
 *
 * Without --yes it only resolves and prints the target account, then exits (dry run).
 * --mode strict (default) refuses if the account owns screens with other users' submissions;
 * --mode detach keeps that third-party evidence and anonymizes screen ownership instead.
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from backend/.env.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import core from './lib/erase-account-core.js';

const { parseArgs, resolveTarget, collectArchivePaths, eraseAccount } = core;

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = (() => {
  const out = {};
  try {
    for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return { ...out, ...process.env };
})();

const parsed = parseArgs(process.argv.slice(2));
if (parsed.error) { console.error(parsed.error); process.exit(2); }

const SUPABASE_URL = env.SUPABASE_URL, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) { console.error('Missing Supabase env'); process.exit(2); }
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const resolved = await resolveTarget(admin, parsed.target);
if (resolved.error) { console.error(resolved.error); process.exit(1); }

console.log('Target account:', JSON.stringify(resolved.profile, null, 2));
if (!parsed.yes) {
  console.log(`\nDry run (mode: ${parsed.mode}). Re-run with --yes to erase. THIS IS ONE-WAY.`);
  process.exit(0);
}

// Collected pre-RPC because the rows are gone afterwards (ADR-002). Archiving is flag-OFF on
// dev; if it was ever enabled for this tenant these blobs must be deleted from Azure manually.
const archivePaths = await collectArchivePaths(admin, resolved.uid);

const outcome = await eraseAccount(admin, { uid: resolved.uid, mode: parsed.mode });
console.log('\nRPC result:', JSON.stringify(outcome.result ?? { rpcError: outcome.rpcError }, null, 2));
if (!outcome.ok) process.exit(1);

console.log(`Auth: ${outcome.authAction} ${outcome.authError ? `FAILED: ${outcome.authError}` : 'ok'}`);
if (archivePaths.length) {
  console.log('\nPossible archived bundles (ADR-002); verify/delete manually if archiving was ever on:');
  for (const p of archivePaths) console.log(`  ${p}`);
}
process.exit(outcome.authError ? 1 : 0);
