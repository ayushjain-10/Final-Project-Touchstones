/**
 * complianceService — CC1 Compliance & Adverse-Impact.
 * --------------------------------------------------------------------------------------------
 * Two jobs, both decision-SUPPORT (never a legal certification):
 *
 *  A. Defensibility export (NO protected attributes — always available): assemble, from data we
 *     already compute, the artifact an LL-144 auditor / legal review needs — the rubric, the
 *     per-criterion points + evidence, the code-computed score, the proof-of-human state, and a
 *     reference into the immutable audit chain. We LINK/verify the audit chain (reuse
 *     integrityDigestService) — we never recompute the score here.
 *
 *  B. Adverse-impact (EEOC four-fifths / 80% rule — OPT-IN, segregated): selection rate per group
 *     = selected ÷ total; impact ratio = group rate ÷ highest group rate; < 0.80 flags potential
 *     adverse impact. Runs ONLY over employer-provided, opt-in group labels in their own RLS-locked
 *     table (063) — never collected/inferred, never mixed into scoring. Below a per-group sample
 *     floor we return insufficient_data and suppress the ratio (small-n is misleading and a privacy
 *     risk). Pure SQL aggregates + thin JS; no LLM. We never fabricate or impute a demographic.
 */
const { supabaseAdmin } = require('../config/supabase');
const integrityDigestService = require('./integrityDigestService');
const { proofOfHumanFromDigest } = require('./passportService');

// Per-group sample floor: below this a group's rate + impact ratio are suppressed as
// insufficient_data (statistically misleading AND a re-identification risk). Documented + tunable.
// CC1-2 (v3-hardening-2): HARD privacy minimum of 2. n=1 provides ZERO anonymity — it singles
// out one protected-class individual's exact outcome — so the floor can never be configured
// below 2 even via COMPLIANCE_MIN_GROUP_SAMPLE (the default stays 5). This is the backstop that
// keeps RID-1's suppression from being defeated by operator misconfiguration.
const MIN_GROUP_SAMPLE = Math.max(2, parseInt(process.env.COMPLIANCE_MIN_GROUP_SAMPLE || '5', 10));
const FOUR_FIFTHS = 0.8;
// The "selected" event is an outcome the employer already tracks; they choose which.
const SELECTABLE_OUTCOMES = ['advanced', 'got_offer', 'hired'];

const METHODOLOGY_NOTE =
  'Four-fifths (80%) rule (EEOC Uniform Guidelines): selection rate = selected ÷ total per group; '
  + `impact ratio = group rate ÷ the highest group rate. A ratio below ${FOUR_FIFTHS} flags potential `
  + `adverse impact for that group. Groups with fewer than ${MIN_GROUP_SAMPLE} labeled decisions are `
  + 'reported as insufficient_data and excluded from the ratio (small samples are unreliable and a '
  + 'privacy risk). Group labels are employer-provided and opt-in; Touchstones never collects or '
  + 'infers protected attributes, and labels never affect scoring.';
const COUNSEL_NOTE =
  'This is decision-support analysis, not a legal opinion or a certification of compliance. '
  + 'Review results with qualified employment counsel before relying on them.';

const round = (n, d) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

