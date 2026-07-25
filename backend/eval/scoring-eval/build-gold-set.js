#!/usr/bin/env node
/**
 * Gold-set builder for the scoring eval harness.
 * ----------------------------------------------
 * Pulls a sample of ALREADY-scored submissions from the dev DB and freezes them as
 * an offline gold set the eval runner can re-grade. Each item captures exactly what
 * the app's grader consumes: the work-sample's rubric + the submission's response,
 * plus the score the app already stored (`proof_scores.normalized_score`) as the
 * reference point.
 *
 * Read-only. Writes ONE file: gold-set.json (gitignored — it contains candidate
 * response text). Run against dev only. No new keys: reads backend/.env.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env node backend/eval/scoring-eval/build-gold-set.js
 *   GOLD_LIMIT=15 node backend/eval/scoring-eval/build-gold-set.js   # cap the set
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const GOLD_LIMIT = parseInt(process.env.GOLD_LIMIT || '15', 10);   // pilot cap
const POOL_LIMIT = parseInt(process.env.GOLD_POOL_LIMIT || '80', 10); // scored rows to scan
const OUT_PATH = path.resolve(__dirname, 'gold-set.json');

function rubricHasCriteria(rubric) {
  return rubric && Array.isArray(rubric.criteria) && rubric.criteria.length > 0;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (load backend/.env).');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1. Live (non-superseded) scores are the authoritative reference score per submission.
  const { data: scores, error: eScores } = await sb
    .from('proof_scores')
    .select('id, submission_id, rubric_version, normalized_score, outcome, model_id')
    .is('superseded_by', null)
    .not('normalized_score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(POOL_LIMIT);
  if (eScores) throw new Error('proof_scores query failed: ' + eScores.message);

  // 2. Fetch the submissions + work samples for those scores (in bulk).
  const submissionIds = [...new Set(scores.map(s => s.submission_id).filter(Boolean))];
  const { data: subs, error: eSubs } = await sb
    .from('work_sample_submissions')
    .select('id, work_sample_id, response_text, response_code')
    .in('id', submissionIds);
  if (eSubs) throw new Error('work_sample_submissions query failed: ' + eSubs.message);
  const subById = new Map(subs.map(s => [s.id, s]));

  const workSampleIds = [...new Set(subs.map(s => s.work_sample_id).filter(Boolean))];
  const { data: samples, error: eWs } = await sb
    .from('work_samples')
    .select('id, rubric_version, rubric')
    .in('id', workSampleIds);
  if (eWs) throw new Error('work_samples query failed: ' + eWs.message);
  const wsById = new Map(samples.map(w => [w.id, w]));

  // 3. Join + filter. Skip rows missing a rubric or a response. Only keep rows whose
  //    stored score was produced against the SAME rubric_version the work sample still
  //    carries (re-grading against a changed rubric would be an unfair comparison).
  const gold = [];
  const skipped = { noSub: 0, noWorkSample: 0, noRubric: 0, noResponse: 0, versionDrift: 0 };
  for (const sc of scores) {
    const sub = subById.get(sc.submission_id);
    if (!sub) { skipped.noSub++; continue; }
    const ws = wsById.get(sub.work_sample_id);
    if (!ws) { skipped.noWorkSample++; continue; }
    if (!rubricHasCriteria(ws.rubric)) { skipped.noRubric++; continue; }
    const response = String(sub.response_text || sub.response_code || '');
    if (!response.trim()) { skipped.noResponse++; continue; }
    if (ws.rubric_version !== sc.rubric_version) { skipped.versionDrift++; continue; }

    gold.push({
      id: sub.id,                       // submission id
      score_id: sc.id,
      work_sample_id: ws.id,
      rubric_version: ws.rubric_version,
      rubric: ws.rubric,                // { criteria: [...] }
      response,                         // exactly what the app grades
      stored_score: sc.normalized_score,
      stored_outcome: sc.outcome,
      stored_model: sc.model_id,        // model that produced stored_score (may differ from the current grader)
    });
    if (gold.length >= GOLD_LIMIT) break;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(gold, null, 2));
  console.log(`Scanned ${scores.length} live scores → wrote ${gold.length} gold items to ${OUT_PATH}`);
  console.log('Skipped:', JSON.stringify(skipped));
  if (gold.length === 0) {
    console.warn('WARNING: gold set is empty. Check that dev has scored submissions with matching rubric versions.');
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
