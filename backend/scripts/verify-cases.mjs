/**
 * Local verifier for the assessment test cases — runs the SAME harness codeExecutionService builds,
 * but with the local python3/node instead of E2B (identical execution). For each assessment it:
 *   1. runs the REFERENCE solution against ALL cases  → every case must PASS,
 *   2. runs the BUGGY solution against ALL cases       → at least one case must FAIL,
 * which proves the cases are correct (expected values match a real solution) AND discriminating.
 *
 * Usage:  node scripts/verify-cases.mjs            # all
 *         node scripts/verify-cases.mjs two-sum    # one by slug
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildHarness } = require('../src/services/codeExecutionService.js');
const assessments = (await import('./assessments/index.mjs')).default;

function runHarness(a, solutionCode) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-verify-'));
  try {
    const nonce = randomBytes(6).toString('hex');
    const { harnessPath, content, command } = buildHarness(a.language, a.entry_file, a.entry_fn, a.cases, nonce);
    writeFileSync(join(dir, a.entry_file), solutionCode);
    writeFileSync(join(dir, harnessPath), content);
    const r = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', timeout: 30000 });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const re = new RegExp(`##TS:${nonce}## (\\d+) ## (PASS|FAIL) ## (.*)$`);
    const parsed = {};
    for (const line of text.split('\n')) {
      const m = line.match(re);
      if (m) parsed[Number(m[1])] = { passed: m[2] === 'PASS', got: m[3] };
    }
    return a.cases.map((c, i) => ({ name: c.name, passed: parsed[i] ? parsed[i].passed : false, got: parsed[i] ? parsed[i].got : '(no output)' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const only = process.argv[2];
const list = only ? assessments.filter((a) => a.slug === only) : assessments;
if (!list.length) { console.error(`no assessment matching "${only}"`); process.exit(2); }

let failures = 0;
for (const a of list) {
  console.log(`\n▸ ${a.slug} — ${a.title} [${a.role_family}/${a.language}]`);
  const ref = runHarness(a, a.reference);
  const refFail = ref.filter((c) => !c.passed);
  if (refFail.length === 0) {
    console.log(`  ✓ reference passes all ${ref.length} cases`);
  } else {
    failures++;
    console.log(`  ✗ reference FAILS ${refFail.length} case(s): ${refFail.map((c) => `${c.name} (got ${c.got})`).join('; ')}`);
  }
  const buggy = runHarness(a, a.buggy);
  const buggyFail = buggy.filter((c) => !c.passed);
  if (buggyFail.length > 0) {
    console.log(`  ✓ buggy fails ${buggyFail.length} case(s) — cases are discriminating`);
  } else {
    failures++;
    console.log(`  ✗ buggy PASSES all cases — cases do NOT discriminate a wrong solution`);
  }
  // sanity: exactly 3 visible
  const visible = a.cases.filter((c) => c.visible).length;
  if (visible !== 3) { failures++; console.log(`  ✗ expected 3 visible cases, found ${visible}`); }
  else console.log(`  ✓ 3 visible / ${a.cases.length - 3} hidden`);
}

console.log(`\n${failures === 0 ? '✓ ALL ASSESSMENTS VERIFIED' : `✗ ${failures} problem(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