// ── B. Four-fifths math (PURE — unit-tested with a known table) ─────────────────────────────
// groups: [{ value, n, selected }]. Returns the analysis with per-group rates, impact ratios,
// the 0.80 flag, and honest small-n handling. Never throws / NaN.
function fourFifths(groups, { minGroup = MIN_GROUP_SAMPLE } = {}) {
  const rows = (groups || []).map((g) => {
    const n = Math.max(0, Math.floor(Number(g.n) || 0));
    const selected = Math.max(0, Math.min(n, Math.floor(Number(g.selected) || 0)));
    const sufficient = n >= minGroup;
    const rate = n > 0 ? selected / n : null;
    // Re-identification guard (v3-hardening): below the floor we suppress the SELECTED COUNT
    // (and the rate) — not just the impact ratio — because a tiny group's exact selected count
    // (e.g. n=1, selected=1) singles out one protected-class individual's outcome if the report
    // is exported to an auditor/counsel. We keep only the group size n (employer-provided) +
    // sufficient=false. Sufficient groups (n >= floor) keep their count.
    return {
      value: String(g.value),
      n,
      selected: sufficient ? selected : null,
      rate: sufficient && rate != null ? round(rate, 4) : null,
      sufficient,
    };
  });

  const usable = rows.filter((r) => r.sufficient && r.rate != null);
  // Need >= 2 sufficiently-sampled groups AND a positive reference rate to compare anything.
  const refRate = usable.length ? Math.max(...usable.map((r) => r.rate)) : 0;
  if (usable.length < 2 || refRate <= 0) {
    return {
      insufficient: true,
      reason: usable.length < 2
        ? `need at least 2 groups each with >= ${minGroup} labeled decisions`
        : 'no selections among labeled groups — nothing to compare',
      reference_value: null,
      flagged: false,
      min_group_sample: minGroup,
      groups: rows.map((r) => ({ ...r, impact_ratio: null })),
    };
  }
  const ref = usable.find((r) => r.rate === refRate);
  let flagged = false;
  const out = rows.map((r) => {
    if (!r.sufficient || r.rate == null) return { ...r, impact_ratio: null };
    // CC1-1 (v3-hardening-2): flag from the UNROUNDED ratio. A genuinely-adverse ratio like
    // 0.795 (< 0.80 under EEOC) must NOT round up to 0.80 and escape the flag — that would
    // under-report adverse impact at exactly the boundary this tool exists to detect. Display
    // is still rounded to 2dp; the 1e-9 epsilon absorbs float dust at an exact-0.80 boundary.
    const raw = r.rate / refRate;
    if (raw < FOUR_FIFTHS - 1e-9) flagged = true;
    return { ...r, impact_ratio: round(raw, 2) };
  });
  return {
    insufficient: false,
    reference_value: ref.value,
    reference_rate: refRate,
    flagged,
    min_group_sample: minGroup,
    groups: out,
  };
}

// ── B. data layer → four-fifths for a role × attribute × outcome (account-scoped) ───────────
async function ownedSubmissionIdsForRole(accountId, role) {
  let wsQ = supabaseAdmin.from('work_samples').select('id').eq('owner_id', accountId);
  if (role && role !== '*') wsQ = wsQ.eq('role_family', role);
  const { data: wss } = await wsQ;
  const wsIds = (wss || []).map((w) => w.id);
  if (!wsIds.length) return [];
  const ids = [];
  for (let i = 0; i < wsIds.length; i += 200) {
    const { data: subs } = await supabaseAdmin
      .from('work_sample_submissions').select('id').in('work_sample_id', wsIds.slice(i, i + 200));
    for (const s of subs || []) ids.push(s.id);
  }
  return ids;
}

