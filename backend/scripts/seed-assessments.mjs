/**
 * Seed the 10 real assessments into BOTH:
 *   - assessment_templates (the public LIBRARY — "our assessments" recruiters use/clone/modify), and
 *   - work_samples (concrete, founder-owned, published — immediately assignable + auto-graded),
 * each carrying the structured per-case `tests` contract (3 visible samples, 7 hidden).
 *
 * Idempotent: matches existing rows by title (+ owner / is_public) and UPDATES them, so re-running
 * refreshes content without creating duplicates. Run AFTER `node scripts/verify-cases.mjs` passes.
 *
 *   node scripts/seed-assessments.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* fall through */ }
  return { ...out, ...process.env };
}
const env = loadEnv();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FOUNDER = 'a9195975-9823-4387-86ca-812ce6d48dd0';

const assessments = (await import('./assessments/index.mjs')).default;

function testsBlob(a) {
  return { kind: 'cases', language: a.language, entry_file: a.entry_file, entry_fn: a.entry_fn, timeout_ms: 15000, cases: a.cases };
}
function starterFiles(a) {
  return [{ path: a.entry_file, content: a.starter, language: a.language }];
}
function summary(a) {
  const visible = a.cases.filter((c) => c.visible).length;
  return `${a.cases.length} auto-graded test cases (${visible} sample, ${a.cases.length - visible} hidden) · ${a.language}`;
}

let tplIns = 0, tplUpd = 0, wsIns = 0, wsUpd = 0;

for (const a of assessments) {
  const tests = testsBlob(a);
  const sf = starterFiles(a);

  // 1) Public library template ("our assessments").
  const tplRow = {
    position: a.role_family, title: a.title, summary: summary(a), prompt_md: a.prompt_md,
    starter_files: sf, languages: [a.language], rubric: a.rubric,
    time_limit_min: a.duration_minutes, tests, is_public: true, created_by: null,
  };
  const { data: tplEx } = await admin.from('assessment_templates')
    .select('id').eq('is_public', true).eq('title', a.title).limit(1).maybeSingle();
  if (tplEx) {
    const { error } = await admin.from('assessment_templates').update(tplRow).eq('id', tplEx.id);
    if (error) throw new Error(`template update ${a.slug}: ${error.message}`);
    tplUpd++;
  } else {
    const { error } = await admin.from('assessment_templates').insert(tplRow);
    if (error) throw new Error(`template insert ${a.slug}: ${error.message}`);
    tplIns++;
  }

  // 2) Concrete, founder-owned, published work_sample (assignable + auto-graded now).
  const wsRow = {
    owner_id: FOUNDER, title: a.title, prompt_md: a.prompt_md, rubric: a.rubric,
    role_family: a.role_family, response_type: 'code', duration_minutes: a.duration_minutes,
    language: a.language, starter_files: sf, languages: [a.language], tests, status: 'published',
  };
  const { data: wsEx } = await admin.from('work_samples')
    .select('id').eq('owner_id', FOUNDER).eq('title', a.title).limit(1).maybeSingle();
  if (wsEx) {
    const { error } = await admin.from('work_samples').update(wsRow).eq('id', wsEx.id);
    if (error) throw new Error(`work_sample update ${a.slug}: ${error.message}`);
    wsUpd++;
  } else {
    const { error } = await admin.from('work_samples').insert(wsRow);
    if (error) throw new Error(`work_sample insert ${a.slug}: ${error.message}`);
    wsIns++;
  }
  console.log(`  ✓ ${a.slug} [${a.role_family}/${a.language}]`);
}

console.log(`\nLibrary templates: ${tplIns} inserted, ${tplUpd} updated`);
console.log(`Work samples:      ${wsIns} inserted, ${wsUpd} updated`);
console.log('Done.\n');
