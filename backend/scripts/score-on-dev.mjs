/**
 * Trigger ONE real grader run on a deployed backend to light up Datadog LLM Observability.
 * Unlike smoke-e2e.mjs (which synthesizes the score), this drives the REAL scoring endpoint
 * POST /api/proof/submissions/:id/score -> proofScoringService.scoreSubmission -> the Azure grader
 * (N=3 self-consistency), producing 3 `grader.chat` llm spans + a `proof.score` task span.
 *
 *   SMOKE_BASE_URL=https://touchstone-api-dev.onrender.com node scripts/score-on-dev.mjs
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from backend/.env.
 * NOTE: a real score writes an APPEND-ONLY proof_audit_log row, so the scored submission cannot be
 * hard-deleted (by design). The throwaway recruiter/candidate + screen are left in dev, labelled.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

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

const SUPABASE_URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = (env.SMOKE_BASE_URL || 'https://api.touchstones.ai').replace(/\/+$/, '');
if (!SUPABASE_URL || !ANON || !SERVICE) { console.error('Missing Supabase env'); process.exit(2); }
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
async function mintToken(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token mint failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

const stamp = Date.now();
const PW = `Score!${stamp}aB`;
const recEmail = `llmobs-rec-${stamp}@deleted.invalid`;
const candEmail = `llmobs-cand-${stamp}@deleted.invalid`;

const RUBRIC = { criteria: [
  { id: 'correct',   requirement: 'Returns the correct index pair for all inputs', points_possible: 5, weight: 1 },
  { id: 'efficiency',requirement: 'Uses an O(n) hash-map approach rather than nested loops', points_possible: 3, weight: 1 },
  { id: 'edge_cases',requirement: 'Handles duplicates and negative numbers correctly', points_possible: 2, weight: 1 },
]};
const SUBMISSION = `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return [seen[need], i]
        seen[n] = i
    return []
`;

(async () => {
  console.log(`\nReal grader run against ${BASE}\n`);
  const h = await http('GET', '/health');
  console.log('health:', h.status, h.body?.ready ? 'ready' : h.body);

  const rec = await admin.auth.admin.createUser({ email: recEmail, password: PW, email_confirm: true });
  const recId = rec.data?.user?.id;
  await admin.from('profiles').update({ account_type: 'recruiter', recruiter_status: 'verified' }).eq('id', recId);
  const cand = await admin.auth.admin.createUser({ email: candEmail, password: PW, email_confirm: true });
  const candId = cand.data?.user?.id;
  const recTok = await mintToken(recEmail, PW);
  const candTok = await mintToken(candEmail, PW);
  console.log('accounts ok:', !!recId, !!candId);

  const create = await http('POST', '/api/proof/work-samples', { token: recTok, body: {
    title: `LLMObs grader test ${stamp}`,
    prompt_md: 'Implement two_sum(nums, target) -> [i, j] with i<j. O(n) hash-map preferred; handle duplicates/negatives.',
    rubric: RUBRIC, response_type: 'code', languages: ['python'], duration_minutes: 30,
    starter_files: [{ path: 'solution.py', content: 'def two_sum(nums, target):\n    pass\n' }],
  }});
  const wsId = create.body?.id;
  console.log('screen created:', create.status, wsId);

  const assign = await http('POST', `/api/proof/work-samples/${wsId}/assign`, { token: recTok, body: { candidate_id: candId } });
  const subId = assign.body?.id;
  console.log('assigned, submission:', assign.status, subId);

  await http('GET', `/api/proof/submissions/${subId}`, { token: candTok }); // open -> in_progress
  const submit = await http('POST', `/api/proof/submissions/${subId}/submit`, { token: candTok, body: { response_code: SUBMISSION } });
  console.log('submitted:', submit.status, submit.body?.status);

  console.log('\n>>> calling REAL score endpoint (Azure grader, N=3) — this takes ~15-45s...\n');
  const t0 = Date.now();
  const score = await http('POST', `/api/proof/submissions/${subId}/score`, { token: recTok, body: {} });
  console.log(`score endpoint: ${score.status} in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log(JSON.stringify(score.body, null, 2));

  // best-effort: confirm provenance recorded the Azure model
  const { data: ps } = await admin.from('proof_scores').select('model_id, normalized_score, self_consistency_n, score_variance, injection_flag').eq('submission_id', subId).order('created_at', { ascending: false }).limit(1);
  console.log('\nproof_scores row:', JSON.stringify(ps?.[0] || null));
  console.log(`\nLeft in dev (append-only audit blocks delete): recruiter=${recEmail} candidate=${candEmail} screen=${wsId} submission=${subId}`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