async function computeAdverseImpact({ accountId, role, attribute, outcome }) {
  const sel = SELECTABLE_OUTCOMES.includes(outcome) ? outcome : 'advanced';
  const attr = String(attribute || '').trim();
  if (!attr) return { ok: false, error: 'attribute is required' };

  const subIds = await ownedSubmissionIdsForRole(accountId, role);
  if (!subIds.length) {
    return { ok: true, role_family: role, attribute: attr, selected_outcome: sel, no_data: true, ...fourFifths([]) };
  }

  // KNOWN outcomes only (null = unknown/not-yet → excluded from numerator AND denominator), and the
  // opt-in label for each, both scoped to this account. Service-role reads with an EXPLICIT
  // account/owned-submission filter — never another tenant's rows.
  const outcomeBy = new Map();
  const labelBy = new Map();
  for (let i = 0; i < subIds.length; i += 200) {
    const chunk = subIds.slice(i, i + 200);
    const [{ data: outs }, { data: labels }] = await Promise.all([
      supabaseAdmin.from('submission_outcomes').select(`submission_id, ${sel}`).in('submission_id', chunk),
      supabaseAdmin.from('compliance_demographic_labels')
        .select('submission_id, value').eq('account_id', accountId).eq('attribute', attr).in('submission_id', chunk),
    ]);
    for (const o of outs || []) if (o[sel] === true || o[sel] === false) outcomeBy.set(o.submission_id, o[sel]);
    for (const l of labels || []) labelBy.set(l.submission_id, l.value);
  }

  // A decision counts only if it has BOTH a known outcome AND an opt-in label.
  const byGroup = new Map();
  let totalN = 0;
  for (const subId of subIds) {
    if (!labelBy.has(subId) || !outcomeBy.has(subId)) continue;
    const value = labelBy.get(subId);
    const g = byGroup.get(value) || { value, n: 0, selected: 0 };
    g.n += 1;
    if (outcomeBy.get(subId) === true) g.selected += 1;
    byGroup.set(value, g);
    totalN += 1;
  }

  const analysis = fourFifths([...byGroup.values()]);
  const result = {
    ok: true,
    role_family: role,
    attribute: attr,
    selected_outcome: sel,
    total_n: totalN,
    groups_total: byGroup.size,
    no_labels: byGroup.size === 0,
    ...analysis,
    methodology: METHODOLOGY_NOTE,
    disclaimer: COUNSEL_NOTE,
  };

  // Persist an audit snapshot (service-role; owner-read). Best-effort — never blocks the read.
  try {
    await supabaseAdmin.from('compliance_report_snapshots').upsert({
      account_id: accountId,
      role_family: role || '*',
      attribute: attr,
      selected_outcome: sel,
      groups: analysis.groups,
      reference_value: analysis.reference_value || null,
      total_n: totalN,
      groups_total: byGroup.size,
      min_group_sample: analysis.min_group_sample,
      flagged: !!analysis.flagged,
      insufficient: !!analysis.insufficient,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'account_id,role_family,attribute,selected_outcome' });
  } catch { /* audit snapshot is best-effort */ }

  return result;
}

// Counts of opt-in labels by attribute (for the UI) — account-scoped.
async function labelsSummary(accountId) {
  const { data } = await supabaseAdmin
    .from('compliance_demographic_labels').select('attribute, value').eq('account_id', accountId);
  const byAttr = {};
  for (const r of data || []) {
    const a = (byAttr[r.attribute] = byAttr[r.attribute] || { attribute: r.attribute, total: 0, values: {} });
    a.total += 1;
    a.values[r.value] = (a.values[r.value] || 0) + 1;
  }
  return Object.values(byAttr).map((a) => ({
    attribute: a.attribute,
    total: a.total,
    groups: Object.entries(a.values).map(([value, n]) => ({ value, n })).sort((x, y) => y.n - x.n),
  }));
}

// Distinct roles (owned work_samples that have at least one scored decision) — for the UI picker.
async function availableRoles(accountId) {
  const { data: wss } = await supabaseAdmin.from('work_samples').select('role_family').eq('owner_id', accountId);
  const roles = new Set();
  for (const w of wss || []) roles.add(w.role_family || null);
  return [...roles].filter(Boolean).sort();
}

