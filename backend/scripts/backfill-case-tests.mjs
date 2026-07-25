/**
 * backfill-case-tests.mjs — execution-ground existing CODE screens (DEV ONLY).
 * ---------------------------------------------------------------------------
 * For each work_samples row with response_type='code', generate a VALIDATED {kind:'cases'} tests
 * object + a reference solution via testGenerationService, and (only with --apply) persist
 * `tests` + `reference_solution` (migration 098). Dry-run by default: generates + validates but
 * writes NOTHING, so you can inspect quality first. Idempotent: skips screens already
 * {kind:'cases'} WITH a reference_solution.
 *
 * Safety: HARD-REFUSES any Supabase project that is not the known dev ref (prod is frozen), and
 * only writes behind --apply. Prioritizes python/js case-screens + genuine screens over demo/smoke.
 *
 * Usage:
 *   node backend/scripts/backfill-case-tests.mjs                    # dry-run, first BACKFILL_LIMIT
 *   BACKFILL_LIMIT=93 node backend/scripts/backfill-case-tests.mjs  # dry-run over all
 *   node backend/scripts/backfill-case-tests.mjs --apply            # WRITE to dev
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { generateValidatedTests } = require('../src/services/testGenerationService');

const DEV_REF = 'cjxgjqfdfdstdfxhtaho'; // the ONLY project this script may touch (prod is frozen)
const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(process.env.BACKFILL_LIMIT || '8', 10);

const isDemo = (t) => /smoke|demo|verification|sample|\[demo\]|add\(|poll|grader|llmobs|fix verify/i.test(t || '');
const alreadyGrounded = (ws) => ws.tests && ws.tests.kind === 'cases' && ws.reference_solution;
const short = (s, n = 46) => String(s || '').slice(0, n);

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (load backend/.env).');
    process.exit(1);
  }
  if (!url.includes(DEV_REF)) {
    console.error(`REFUSING: SUPABASE_URL is not the dev project (${DEV_REF}). Prod is frozen.`);
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: screens, error } = await sb
    .from('work_samples')
    .select('id, title, prompt_md, rubric, language, languages, starter_files, response_type, tests, reference_solution, status')
    .eq('response_type', 'code')
    .neq('status', 'archived');
  if (error) throw new Error(error.message);

  // Skip smoke/demo/verification screens by default (waste of calls); ground genuine ones first.
  const INCLUDE_DEMO = process.argv.includes('--include-demo');
  const ranked = screens
    .filter((ws) => INCLUDE_DEMO || !isDemo(ws.title))
    .map((ws) => ({ ws, pri: ws.tests && ws.tests.kind === 'cases' ? 0 : 1 }))
    .sort((a, b) => a.pri - b.pri)
    .map((r) => r.ws);
  const batch = ranked.slice(0, LIMIT);

  console.log(`${APPLY ? 'APPLY (WRITING)' : 'DRY-RUN (no writes)'} — ${batch.length} of ${screens.length} code screens (BACKFILL_LIMIT=${LIMIT})\n`);

  const stat = { processed: 0, grounded: 0, skipped_existing: 0, demoted: 0, failed: 0, written: 0 };
  for (const ws of batch) {
    if (alreadyGrounded(ws)) {
      stat.skipped_existing += 1;
      console.log(`  SKIP  ${ws.id.slice(0, 8)}  "${short(ws.title)}"  (already grounded)`);
      continue;
    }
    stat.processed += 1;
    let r;
    try {
      r = await generateValidatedTests({ prompt_md: ws.prompt_md, rubric: ws.rubric, language: ws.language || (ws.languages && ws.languages[0]) });
    } catch (e) {
      stat.failed += 1;
      console.log(`  FAIL  ${ws.id.slice(0, 8)}  "${short(ws.title, 40)}"  ${e.message}`);
      continue;
    }

    if (r.tests.kind !== 'cases') {
      stat.demoted += 1;
      console.log(`  none  ${ws.id.slice(0, 8)}  "${short(ws.title, 38)}"  reason=${r.stats.reason}`);
      continue;
    }
    stat.grounded += 1;
    console.log(
      `  OK    ${ws.id.slice(0, 8)}  "${short(ws.title, 34)}"  ${r.tests.language} entry=${r.tests.entry_fn}  kept ${r.stats.kept}/${r.stats.generated} (pruned ${r.stats.pruned})`,
    );

    if (APPLY) {
      const { error: eW } = await sb
        .from('work_samples')
        .update({ tests: r.tests, reference_solution: r.reference_solution, updated_at: new Date().toISOString() })
        .eq('id', ws.id);
      if (eW) console.log(`        write FAILED: ${eW.message}`);
      else stat.written += 1;
    }
  }

  console.log('\n' + JSON.stringify(stat, null, 2));
  if (!APPLY) console.log('\nDry-run only — nothing written. Re-run with --apply to persist (BACKFILL_LIMIT=93 for all).');
  console.log('NOTE: for screens that already had authored inline cases, this REGENERATES cases from the prompt (validated against a fresh reference). Say so if you want a "keep authored cases, add reference only" mode.');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
