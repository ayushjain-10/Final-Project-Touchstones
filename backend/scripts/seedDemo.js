#!/usr/bin/env node
/**
 * Seed a polished, clickable demo into the live Supabase so the public preview
 * (touchstone-app.vercel.app) has a real example: a demo recruiter who can sign in and
 * see a scored candidate — proof score + "Direct the AI" replay & direction score +
 * a labeled outcome (for the calibration panel).
 *
 * Idempotent: re-running updates the same demo work sample/submission rather than
 * duplicating. Uses the service-role key from backend/.env.
 *
 *   node scripts/seedDemo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env'); process.exit(1); }
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PW = process.env.DEMO_PASSWORD || 'TouchstonesDemo!2026';
const RECRUITER = { email: 'demo@touchstones.ai', name: 'Demo Recruiter', company: 'Acme (demo)' };
const CANDIDATE = { email: 'candidate.demo@touchstones.ai', name: 'Jordan Lee' };
const WS_TITLE = '[Demo] Senior Backend Engineer — debug a flaky payment webhook';

async function ensureUser({ email, name }) {
  // paginate to find an existing user with this email
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data?.users?.find((x) => x.email === email);
    if (u) return u.id;
    if (!data || data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { name },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function upsertProfile(id, { email, name, company }) {
  // handle_new_user may have created a row; make sure name/company are populated.
  await admin.from('profiles').upsert(
    { id, email, first_name: (name || '').split(' ')[0] || null, last_name: (name || '').split(' ').slice(1).join(' ') || null, company: company || null },
    { onConflict: 'id' },
  );
}

const RUBRIC = {
  criteria: [
    { id: 'root_cause', requirement: 'Correctly identifies the race/idempotency root cause', points_possible: 10, weight: 1 },
    { id: 'fix_quality', requirement: 'Fix is correct, minimal, and idempotent', points_possible: 10, weight: 1 },
    { id: 'tests', requirement: 'Adds a regression test that fails before / passes after', points_possible: 6, weight: 1 },
    { id: 'comms', requirement: 'Clear explanation a teammate could review', points_possible: 4, weight: 1 },
  ],
};

const PER_CRITERION = [
  { id: 'root_cause', verdict: 'MET', points_awarded: 9, points_possible: 10, weight: 1, evidence_quote: 'The webhook handler mutates state before the dedup check — at-least-once delivery double-applies it.', explanation: 'Pinpointed the missing idempotency guard as the cause.' },
  { id: 'fix_quality', verdict: 'MET', points_awarded: 8, points_possible: 10, weight: 1, evidence_quote: 'Claim the event id in processed_events before mutating; release on failure.', explanation: 'Minimal, idempotent claim-before-mutate fix.' },
  { id: 'tests', verdict: 'PARTIAL', points_awarded: 5, points_possible: 6, weight: 1, evidence_quote: 'Added a test replaying the same event twice asserting a single state change.', explanation: 'Solid regression test; missing the failure-release case.' },
  { id: 'comms', verdict: 'MET', points_awarded: 4, points_possible: 4, weight: 1, evidence_quote: 'Wrote a 3-line summary of cause, fix, and the at-least-once invariant.', explanation: 'Crisp and reviewable.' },
];

const AI_TURNS = [
  { role: 'user', content: 'Here is a webhook handler that occasionally double-credits an account. What could cause duplicate processing?' },
  { role: 'assistant', content: 'A few possibilities: missing idempotency on at-least-once delivery, a retry without a dedup key, or a race between the read and the write. Want me to look at the handler?' },
  { role: 'user', content: 'It is Stripe. Delivery is at-least-once. Walk me through making it idempotent without a DB lock.' },
  { role: 'assistant', content: 'Claim the event id in a `processed_events(event_key PK)` table BEFORE you mutate; a duplicate hits the PK conflict and you ack without re-processing. Release the claim if processing throws so retries can re-run.' },
  { role: 'user', content: 'Good — but your first draft mutated the balance before the claim. That reintroduces the race. Reorder it: claim first, then mutate.', disposition: 'edited' },
  { role: 'assistant', content: 'You are right — claim-before-mutate is the correct order. Here is the corrected version.' },
];

async function main() {
  console.log('Seeding demo into', URL);
  const recruiterId = await ensureUser(RECRUITER);
  const candidateId = await ensureUser(CANDIDATE);
  await upsertProfile(recruiterId, RECRUITER);
  await upsertProfile(candidateId, CANDIDATE);
  // Make the demo recruiter fully interactive (not blocked by the free 5-screen cap), so a
  // demo can actually author + send screens. Uses the flat subscription columns.
  await admin.from('profiles').update({ subscription_plan: 'growth', subscription_status: 'active' }).eq('id', recruiterId);
  console.log('recruiter:', recruiterId, '| candidate:', candidateId, '| plan: growth');

  // Work sample (idempotent by title+owner)
  let { data: ws } = await admin.from('work_samples').select('id').eq('owner_id', recruiterId).eq('title', WS_TITLE).maybeSingle();
  if (!ws) {
    const { data, error } = await admin.from('work_samples').insert({
      owner_id: recruiterId, title: WS_TITLE,
      prompt_md: 'A production Stripe webhook occasionally double-applies subscription updates. You have the handler + logs. **Find the root cause, fix it, and add a regression test.** AI is allowed — use it well.',
      rubric: RUBRIC, role_family: 'backend', response_type: 'markdown', duration_minutes: 45, scoring_strategy: 'weighted_sum', status: 'published',
    }).select('id').single();
    if (error) throw new Error('work_sample: ' + error.message);
    ws = data;
  }
  console.log('work_sample:', ws.id);

  // Two more PUBLISHED library templates so the recruiter's Assessments/Dashboard isn't sparse.
  // One is a runnable JS code screen (hidden tests → exercises code execution on E2B); the other
  // is a markdown design task. Idempotent by (owner, title).
  const TEMPLATES = [
    {
      title: '[Demo] Frontend — implement a useDebounce hook',
      prompt_md: 'Implement and export a `useDebounce(value, delayMs)` hook in `solution.js` that returns the debounced value. AI is allowed — use it well.',
      role_family: 'frontend', response_type: 'code', languages: ['javascript'],
      starter_files: [{ path: 'solution.js', content: 'module.exports = function useDebounce(value, delayMs) {\n  // TODO\n}\n' }],
      tests: { command: "node -e \"const f=require('./solution.js'); if(typeof f!=='function') process.exit(1); console.log('ok')\"" },
      rubric: { criteria: [
        { id: 'correctness', requirement: 'Debounces correctly; cleans up timers', points_possible: 60, weight: 1 },
        { id: 'quality', requirement: 'Idiomatic, exported, no leaks', points_possible: 40, weight: 1 },
      ] },
    },
    {
      title: '[Demo] Data/ML — design a dedupe for messy contact records',
      prompt_md: 'You receive 2M contact records with duplicates (typos, casing, formatting). **Describe your approach** to dedupe at scale, the tradeoffs, and how you would measure precision/recall. AI is allowed.',
      role_family: 'data_ml', response_type: 'markdown',
      rubric: { criteria: [
        { id: 'approach', requirement: 'Sound blocking + similarity strategy', points_possible: 50, weight: 1 },
        { id: 'tradeoffs', requirement: 'Names real precision/recall + scale tradeoffs', points_possible: 30, weight: 1 },
        { id: 'measurement', requirement: 'Concrete evaluation plan', points_possible: 20, weight: 1 },
      ] },
    },
  ];
  for (const t of TEMPLATES) {
    const { data: existing } = await admin.from('work_samples').select('id').eq('owner_id', recruiterId).eq('title', t.title).maybeSingle();
    if (existing) { console.log('template (exists):', t.title); continue; }
    const { error: tErr } = await admin.from('work_samples').insert({
      owner_id: recruiterId, title: t.title, prompt_md: t.prompt_md, rubric: t.rubric,
      role_family: t.role_family, response_type: t.response_type, duration_minutes: 45,
      scoring_strategy: 'weighted_sum', status: 'published',
      starter_files: t.starter_files || [], languages: t.languages || [], tests: t.tests || null,
    });
    if (tErr) throw new Error('template ' + t.title + ': ' + tErr.message);
    console.log('template (created):', t.title);
  }

  // Submission (idempotent)
  let { data: sub } = await admin.from('work_sample_submissions').select('id').eq('work_sample_id', ws.id).eq('candidate_id', candidateId).maybeSingle();
  const responseText = 'Root cause: the handler mutates the subscription before checking for duplicate delivery; Stripe is at-least-once so a redelivered event double-applies. Fix: claim the event id in processed_events (PK) before any mutation, release on failure. Test: replay the same event id twice and assert a single state change.';
  if (!sub) {
    const { data, error } = await admin.from('work_sample_submissions').insert({
      work_sample_id: ws.id, candidate_id: candidateId,
      response_text: responseText, input_hash: crypto.createHash('sha256').update(responseText).digest('hex'),
      started_at: new Date(Date.now() - 40 * 60000).toISOString(), submitted_at: new Date().toISOString(), status: 'scored',
    }).select('id').single();
    if (error) throw new Error('submission: ' + error.message);
    sub = data;
  } else {
    await admin.from('work_sample_submissions').update({ status: 'scored', response_text: responseText }).eq('id', sub.id);
  }
  console.log('submission:', sub.id);

  // Proof score (replace any existing for a clean demo)
  await admin.from('proof_scores').delete().eq('submission_id', sub.id);
  const { data: score, error: scErr } = await admin.from('proof_scores').insert({
    submission_id: sub.id, rubric_version: 1, prompt_version: 1, model_id: 'claude-haiku-4-5', model_version: 'claude-haiku-4-5',
    scoring_method: 'llm', normalized_score: 84, raw_points_awarded: 26, raw_points_possible: 30, threshold_applied: 60, outcome: 'advance',
    per_criterion: PER_CRITERION, self_consistency_n: 3, score_variance: 1.2, injection_flag: false,
    overall_explanation: 'Correctly diagnosed the at-least-once idempotency race and fixed it with a claim-before-mutate guard backed by a regression test. Strong, reviewable work — the test misses the failure-release case, keeping it just short of full marks.',
  }).select('id').single();
  if (scErr) throw new Error('proof_score: ' + scErr.message);
  console.log('proof_score:', score.id, '→ 84/100 advance');

  // Immutable audit record — mirrors what proofScoringService writes at score time, so the
  // seeded submission's "Export audit trail" (GET /api/proof/scores/:id/audit.json) returns 200.
  // (The proof_scores delete above cascades any prior audit row, so this stays idempotent.)
  const auditRow = {
    proof_score_id: score.id, candidate_id: candidateId, job_id: null,
    work_sample_id: ws.id, assessment_version: 1,
    event_ts_start: new Date(Date.now() - 2 * 60000).toISOString(), event_ts_end: new Date().toISOString(),
    model_id: 'claude-haiku-4-5', model_version: 'claude-haiku-4-5', rubric_version: 1, prompt_version: 1,
    scoring_method: 'llm', input_hash: crypto.createHash('sha256').update(responseText).digest('hex'), input_ref: sub.id,
    overall_score: 84, normalized_score: 84, threshold_applied: 60, outcome: 'advance',
    per_criterion: PER_CRITERION, human_override: false, created_by: 'seedDemo',
  };
  auditRow.row_hash = crypto.createHash('sha256').update(JSON.stringify(auditRow)).digest('hex');
  const { error: auErr } = await admin.from('proof_audit_log').insert(auditRow);
  if (auErr) throw new Error('proof_audit_log: ' + auErr.message);
  console.log('audit row:', auditRow.row_hash.slice(0, 12), '…');

  // AI-interaction replay (idempotent: clear + reinsert)
  await admin.from('ai_interactions').delete().eq('submission_id', sub.id);
  await admin.from('ai_interactions').insert(AI_TURNS.map((t, i) => ({
    submission_id: sub.id, seq: i + 1, role: t.role, content: t.content, disposition: t.disposition || null,
    client_ts: new Date(Date.now() - (AI_TURNS.length - i) * 60000).toISOString(),
  })));

  // Direction score
  await admin.from('ai_direction_scores').delete().eq('submission_id', sub.id);
  await admin.from('ai_direction_scores').insert({
    submission_id: sub.id, prompt_quality: 86, error_catching: 92, verification_rigor: 80, direction_score: 88,
    interaction_count: AI_TURNS.length, model_id: 'claude-haiku-4-5',
    reasoning: 'Scoped, iterative prompts and — critically — caught the AI reordering bug (mutate-before-claim) and corrected it, rather than accepting the flawed draft.',
    per_dimension: { prompt_quality: { points: 86, evidence: 'Walk me through making it idempotent without a DB lock.' }, error_catching: { points: 92, evidence: 'your first draft mutated the balance before the claim — reorder it.' }, verification_rigor: { points: 80, evidence: 'Asked for a regression test that fails before / passes after.' } },
  });
  console.log('direction_score: 88/100 (caught the AI mistake)');

  // Outcome label (feeds calibration)
  await admin.from('submission_outcomes').upsert({
    submission_id: sub.id, advanced: true, got_offer: true, hired: true, retained_90d: true,
    notes: 'Strong onsite, hired, still going at 90 days.', labeled_by: recruiterId,
  }, { onConflict: 'submission_id' });
  console.log('outcome: offer + hired + retained_90d');

  console.log('\n✅ Demo seeded. Sign in to the preview as:');
  console.log('   ', RECRUITER.email, '/', PW, '  (recruiter — see the Dashboard + result)');
  console.log('   ', CANDIDATE.email, '/', PW, '  (candidate)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
