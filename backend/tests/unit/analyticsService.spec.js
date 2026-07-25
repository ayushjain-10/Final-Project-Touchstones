/**
 * analyticsService — pure-aggregate unit tests (no DB, CI-safe).
 * Proves the /app/insights numbers are REAL aggregates of seeded rows and that
 * the ROI headline = (caller's editable inputs) × (real counts), and that
 * changing an input changes the output. (v3 honesty baseline #4: no baked
 * constants served as live.)
 */

const svc = require('../../src/services/analyticsService');

// A small seeded cohort of one screen's submissions, as the raw rows the DB
// fetch returns (pre-enrich). T0 anchors all timestamps deterministically.
const T0 = '2026-06-01T10:00:00.000Z';
const plus = (mins) => new Date(new Date(T0).getTime() + mins * 60000).toISOString();

function seed() {
  const submissions = [
    { id: 's1', work_sample_id: 'w1', started_at: T0, submitted_at: plus(30), status: 'scored', created_at: T0 },
    { id: 's2', work_sample_id: 'w1', started_at: T0, submitted_at: plus(40), status: 'scored', created_at: T0 },
    { id: 's3', work_sample_id: 'w1', started_at: T0, submitted_at: plus(50), status: 'scored', created_at: T0 },
    { id: 's4', work_sample_id: 'w1', started_at: T0, submitted_at: plus(20), status: 'submitted', created_at: T0 },
    { id: 's5', work_sample_id: 'w1', started_at: T0, submitted_at: null, status: 'assigned', created_at: T0 },
  ];
  const scores = [
    // s1 was re-scored: the OLD row is superseded (must be ignored), the live row is 90.
    { submission_id: 's1', normalized_score: 40, outcome: 'review', created_at: plus(44), superseded_by: 'x' },
    { submission_id: 's1', normalized_score: 90, outcome: 'advance', created_at: plus(45), superseded_by: null },
    { submission_id: 's2', normalized_score: 72, outcome: 'advance', created_at: plus(55), superseded_by: null },
    { submission_id: 's3', normalized_score: 55, outcome: 'reject', created_at: plus(65), superseded_by: null },
  ];
  const outcomes = [
    { submission_id: 's1', advanced: true, got_offer: true, hired: true, retained_90d: true, labeled_at: plus(2880) },
    { submission_id: 's2', advanced: true, got_offer: true, hired: false, retained_90d: null, labeled_at: plus(2900) },
    { submission_id: 's3', advanced: false, got_offer: null, hired: null, retained_90d: null, labeled_at: plus(3000) },
  ];
  return { submissions, scores, outcomes };
}

describe('enrich — live score selection + scored predicate', () => {
  it('ignores superseded scores and keeps the latest live one', () => {
    const { submissions, scores, outcomes } = seed();
    const rows = svc.enrich(submissions, scores, outcomes);
    const s1 = rows.find((r) => r.id === 's1');
    expect(s1.score).toBe(90); // not the superseded 40
    expect(s1.scored).toBe(true);
    const s5 = rows.find((r) => r.id === 's5');
    expect(s5.submitted).toBe(false);
    expect(s5.scored).toBe(false);
    expect(s5.score).toBeNull();
  });

  it('scored is keyed on a live score, NOT on status alone (no overcount)', () => {
    // a submission marked status='scored' but with NO proof_score row is NOT scored.
    const rows = svc.enrich(
      [{ id: 'x', work_sample_id: 'w', started_at: T0, submitted_at: plus(10), status: 'scored', created_at: T0 }],
      [],
      [],
    );
    expect(rows[0].submitted).toBe(true);
    expect(rows[0].scored).toBe(false);
  });

  it('treats the whole post-submit status superset as submitted', () => {
    const rows = svc.enrich(
      [{ id: 'p', work_sample_id: 'w', started_at: T0, submitted_at: null, status: 'pending_scoring', created_at: T0 }],
      [],
      [],
    );
    expect(rows[0].submitted).toBe(true);
  });
});

