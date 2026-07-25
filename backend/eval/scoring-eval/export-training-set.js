#!/usr/bin/env node
/**
 * export-training-set.js — Stage 0 substrate for the scoring-model work.
 * ---------------------------------------------------------------------
 * READ-ONLY. Assembles ONE JSONL row per live-scored submission with everything a
 * calibration head / eval harness needs, in one place:
 *   • features (work-product only): response, grader per_criterion, hidden-test pass
 *     ratio, AI-direction sub-scores, self-consistency n + variance, timing, model_id
 *   • the current LLM-produced score (normalized_score) — CIRCULAR, measure against it
 *   • the real labels (near-zero today): human_override + override_reason, and the
 *     submission_outcome (advanced / offer / hired / retained_90d)
 *
 * It deliberately also emits the GAP flags — tests_authored, is_synthetic — and prints a
 * summary so we can see, at a glance, how little non-circular signal exists yet. This is the
 * versioned baseline every later stage is measured against. Spends nothing, changes no schema,
 * flips no flags: new file only, fully reversible.
 *
 * NO identity / demographic / biometric features are ever selected (proof_demographics is never
 * touched). Writes training-set.jsonl (gitignored — contains candidate response text). Dev only.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env node backend/eval/scoring-eval/export-training-set.js
 *   EXPORT_POOL_LIMIT=500 node backend/eval/scoring-eval/export-training-set.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const OUT_PATH = path.resolve(__dirname, 'training-set.jsonl');
const POOL_LIMIT = parseInt(process.env.EXPORT_POOL_LIMIT || '500', 10);

function chunk200(a) {
  const out = [];
  for (let i = 0; i < a.length; i += 200) out.push(a.slice(i, i + 200));
  return out;
}

// codeExecutionService.runCases → { ran, kind:'cases', passedCount, total }. The one non-circular
// correctness signal. null when no hidden tests were authored/run (the common case right now).
function passRatio(testResults) {
  if (!testResults || testResults.ran !== true) return null;
  const total = Number(testResults.total) || 0;
  if (!total) return null;
  const passed = Number(testResults.passedCount) || 0;
  return Math.round((passed / total) * 1000) / 1000;
}

// Heuristic split so the summary shows how much of the labeled set is real vs seeded demo/smoke.
function looksSynthetic(title) {
  return /smoke|demo|verification|sample|\[demo\]|add\(/i.test(title || '');
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (load backend/.env).');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1. Live (non-superseded) scores — the authoritative grade per submission.
  const { data: scores, error: eS } = await sb
    .from('proof_scores')
    .select(
      'id, submission_id, rubric_version, normalized_score, score_variance, per_criterion, ' +
        'model_id, human_override, override_reason, outcome, self_consistency_n, injection_flag, ' +
        'correctness_ratio, created_at',
    )
    .is('superseded_by', null)
    .not('normalized_score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(POOL_LIMIT);
  if (eS) throw new Error('proof_scores: ' + eS.message);

  const subIds = [...new Set(scores.map((s) => s.submission_id).filter(Boolean))];

  // 2. Submissions — response + hidden-test results + timing.
  const subById = new Map();
  for (const c of chunk200(subIds)) {
    const { data, error } = await sb
      .from('work_sample_submissions')
      .select('id, work_sample_id, response_text, response_code, test_results, started_at, submitted_at, status')
      .in('id', c);
    if (error) throw new Error('work_sample_submissions: ' + error.message);
    for (const s of data) subById.set(s.id, s);
  }

  // 3. Work samples — rubric + role + whether hidden tests are even authored.
  const wsIds = [...new Set([...subById.values()].map((s) => s.work_sample_id).filter(Boolean))];
  const wsById = new Map();
  for (const c of chunk200(wsIds)) {
    const { data, error } = await sb
      .from('work_samples')
      .select('id, role_family, response_type, rubric, rubric_version, tests, title')
      .in('id', c);
    if (error) throw new Error('work_samples: ' + error.message);
    for (const w of data) wsById.set(w.id, w);
  }

  // 4. Labels — real outcomes + AI-direction sub-scores (latest per submission).
  const outcomeBy = new Map();
  const directionBy = new Map();
  for (const c of chunk200(subIds)) {
    const [{ data: outs, error: eO }, { data: dirs, error: eD }] = await Promise.all([
      sb.from('submission_outcomes').select('submission_id, advanced, got_offer, hired, retained_90d').in('submission_id', c),
      sb
        .from('ai_direction_scores')
        .select('submission_id, direction_score, prompt_quality, error_catching, verification_rigor, created_at')
        .in('submission_id', c),
    ]);
    if (eO) throw new Error('submission_outcomes: ' + eO.message);
    if (eD) throw new Error('ai_direction_scores: ' + eD.message);
    for (const o of outs || []) outcomeBy.set(o.submission_id, o);
    for (const d of dirs || []) {
      const prev = directionBy.get(d.submission_id);
      if (!prev || new Date(d.created_at) > new Date(prev.created_at)) directionBy.set(d.submission_id, d);
    }
  }

  const out = fs.createWriteStream(OUT_PATH);
  const stat = {
    rows: 0,
    genuine: 0,
    tests_authored: 0,
    with_test_results: 0,
    with_outcome: 0,
    with_hire_label: 0,
    with_direction: 0,
    human_override: 0,
  };

  for (const sc of scores) {
    const sub = subById.get(sc.submission_id);
    if (!sub) continue;
    const ws = wsById.get(sub.work_sample_id);
    if (!ws || !ws.rubric || !Array.isArray(ws.rubric.criteria) || ws.rubric.criteria.length === 0) continue;

    const response = String(sub.response_text || sub.response_code || '');
    const testsAuthored = !!(ws.tests && ws.tests.kind === 'cases' && Array.isArray(ws.tests.cases) && ws.tests.cases.length);
    const pr = passRatio(sub.test_results);
    const o = outcomeBy.get(sc.submission_id) || null;
    const d = directionBy.get(sc.submission_id) || null;
    const durationSec =
      sub.started_at && sub.submitted_at
        ? Math.max(0, Math.round((new Date(sub.submitted_at) - new Date(sub.started_at)) / 1000))
        : null;
    const synthetic = looksSynthetic(ws.title);

    const row = {
      submission_id: sc.submission_id,
      work_sample_id: ws.id,
      role_family: ws.role_family || null,
      response_type: ws.response_type || null,
      rubric_version: sc.rubric_version,
      // ── features (work-product only) ──
      response,
      per_criterion: sc.per_criterion || null,
      test_pass_ratio: pr, // null unless hidden tests were authored AND ran
      // Measured correctness persisted at score time (099). With AI_SCORE_EXEC_GROUNDING on this
      // is the grounded (possibly adjudicated) ratio the final score used — the non-circular label.
      correctness_ratio: sc.correctness_ratio ?? null,
      tests_authored: testsAuthored,
      duration_sec: durationSec,
      ai_direction: d
        ? {
            score: d.direction_score,
            prompt_quality: d.prompt_quality,
            error_catching: d.error_catching,
            verification_rigor: d.verification_rigor,
          }
        : null,
      self_consistency_n: sc.self_consistency_n ?? null,
      score_variance: sc.score_variance != null ? Number(sc.score_variance) : null,
      injection_flag: sc.injection_flag ?? null,
      model_id: sc.model_id || null,
      // ── current label (LLM-produced → circular; measure against, never only train on) ──
      normalized_score: sc.normalized_score,
      // ── real labels (the gold signal — near-zero today) ──
      human_override: !!sc.human_override,
      override_reason: sc.override_reason || null,
      outcome: o ? { advanced: o.advanced, got_offer: o.got_offer, hired: o.hired, retained_90d: o.retained_90d } : null,
      // rubric kept so a re-grade / calibration fit is fully self-contained
      rubric: ws.rubric,
      is_synthetic: synthetic,
    };
    out.write(JSON.stringify(row) + '\n');

    stat.rows += 1;
    if (!synthetic) stat.genuine += 1;
    if (testsAuthored) stat.tests_authored += 1;
    if (pr != null) stat.with_test_results += 1;
    if (o) stat.with_outcome += 1;
    if (o && o.hired != null) stat.with_hire_label += 1;
    if (d) stat.with_direction += 1;
    if (sc.human_override) stat.human_override += 1;
  }

  out.end();
  await new Promise((r) => out.on('finish', r));

  console.log(`Wrote ${stat.rows} rows → ${OUT_PATH}`);
  console.log(JSON.stringify(stat, null, 2));
  console.log(
    '\nRead these numbers as the label budget: `with_test_results` and `human_override` are the only\n' +
      'non-circular signals; where they are ~0, external datasets (CodeContests/EvalPlus) and the\n' +
      'labeling flywheel are the unlock, not a bigger model.',
  );
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
