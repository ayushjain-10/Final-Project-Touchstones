/**
 * Seed the GLOBAL PUBLIC LIBRARY of verified assessment templates.
 *
 * Upserts each assessment in scripts/library-assessments.json into
 * public.assessment_templates with is_public=true (the shared, read-only library
 * that every recruiter can browse and clone). Idempotent: a public template whose
 * title already exists is left untouched, so re-running only fills gaps.
 *
 *   DOTENV_CONFIG_PATH=.env node -r dotenv/config scripts/seed-public-templates.mjs
 *   # or simply (reads backend/.env directly, like scripts/score-on-dev.mjs):
 *   node scripts/seed-public-templates.mjs
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment (falling back
 * to backend/.env). Uses the service-role client because library rows are owned by
 * no recruiter (created_by = null, org_id = null), matching the existing seeds.
 *
 * Field mapping (library JSON -> assessment_templates):
 *   title            -> title
 *   role_family      -> position
 *   first sentence   -> summary
 *   prompt_md        -> prompt_md
 *   starter_files    -> starter_files
 *   languages        -> languages
 *   rubric           -> rubric
 *   duration_minutes -> time_limit_min
 *   tests            -> tests   (only when it carries auto-grading cases; else null)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Env: prefer process.env, fall back to backend/.env (same loader as score-on-dev.mjs).
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

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env / backend/.env');
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

// Derive a short human summary from the prompt: strip fences/markdown, take the
// first sentence, and cap the length so the library cards stay tidy.
function firstSentence(md) {
  const text = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')   // drop fenced code blocks
    .replace(/^[>#\s]+/gm, '')          // strip leading blockquote/heading markers
    .replace(/[*_`>#]/g, '')            // strip inline markdown
    .replace(/\s+/g, ' ')               // collapse whitespace
    .trim();
  const m = text.match(/^(.*?[.!?])(\s|$)/);
  let s = (m ? m[1] : text).trim();
  if (s.length > 200) s = s.slice(0, 197).trimEnd() + '...';
  return s || 'Verified assessment from the Touchstones library.';
}

// A template carries auto-grading only when tests is an object with a non-empty
// cases[] (the markdown design task ships tests: [], which we store as null).
function testsOrNull(tests) {
  return tests && !Array.isArray(tests) && Array.isArray(tests.cases) && tests.cases.length ? tests : null;
}

async function main() {
  const library = JSON.parse(readFileSync(join(__dirname, 'library-assessments.json'), 'utf8'));

  // Existing public titles -> skip set (idempotency).
  const { data: existing, error: exErr } = await admin
    .from('assessment_templates').select('title').eq('is_public', true);
  if (exErr) { console.error('Failed to read existing templates:', exErr.message); process.exit(1); }
  const have = new Set((existing || []).map((r) => r.title));

  let inserted = 0, skipped = 0;
  for (const a of library) {
    if (have.has(a.title)) {
      console.log(`skip  (exists): ${a.title}`);
      skipped++;
      continue;
    }
    const row = {
      position: a.role_family,
      title: a.title,
      summary: firstSentence(a.prompt_md),
      prompt_md: a.prompt_md,
      starter_files: Array.isArray(a.starter_files) ? a.starter_files : [],
      languages: Array.isArray(a.languages) ? a.languages : [],
      rubric: a.rubric,
      time_limit_min: a.duration_minutes ?? null,
      tests: testsOrNull(a.tests),
      is_public: true,
      created_by: null,   // library rows are owned by no recruiter (matches existing seeds)
      org_id: null,
    };
    const { error } = await admin.from('assessment_templates').insert(row);
    if (error) { console.error(`FAILED insert: ${a.title}\n  ${error.message}`); process.exit(1); }
    console.log(`insert: ${a.title}`);
    inserted++;
  }

  const { count, error: cErr } = await admin
    .from('assessment_templates').select('id', { count: 'exact', head: true }).eq('is_public', true);
  if (cErr) { console.error('Count failed:', cErr.message); process.exit(1); }
  console.log(`\nDone. inserted=${inserted} skipped=${skipped} | is_public=true total=${count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