// ── A. Defensibility export ─────────────────────────────────────────────────────────────────
async function assembleRecord(score) {
  const { data: sub } = await supabaseAdmin.from('work_sample_submissions')
    .select('id, work_sample_id, candidate_id, submitted_at, status').eq('id', score.submission_id).maybeSingle();
  let ws = {};
  if (sub && sub.work_sample_id) {
    const { data } = await supabaseAdmin.from('work_samples')
      .select('id, owner_id, title, role_family, rubric, rubric_version').eq('id', sub.work_sample_id).maybeSingle();
    ws = data || {};
  }
  // Audit-chain reference: LINK the immutable head row_hash for this score (do NOT recompute it).
  const { data: audit } = await supabaseAdmin.from('proof_audit_log')
    .select('row_hash, prev_row_hash, input_hash, scoring_method, model_id, rubric_version, created_at')
    .eq('proof_score_id', score.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  // Proof-of-human (behavioral) — reuse integrityDigestService + the canonical derivation.
  let proofOfHuman = 'review';
  let integrityVerified = null;
  if (score.submission_id) {
    try {
      const digest = await integrityDigestService.computeDigest(score.submission_id);
      proofOfHuman = proofOfHumanFromDigest(digest);
      integrityVerified = digest.verified_chain;
    } catch { /* degrade to advisory 'review' */ }
  }
  const rubricCriteria = (ws.rubric && Array.isArray(ws.rubric.criteria)) ? ws.rubric.criteria : [];
  const perCriterion = (Array.isArray(score.per_criterion) ? score.per_criterion : []).map((pc) => {
    const def = rubricCriteria.find((c) => c.id === pc.id) || {};
    return {
      id: pc.id,
      requirement: def.requirement || def.label || pc.id,
      points_awarded: pc.points_awarded,
      points_possible: pc.points_possible,
      verdict: pc.verdict || null,
      evidence: pc.evidence_quote || pc.evidence || '',
      explanation: pc.explanation || '',
    };
  });
  return {
    record_version: 1,
    generated_at: new Date().toISOString(),
    decision: {
      score_id: score.id,
      submission_id: score.submission_id,
      role_family: ws.role_family || null,
      screen_title: ws.title || null,
      outcome: score.outcome,
      normalized_score: score.normalized_score,
      raw_points_awarded: score.raw_points_awarded,
      raw_points_possible: score.raw_points_possible,
      threshold_applied: score.threshold_applied,
      scoring_method: score.scoring_method || 'code', // explainable, code-computed
      model_id: score.model_id || null,
      rubric_version: ws.rubric_version ?? score.rubric_version ?? null,
      human_override: !!score.human_override,
      override_reason: score.override_reason || null,
      decided_at: score.created_at,
    },
    rubric: rubricCriteria.map((c) => ({
      id: c.id, requirement: c.requirement || c.label || c.id,
      points_possible: c.points_possible ?? null, weight: c.weight ?? null,
    })),
    per_criterion: perCriterion,
    overall_explanation: score.overall_explanation || null,
    proof_of_human: { state: proofOfHuman, integrity_chain_verified: integrityVerified },
    audit_chain: audit
      ? { row_hash: audit.row_hash, prev_row_hash: audit.prev_row_hash, input_hash: audit.input_hash, recorded_at: audit.created_at }
      : null,
    methodology: 'Score is computed in code from the authored rubric (the model emits per-criterion '
      + 'points only); proof-of-human is behavioral; every decision is bound to an append-only, '
      + 'hash-chained audit log. This record links that chain — it does not recompute the score.',
    disclaimer: COUNSEL_NOTE,
    _owner_id: ws.owner_id || null, // internal: ownership gate (stripped before returning to client)
  };
}

async function buildRecordForScore(scoreId) {
  const { data: score } = await supabaseAdmin.from('proof_scores')
    .select('id, submission_id, normalized_score, raw_points_awarded, raw_points_possible, threshold_applied, outcome, per_criterion, overall_explanation, scoring_method, model_id, rubric_version, human_override, override_reason, created_at')
    .eq('id', scoreId).maybeSingle();
  if (!score) return null;
  return assembleRecord(score);
}

// Role-level export: the rubric(s) for the role + one compact defensibility line per decision.
async function buildRoleExport(accountId, role) {
  let wsQ = supabaseAdmin.from('work_samples').select('id, title, role_family, rubric, rubric_version').eq('owner_id', accountId);
  if (role && role !== '*') wsQ = wsQ.eq('role_family', role);
  const { data: wss } = await wsQ;
  const wsIds = (wss || []).map((w) => w.id);
  const screens = (wss || []).map((w) => ({
    id: w.id, title: w.title, role_family: w.role_family, rubric_version: w.rubric_version,
    rubric: (w.rubric && Array.isArray(w.rubric.criteria))
      ? w.rubric.criteria.map((c) => ({ id: c.id, requirement: c.requirement || c.label || c.id, points_possible: c.points_possible ?? null }))
      : [],
  }));
  const decisions = [];
  if (wsIds.length) {
    const subByWs = new Map();
    for (let i = 0; i < wsIds.length; i += 200) {
      const { data: subs } = await supabaseAdmin
        .from('work_sample_submissions').select('id, work_sample_id, candidate_id').in('work_sample_id', wsIds.slice(i, i + 200));
      for (const s of subs || []) subByWs.set(s.id, s);
    }
    const subIds = [...subByWs.keys()];
    for (let i = 0; i < subIds.length; i += 200) {
      const { data: scores } = await supabaseAdmin.from('proof_scores')
        .select('id, submission_id, normalized_score, outcome, scoring_method, created_at')
        .is('superseded_by', null).in('submission_id', subIds.slice(i, i + 200));
      for (const sc of scores || []) {
        const { data: audit } = await supabaseAdmin.from('proof_audit_log')
          .select('row_hash').eq('proof_score_id', sc.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        decisions.push({
          score_id: sc.id,
          submission_id: sc.submission_id,
          outcome: sc.outcome,
          normalized_score: sc.normalized_score,
          scoring_method: sc.scoring_method || 'code',
          audit_row_hash: audit ? audit.row_hash : null,
          decided_at: sc.created_at,
        });
      }
    }
  }
  return {
    record_version: 1,
    generated_at: new Date().toISOString(),
    role_family: role || '*',
    screens,
    decisions,
    decision_count: decisions.length,
    methodology: 'Each decision is an explainable, code-computed, rubric-derived score bound to an '
      + 'append-only audit chain (audit_row_hash). No protected attributes are present in this record.',
    disclaimer: COUNSEL_NOTE,
  };
}

// Plain-text/markdown summary of a single-decision record (human-readable artifact).
function recordToSummaryMd(rec) {
  if (!rec) return '';
  const d = rec.decision || {};
  const lines = [];
  lines.push(`# Defensibility record — ${d.screen_title || 'screen'} (${d.role_family || 'role'})`);
  lines.push('');
  lines.push(`- Decision: **${d.outcome || 'scored'}** · score ${d.normalized_score}/100 (threshold ${d.threshold_applied ?? 'n/a'})`);
  lines.push(`- Scoring method: ${d.scoring_method} (code-computed from the rubric; model emits per-criterion points only)`);
  lines.push(`- Proof-of-human: ${rec.proof_of_human?.state} · integrity chain verified: ${rec.proof_of_human?.integrity_chain_verified}`);
  lines.push(`- Audit chain reference: ${rec.audit_chain?.row_hash || '(none)'}`);
  lines.push(`- Decided at: ${d.decided_at}`);
  if (d.human_override) lines.push(`- Human override: yes — ${d.override_reason || ''}`);
  lines.push('');
  lines.push('## Per-criterion (rubric-derived)');
  for (const c of rec.per_criterion || []) {
    lines.push(`- **${c.requirement}** — ${c.points_awarded}/${c.points_possible}${c.verdict ? ` (${c.verdict})` : ''}`);
    if (c.evidence) lines.push(`  - evidence: ${String(c.evidence).slice(0, 280)}`);
    if (c.explanation) lines.push(`  - rationale: ${String(c.explanation).slice(0, 280)}`);
  }
  if (rec.overall_explanation) { lines.push(''); lines.push('## Overall'); lines.push(rec.overall_explanation); }
  lines.push('');
  lines.push(`> ${rec.disclaimer}`);
  return lines.join('\n');
}

module.exports = {
  // constants
  MIN_GROUP_SAMPLE,
  FOUR_FIFTHS,
  SELECTABLE_OUTCOMES,
  METHODOLOGY_NOTE,
  COUNSEL_NOTE,
  // four-fifths (pure, unit-tested)
  fourFifths,
  // data-layer
  computeAdverseImpact,
  labelsSummary,
  availableRoles,
  buildRecordForScore,
  buildRoleExport,
  recordToSummaryMd,
};
