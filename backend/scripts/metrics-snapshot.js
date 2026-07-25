#!/usr/bin/env node
/**
 * metrics-snapshot.js — the "Traction — July Sprint" funnel snapshot.
 *
 * READ-ONLY: this script performs ZERO writes to the database. It only .select()s and then writes a
 * local markdown file (docs/metrics/snapshot-YYYY-MM-DD.md) + prints the same table to stdout. These
 * are the numbers the Day-7/Day-13 investor memos quote, so the honesty rules are absolute:
 *
 *   • EXCLUDES demo/seed data — the demo recruiter (METRICS_DEMO_RECRUITER_ID), any '[Demo]%'-titled
 *     screens, archived screens, and the seed candidate/recruiter accounts (METRICS_SEED_EMAILS) — so
 *     the funnel reflects REAL usage, not our own seeding.
 *   • Never dresses a proxy as the real thing: metrics that live in PostHog (page views, UTM sources)
 *     print "n/a (PostHog)" rather than a DB stand-in.
 *   • Date is explicit (--date=YYYY-MM-DD), never inferred mid-run; defaults to today.
 *
 * Usage:
 *   node scripts/metrics-snapshot.js                 # today, 14-day window
 *   node scripts/metrics-snapshot.js --date=2026-07-07
 *   node scripts/metrics-snapshot.js --days=14
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env'); process.exit(1); }
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── Seed/demo/test exclusions (investor-honest) ────────────────────────────────────────────
// The dev DB accumulates a LOT of automated-test + smoke + founder-dev accounts. Counting those as
// traction would be the exact dishonesty the memo must avoid, so we exclude, by unambiguous signal:
//   • the demo recruiter id, and named seed/founder accounts (SEED_EMAILS),
//   • test/throwaway EMAIL patterns (TEST_EMAIL_RE) — @touchstones-test.com (the e2e domain),
//     @example.com, *.invalid (deleted users), *.testmail.app + the pgyu4 testmail namespace,
//   • smoke/probe SCREEN titles (TEST_TITLE_RE) as a backstop for any test screen under a real owner.
// Excluding a test PROFILE cascades: its screens (owner-excluded) and their submissions drop too.
const DEMO_RECRUITER_ID = process.env.METRICS_DEMO_RECRUITER_ID || 'f1f4f5dd-4e1b-4db5-9203-d4aa76cc1a99';
const SEED_EMAILS = new Set(
  (process.env.METRICS_SEED_EMAILS ||
    // demo/candidate seed accounts, the founder's own dev accounts, the Ashby integration-test
    // account, and known probe accounts — none are external design partners. Maintain via env.
    'demo@touchstones.ai,candidate.demo@touchstones.ai,candidate.demo2@touchstones.ai,' +
    'ayushshreeshreemal@gmail.com,ayushjlm10@gmail.com,ayushjlm0@gmail.com,' +
    'ashby-partner@touchstones.ai,invite-flow-probe-7x9q2@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const TEST_EMAIL_RE = new RegExp(
  process.env.METRICS_TEST_EMAIL_RE || '@touchstones-test\\.com$|@example\\.com$|\\.invalid$|\\.testmail\\.app$|pgyu4',
  'i',
);
const TEST_TITLE_RE = /^\[(smoke|smoke-v2|probe[^\]]*|poll|compliance)\]|^smoke:|\badd\(a\s*,\s*b\)|^fix verify\b/i;
const isSeedEmail = (email) => { const e = String(email || '').toLowerCase(); return SEED_EMAILS.has(e) || TEST_EMAIL_RE.test(e); };
const isSeedProfile = (p) => p.id === DEMO_RECRUITER_ID || isSeedEmail(p.email);

// ── Args (explicit date, never ambient mid-run) ────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const DAYS = Math.max(1, Number(arg('days', 14)) || 14);
const dateArg = arg('date', null);
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) { console.error('--date must be YYYY-MM-DD'); process.exit(1); }
// Snapshot day = the (UTC) calendar day the window ends on.
const SNAP = dateArg || new Date().toISOString().slice(0, 10);
const dayStr = (d) => d.toISOString().slice(0, 10);
const snapEnd = new Date(`${SNAP}T00:00:00.000Z`); snapEnd.setUTCDate(snapEnd.getUTCDate() + 1); // exclusive
const windowStart = new Date(`${SNAP}T00:00:00.000Z`); windowStart.setUTCDate(windowStart.getUTCDate() - (DAYS - 1));
const inWindow = (iso) => { const t = new Date(iso).getTime(); return t >= windowStart.getTime() && t < snapEnd.getTime(); };
const last7Start = new Date(snapEnd.getTime() - 7 * 86400000);
const inLast7 = (iso) => { const t = new Date(iso).getTime(); return t >= last7Start.getTime() && t < snapEnd.getTime(); };

// The 14 (or N) calendar days of the window, oldest→newest.
const windowDays = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(windowStart.getTime() + i * 86400000);
  return dayStr(d);
});
const bucketOf = (iso) => dayStr(new Date(iso));

async function selectAll(table, cols) {
  // Read-only; paginate defensively so a growing table never silently truncates at 1000.
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const uniq = (arr) => new Set(arr.filter(Boolean)).size;
const countBy = (rows, keyFn) => rows.reduce((m, r) => { const k = keyFn(r); m[k] = (m[k] || 0) + 1; return m; }, {});

async function main() {
  // ── Fetch (all read-only) ──────────────────────────────────────────────────────────────
  const profiles = await selectAll('profiles', 'id, email, account_type, recruiter_status, created_at');
  const screens = await selectAll('work_samples', 'id, owner_id, title, status, created_at');
  const subs = await selectAll('work_sample_submissions', 'id, work_sample_id, candidate_id, status, created_at, started_at, submitted_at');
  const scores = await selectAll('proof_scores', 'id, submission_id, created_at');
  let waitlist = [];
  try {
    const wlAll = await selectAll('waitlist', 'kind, email, created_at');
    waitlist = wlAll.filter((w) => !isSeedEmail(w.email)); // drop founder/test inbound so the count is real
  } catch (e) { waitlist = null; console.warn('waitlist read failed:', e.message); }

  // ── Build the seed/demo/test exclusion sets ──────────────────────────────────────────────
  const excludedProfileIds = new Set(profiles.filter(isSeedProfile).map((p) => p.id));
  excludedProfileIds.add(DEMO_RECRUITER_ID); // in case the demo recruiter row isn't in `profiles`

  const isJunkScreen = (w) =>
    excludedProfileIds.has(w.owner_id) || /^\[Demo\]/i.test(w.title || '') || TEST_TITLE_RE.test(w.title || '') || w.status === 'archived';
  const excludedScreenIds = new Set(screens.filter(isJunkScreen).map((w) => w.id));
  const realScreens = screens.filter((w) => !excludedScreenIds.has(w.id));
  const excludedSubIds = new Set(subs.filter((s) => excludedScreenIds.has(s.work_sample_id)).map((s) => s.id));
  const realSubs = subs.filter((s) => !excludedSubIds.has(s.id));
  const realProfiles = profiles.filter((p) => !excludedProfileIds.has(p.id));

  const excludedCount = { profiles: excludedProfileIds.size, screens: excludedScreenIds.size, submissions: excludedSubIds.size };

  // ── ACQUISITION ──────────────────────────────────────────────────────────────────────────
  const newProfiles = realProfiles.filter((p) => p.created_at && inWindow(p.created_at));
  const profilesPerDay = windowDays.map((d) => {
    const rows = newProfiles.filter((p) => bucketOf(p.created_at) === d);
    return { day: d, candidate: rows.filter((p) => p.account_type === 'candidate').length, recruiter: rows.filter((p) => p.account_type === 'recruiter').length };
  });
  const recruiterStatusBreakdown = countBy(realProfiles, (p) => p.recruiter_status || 'none');

  const waitlistPerDay = waitlist == null ? null : windowDays.map((d) => {
    const rows = waitlist.filter((w) => w.created_at && bucketOf(w.created_at) === d && inWindow(w.created_at));
    return { day: d, demo: rows.filter((w) => w.kind === 'demo').length, waitlist: rows.filter((w) => w.kind === 'waitlist').length };
  });
  const demoReq14 = waitlist == null ? null : waitlist.filter((w) => w.kind === 'demo' && w.created_at && inWindow(w.created_at)).length;
  const waitlist14 = waitlist == null ? null : waitlist.filter((w) => w.kind === 'waitlist' && w.created_at && inWindow(w.created_at)).length;

  // ── ACTIVATION FUNNEL ────────────────────────────────────────────────────────────────────
  const recruitersWithScreen = uniq(realScreens.map((w) => w.owner_id));
  const screensPerDay = windowDays.map((d) => ({ day: d, created: realScreens.filter((w) => w.created_at && bucketOf(w.created_at) === d && inWindow(w.created_at)).length }));
  const screensCreated14 = realScreens.filter((w) => w.created_at && inWindow(w.created_at)).length;

  const subsByStatus = countBy(realSubs, (s) => s.status || 'unknown');
  const scoredSubIds = new Set(scores.map((sc) => sc.submission_id).filter((id) => !excludedSubIds.has(id)));
  const scoredSubmissions = realSubs.filter((s) => scoredSubIds.has(s.id)).length;

  const STARTED = new Set(['in_progress', 'submitted', 'scored']);
  const DONE = new Set(['submitted', 'scored']);
  const candInvited = uniq(realSubs.map((s) => s.candidate_id));
  const candStarted = uniq(realSubs.filter((s) => STARTED.has(s.status) || s.started_at).map((s) => s.candidate_id));
  const candCompleted = uniq(realSubs.filter((s) => DONE.has(s.status)).map((s) => s.candidate_id));

  // ── DEPTH: recruiters active in last 7d (screen created / submission / score on their screens) ──
  const screenOwner = Object.fromEntries(realScreens.map((w) => [w.id, w.owner_id]));
  const activeOwners = new Set();
  for (const w of realScreens) if (w.created_at && inLast7(w.created_at)) activeOwners.add(w.owner_id);
  for (const s of realSubs) if (s.created_at && inLast7(s.created_at) && screenOwner[s.work_sample_id]) activeOwners.add(screenOwner[s.work_sample_id]);
  const subToOwner = Object.fromEntries(realSubs.map((s) => [s.id, screenOwner[s.work_sample_id]]));
  for (const sc of scores) if (sc.created_at && inLast7(sc.created_at) && subToOwner[sc.submission_id]) activeOwners.add(subToOwner[sc.submission_id]);
  activeOwners.delete(undefined);
  const recruitersActive7d = activeOwners.size;

  // ── Summary totals (these get a delta column vs the previous snapshot) ────────────────────
  const summary = {
    'New profiles (window)': newProfiles.length,
    '  ├ candidates': newProfiles.filter((p) => p.account_type === 'candidate').length,
    '  └ recruiters': newProfiles.filter((p) => p.account_type === 'recruiter').length,
    'Recruiters verified (current)': recruiterStatusBreakdown.verified || 0,
    'Recruiters pending (current)': recruiterStatusBreakdown.pending || 0,
    'Demo requests (window)': demoReq14 == null ? 'n/a (schema)' : demoReq14,
    'Waitlist signups (window)': waitlist14 == null ? 'n/a (schema)' : waitlist14,
    'Recruiters with ≥1 screen': recruitersWithScreen,
    'Screens created (window)': screensCreated14,
    'Submissions (total, real)': realSubs.length,
    'Scored submissions (aha proxy)': scoredSubmissions,
    'Candidates invited': candInvited,
    'Candidates started': candStarted,
    'Candidates completed': candCompleted,
    'Recruiters active (last 7d)': recruitersActive7d,
    'Site visits / page views': 'n/a (PostHog)',
    'Signups by UTM source': 'n/a (PostHog)',
  };

  // ── Delta vs the most recent PRIOR snapshot (reads the embedded JSON, never re-queries) ───
  const outDir = path.join(__dirname, '..', '..', 'docs', 'metrics');
  fs.mkdirSync(outDir, { recursive: true });
  const prior = findPriorSnapshot(outDir, SNAP);
  const priorSummary = prior ? prior.summary : null;

  const md = renderMarkdown({
    summary, priorSummary, priorDate: prior ? prior.date : null,
    profilesPerDay, recruiterStatusBreakdown, waitlistPerDay, screensPerDay, subsByStatus, excludedCount,
  });

  const outFile = path.join(outDir, `snapshot-${SNAP}.md`);
  fs.writeFileSync(outFile, md);

  // stdout: the summary table (the four-number memo lives here) + where the full file is.
  console.log(renderSummaryText(summary, priorSummary, prior ? prior.date : null));
  console.log(`\nFull snapshot written to: ${path.relative(path.join(__dirname, '..', '..'), outFile)}`);
  if (prior) console.log(`Delta computed against: snapshot-${prior.date}.md`);
}

// Find the newest snapshot-YYYY-MM-DD.md with a date strictly before `snap`, and parse its JSON block.
function findPriorSnapshot(dir, snap) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  const dates = files
    .map((f) => (f.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.md$/) || [])[1])
    .filter((d) => d && d < snap)
    .sort();
  if (!dates.length) return null;
  const prevDate = dates[dates.length - 1];
  try {
    const txt = fs.readFileSync(path.join(dir, `snapshot-${prevDate}.md`), 'utf8');
    const m = txt.match(/<!--\s*METRICS_JSON\s*([\s\S]*?)-->/);
    if (!m) return { date: prevDate, summary: null };
    return { date: prevDate, summary: JSON.parse(m[1]).summary || null };
  } catch { return { date: prevDate, summary: null }; }
}

function deltaCell(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number') return '—';
  const d = cur - prev;
  return d === 0 ? '±0' : d > 0 ? `+${d}` : `${d}`;
}

function renderSummaryText(summary, priorSummary, priorDate) {
  const rows = Object.entries(summary).map(([k, v]) => {
    const d = priorSummary ? deltaCell(v, priorSummary[k]) : '';
    return `  ${k.padEnd(34)} ${String(v).padStart(12)}${priorSummary ? '   Δ ' + d : ''}`;
  });
  return `Traction — July Sprint · snapshot ${SNAP} (last ${DAYS}d)  [excludes demo/seed data]\n` +
    (priorDate ? `(Δ vs ${priorDate})\n` : '') + rows.join('\n');
}

function mdTable(headers, rows) {
  return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n` +
    rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
}

function renderMarkdown(d) {
  const { summary, priorSummary, priorDate, profilesPerDay, recruiterStatusBreakdown, waitlistPerDay, screensPerDay, subsByStatus, excludedCount } = d;

  const summaryRows = Object.entries(summary).map(([k, v]) =>
    priorSummary ? [k, String(v), deltaCell(v, priorSummary[k])] : [k, String(v)]);
  const summaryTable = priorSummary
    ? mdTable(['Metric', SNAP, `Δ vs ${priorDate}`], summaryRows)
    : mdTable(['Metric', SNAP], summaryRows);

  const acqTable = mdTable(['Day', 'New candidates', 'New recruiters'],
    profilesPerDay.map((r) => [r.day, r.candidate, r.recruiter]));
  const wlTable = waitlistPerDay == null ? '_waitlist table unavailable (schema)_'
    : mdTable(['Day', 'Demo requests', 'Waitlist signups'], waitlistPerDay.map((r) => [r.day, r.demo, r.waitlist]));
  const screensTable = mdTable(['Day', 'Screens created'], screensPerDay.map((r) => [r.day, r.created]));
  const statusRows = Object.entries(subsByStatus).map(([k, v]) => [k, v]);
  const statusTable = statusRows.length ? mdTable(['Submission status', 'Count'], statusRows) : '_no real submissions yet_';
  const recStatusTable = mdTable(['recruiter_status', 'Profiles'], Object.entries(recruiterStatusBreakdown).map(([k, v]) => [k, v]));

  return `# Traction — July Sprint · Metrics Snapshot

**Date:** ${SNAP}  ·  **Window:** last ${DAYS} days (${windowDays[0]} → ${windowDays[windowDays.length - 1]}, UTC)
**Scope:** \`excludes demo/seed/test data\` — the demo recruiter (\`${DEMO_RECRUITER_ID}\`), \`[Demo]%\`-titled + smoke/probe-titled screens, archived screens, named seed/founder accounts, and automated-test email patterns (\`@touchstones-test.com\`, \`@example.com\`, \`*.invalid\`, testmail). Excluded this run: **${excludedCount.profiles} profiles, ${excludedCount.screens} screens, ${excludedCount.submissions} submissions.** On the dev DB this is nearly everything — Day-1 external traction is ~0 (no cold outreach has gone out yet), which is the honest state.
${priorDate ? `**Delta:** vs \`snapshot-${priorDate}.md\`.` : '**Delta:** none (first snapshot).'}

## Summary
${summaryTable}

### How to read this
- **Numbers are DB-derived and seed-excluded.** They reflect real recruiters/candidates only. \`n/a (PostHog)\` marks metrics that don't live in the DB (page views, UTM source) — those come from the PostHog dashboard, not a proxy dressed up here.
- **Scored submissions** is the aha proxy (a real score was produced), not a vanity total. **Candidates completed** = distinct candidates with a submitted/scored submission.
- **Recruiters active (7d)** = distinct recruiters who created a screen, received a submission, or got a score on their screen in the last 7 days.
- Depth metrics (WAR, D7 return) are only meaningful at Day 30+; treat single-digit N as directional, not a rate.
- Δ columns compare to the previous snapshot's totals; per-day tables below are not deltaed.

## Acquisition — new profiles per day
${acqTable}

### Current recruiter_status breakdown
${recStatusTable}

## Inbound — demo requests & waitlist per day
${wlTable}

## Activation — screens created per day
${screensTable}

### Submissions by status (real)
${statusTable}

<!-- METRICS_JSON ${JSON.stringify({ date: SNAP, days: DAYS, summary })} -->
`;
}

main().then(() => process.exit(0)).catch((e) => { console.error('SNAPSHOT FAILED:', e.message); process.exit(1); });