describe('computeFunnel — 8-stage pipeline on seeded data', () => {
  const { submissions, scores, outcomes } = seed();
  const rows = svc.enrich(submissions, scores, outcomes);
  const funnel = svc.computeFunnel(rows);
  const by = Object.fromEntries(funnel.stages.map((s) => [s.key, s.count]));

  it('counts each stage from real predicates', () => {
    expect(by.created).toBe(5);
    expect(by.started).toBe(5);
    expect(by.submitted).toBe(4); // s1..s4
    expect(by.scored).toBe(3); // s1,s2,s3
    expect(by.advanced).toBe(2); // s1,s2
    expect(by.offer).toBe(2); // s1,s2
    expect(by.hired).toBe(1); // s1
    expect(by.retained_90d).toBe(1); // s1
  });

  it('computes conversions at discriminating stages (distinct denominators)', () => {
    const submitted = funnel.stages.find((s) => s.key === 'submitted');
    expect(submitted.conversion_from_prev).toBe(80); // 4/5
    expect(submitted.conversion_from_top).toBe(80);
    // scored: from_prev = 3/4 = 75 ; from_top = 3/5 = 60 — different denominators, so a
    // swapped/wrong-denominator bug would be caught here.
    const scored = funnel.stages.find((s) => s.key === 'scored');
    expect(scored.conversion_from_prev).toBe(75);
    expect(scored.conversion_from_top).toBe(60);
    expect(funnel.total).toBe(5);
  });

  it('pins the biggest drop-off (first stage with the largest single-step loss)', () => {
    // drops: started 0, submitted 1, scored 1, advanced 1, offer 0, hired 1, retained 0
    // → first max-drop transition is started→submitted.
    expect(funnel.biggest_dropoff).toEqual({ from: 'started', to: 'submitted', lost: 1 });
  });

  it('is empty-safe', () => {
    const empty = svc.computeFunnel([]);
    expect(empty.total).toBe(0);
    expect(empty.stages.every((s) => s.count === 0)).toBe(true);
    expect(empty.biggest_dropoff).toBeNull();
  });
});

