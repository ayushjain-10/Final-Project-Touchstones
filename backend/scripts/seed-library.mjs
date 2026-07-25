/**
 * Seed the verified Touchstones assessment library into the `work_samples` table.
 *
 * Reads ./library-assessments.json (the verified library) and inserts each entry
 * as a published, founder-owned work_sample that is immediately assignable and
 * auto-graded. Idempotent: an entry whose (title, owner_id) already exists is
 * skipped, so re-running never creates duplicates.
 *
 * Env (required):
 *   SUPABASE_URL               your project URL
 *   SUPABASE_SERVICE_ROLE_KEY  service-role key (bypasses RLS; keep it secret)
 *
 * Usage:
 *   node scripts/seed-library.mjs <owner_uuid>
 *
 * where <owner_uuid> is the profiles.id that will own the seeded work_samples.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const ownerId = process.argv[2];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!ownerId || !UUID_RE.test(ownerId)) {
  console.error('Usage: node scripts/seed-library.mjs <owner_uuid>');
  process.exit(1);
}

const library = JSON.parse(readFileSync(join(__dirname, 'library-assessments.json'), 'utf8'));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let inserted = 0;
let skipped = 0;

for (const a of library) {
  // Idempotency: skip if this owner already has a work_sample with this title.
  const { data: existing, error: selErr } = await supabase
    .from('work_samples')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('title', a.title)
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(`lookup "${a.title}": ${selErr.message}`);

  if (existing) {
    skipped++;
    console.log(`  = skip (exists) ${a.title}`);
    continue;
  }

  const row = {
    owner_id: ownerId,
    title: a.title,
    role_family: a.role_family,
    prompt_md: a.prompt_md,
    response_type: a.response_type,
    language: Array.isArray(a.languages) && a.languages.length ? a.languages[0] : null,
    languages: a.languages,
    duration_minutes: a.duration_minutes,
    rubric: a.rubric,
    rubric_version: 1,
    scoring_strategy: 'weighted_sum',
    prompt_version: 1,
    starter_files: a.starter_files,
    tests: a.tests,
    status: 'published',
  };

  const { error: insErr } = await supabase.from('work_samples').insert(row);
  if (insErr) throw new Error(`insert "${a.title}": ${insErr.message}`);
  inserted++;
  console.log(`  + insert ${a.title} [${a.role_family}/${a.difficulty}/${a.response_type}]`);
}

console.log(`\nDone. ${inserted} inserted, ${skipped} skipped (already present). Owner: ${ownerId}`);
