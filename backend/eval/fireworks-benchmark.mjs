// fireworks-benchmark.mjs — does a Fireworks open model grade like the pinned Azure grader?
// Pulls K already-scored dev submissions, re-grades each with a Fireworks model, computes the
// 0-100 IN CODE (same computeScore the product uses), and reports agreement (MAE, within-5,
// advance/reject decision match) + token cost vs the stored Azure normalized_score.
// Offline eval; nothing is written back. Linear AUT-7.
//
// Usage:
//   FIREWORKS_API_KEY=fw_... [FIREWORKS_GRADER_MODEL=accounts/fireworks/models/gpt-oss-120b] \
//   [K=15] [THRESH=70] node backend/eval/fireworks-benchmark.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { computeScore } = require('../src/services/proofScoringService');
const { gradeWithFireworks, DEFAULT_MODEL } = require('../src/services/fireworksGrader');

const K = parseInt(process.env.K || '15', 10);
const THRESH = parseInt(process.env.THRESH || '70', 10);
const MODEL = process.env.FIREWORKS_GRADER_MODEL || DEFAULT_MODEL;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (load backend/.env).'); process.exit(1); }
if (!process.env.FIREWORKS_API_KEY) { console.error('Missing FIREWORKS_API_KEY.'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

// Live (non-superseded) Azure scores, newest first — these are the reference labels.
const { data: scores, error } = await sb.from('proof_scores')
  .select('submission_id, normalized_score, rubric_version')
  .is('superseded_by', null)
  .not('normalized_score', 'is', null)
  .order('created_at', { ascending: false })
  .limit(K * 4);
if (error) throw new Error(error.message);

const rows = [];
for (const s of scores || []) {
  if (rows.length >= K) break;
  const { data: sub } = await sb.from('work_sample_submissions')
    .select('id, response_text, response_code, work_sample_id').eq('id', s.submission_id).single();
  if (!sub) continue;
  const resp = String(sub.response_text || sub.response_code || '');
  if (resp.length < 20) continue; // skip empty/smoke submissions
  const { data: ws } = await sb.from('work_samples').select('rubric').eq('id', sub.work_sample_id).single();
  if (!ws || !ws.rubric || !(ws.rubric.criteria || []).length) continue;
  rows.push({ id: s.submission_id, azure: Number(s.normalized_score), rubric: ws.rubric, resp });
}

if (!rows.length) { console.log('No scored submissions with a rubric + response found on dev. Nothing to benchmark.'); process.exit(0); }
console.log(`Benchmarking ${rows.length} scored submissions: Fireworks ${MODEL} vs stored Azure grader (decision @${THRESH})\n`);

const absErrs = [];
let within5 = 0, decisionMatch = 0, totIn = 0, totOut = 0, graded = 0;
for (const r of rows) {
  try {
    const { grade, usage } = await gradeWithFireworks(r.rubric, r.resp, { model: MODEL });
    totIn += usage.prompt_tokens || 0;
    totOut += usage.completion_tokens || 0;
    if (!grade) { console.log(`  ${r.id.slice(0, 8)}  fireworks=INVALID_JSON   azure=${r.azure}`); continue; }
    const { normalized } = computeScore(r.rubric, grade.per_criterion);
    graded++;
    const err = Math.abs(normalized - r.azure);
    absErrs.push(err);
    if (err <= 5) within5++;
    if ((normalized >= THRESH) === (r.azure >= THRESH)) decisionMatch++;
    console.log(`  ${r.id.slice(0, 8)}  fireworks=${String(normalized).padStart(3)}  azure=${String(r.azure).padStart(3)}  Δ=${err}`);
  } catch (e) {
    console.log(`  ${r.id.slice(0, 8)}  ERROR ${String(e.message).slice(0, 70)}`);
  }
}

const mae = absErrs.length ? (absErrs.reduce((a, b) => a + b, 0) / absErrs.length).toFixed(1) : 'n/a';
console.log(`\n=== ${MODEL} vs Azure gpt-5.4-mini (n=${graded}) ===`);
console.log(`MAE (0-100):                 ${mae}`);
console.log(`within 5 pts:                ${graded ? Math.round((100 * within5) / graded) : 0}%`);
console.log(`advance/reject agreement:    ${graded ? Math.round((100 * decisionMatch) / graded) : 0}%  (@ threshold ${THRESH})`);
console.log(`tokens:                      ${totIn} in / ${totOut} out`);
console.log(`\nNote: Azure is the reference, not ground truth. High agreement = the open model grades like gpt-5.4-mini; a real human-agreement number needs the gold set (scoring-eval export).`);
process.exit(0);