describe('countsForRoi + computeRoi — output = inputs × real counts', () => {
  const { submissions, scores, outcomes } = seed();
  const rows = svc.enrich(submissions, scores, outcomes);
  const counts = svc.countsForRoi(rows);

  it('derives real counts from the cohort', () => {
    expect(counts.completed).toBe(4); // s1..s4 submitted
    expect(counts.scored).toBe(3);
    expect(counts.advanced).toBe(2);
    expect(counts.offers).toBe(2);
    expect(counts.hires).toBe(1);
    expect(counts.qualified).toBe(2);
  });

  it('multiplies the editable assumptions by the real counts', () => {
    const roi = svc.computeRoi(counts, { hoursPerOnsite: 4, hourlyCost: 150 });
    // onsites_avoided = completed(4) — a pure real count, NOT corrected by labels
    expect(roi.results.onsites_avoided).toBe(4);
    // hours_saved = 4 * 4
    expect(roi.results.hours_saved).toBe(16);
    // dollars_saved = 16 * 150 (computed from the rounded hours so it reconciles)
    expect(roi.results.dollars_saved).toBe(2400);
    expect(roi.results.hours_saved * roi.inputs.hourlyCost).toBe(roi.results.dollars_saved);
    // cost_per_qualified = completed(4) * 4 * 150 / qualified(2) = 1200
    expect(roi.results.cost_per_qualified).toBe(1200);
    // the response echoes the inputs it used (honesty)
    expect(roi.inputs).toEqual({ hoursPerOnsite: 4, hourlyCost: 150 });
    expect(roi.counts.completed).toBe(4);
  });

  it('unlabeled completed screens do NOT inflate onsites_avoided beyond the real count', () => {
    // 3 completed screens, ZERO outcome labels (advanced all null).
    const rows = svc.enrich(
      [
        { id: 'u1', work_sample_id: 'w', started_at: T0, submitted_at: plus(5), status: 'submitted', created_at: T0 },
        { id: 'u2', work_sample_id: 'w', started_at: T0, submitted_at: plus(5), status: 'submitted', created_at: T0 },
        { id: 'u3', work_sample_id: 'w', started_at: T0, submitted_at: plus(5), status: 'submitted', created_at: T0 },
      ],
      [],
      [],
    );
    const roi = svc.computeRoi(svc.countsForRoi(rows), { hoursPerOnsite: 4, hourlyCost: 150 });
    expect(roi.counts.advanced).toBe(0);
    expect(roi.results.onsites_avoided).toBe(3); // exactly the completed count — not inflated
    expect(roi.results.cost_per_qualified).toBeNull(); // honest: no qualified candidates yet
  });

  it('changing hoursPerOnsite changes the output', () => {
    const a = svc.computeRoi(counts, { hoursPerOnsite: 4, hourlyCost: 150 });
    const b = svc.computeRoi(counts, { hoursPerOnsite: 6, hourlyCost: 150 });
    expect(b.results.hours_saved).toBe(24); // 4 * 6
    expect(b.results.dollars_saved).toBe(3600); // 24 * 150
    expect(b.results.hours_saved).not.toBe(a.results.hours_saved);
    expect(b.results.cost_per_qualified).not.toBe(a.results.cost_per_qualified);
  });

  it('changing hourlyCost changes the dollar output but not the hours', () => {
    const a = svc.computeRoi(counts, { hoursPerOnsite: 4, hourlyCost: 150 });
    const b = svc.computeRoi(counts, { hoursPerOnsite: 4, hourlyCost: 300 });
    expect(b.results.hours_saved).toBe(a.results.hours_saved); // hours independent of $
    expect(b.results.dollars_saved).toBe(4800); // 16 * 300
    expect(b.results.dollars_saved).not.toBe(a.results.dollars_saved);
  });

  it('falls back to sane DEFAULT assumptions when none/invalid are given', () => {
    const roi = svc.computeRoi(counts, { hoursPerOnsite: undefined, hourlyCost: 'abc' });
    expect(roi.inputs.hoursPerOnsite).toBe(svc.DEFAULT_HOURS_PER_ONSITE);
    expect(roi.inputs.hourlyCost).toBe(svc.DEFAULT_HOURLY_COST);
    // and it still computes from real counts (completed=4) with those defaults
    expect(roi.results.hours_saved).toBe(4 * svc.DEFAULT_HOURS_PER_ONSITE);
  });

  it('degrades honestly for a brand-new (empty) account', () => {
    const roi = svc.computeRoi(svc.countsForRoi([]), { hoursPerOnsite: 4, hourlyCost: 150 });
    expect(roi.results.onsites_avoided).toBe(0);
    expect(roi.results.dollars_saved).toBe(0);
    expect(roi.results.cost_per_qualified).toBeNull(); // no qualified candidates yet
  });
});

describe('computeThroughput — medians + volume', () => {
  const { submissions, scores, outcomes } = seed();
  const rows = svc.enrich(submissions, scores, outcomes);
  const tp = svc.computeThroughput(rows, { days: 30 });

  it('computes time medians from real timestamps', () => {
    // start→submit minutes across s1..s4 = [30,40,50,20] → sorted [20,30,40,50] → median 35
    expect(tp.median_minutes_to_submit).toBe(35);
    // submit→score exists for s1,s2,s3 (live scores) → all positive
    expect(tp.median_minutes_to_score).toBeGreaterThan(0);
    // submit→decision (labeled) exists for s1,s2,s3
    expect(tp.median_hours_to_decision).toBeGreaterThan(0);
    expect(tp.samples.to_submit).toBe(4);
  });

  it('produces a per-day volume series', () => {
    expect(Array.isArray(tp.volume)).toBe(true);
    const day = tp.volume.find((d) => d.date === '2026-06-01');
    expect(day.created).toBe(5);
    expect(day.submitted).toBe(4);
    expect(day.scored).toBe(3);
  });
});
