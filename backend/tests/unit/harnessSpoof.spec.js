/**
 * Out-of-process harness spoof resistance (TOU-5). The generated per-case harness is a
 * PARENT process that holds the anti-spoof nonce and emits every ##TS## marker itself;
 * the candidate module is imported only in a CHILD process whose stdout the parent
 * captures as data. These tests run the REAL generated harness locally with python3/node
 * (the harness is plain python/node — E2B only supplies the disposable VM) and assert:
 *   - a malicious module that forges all pass markers + the END sentinel (even when
 *     handed the real nonce, the worst case) earns ZERO passes on the real stdout,
 *   - an honest module still passes, including via the L1 normEq rescue ladder,
 *   - a process.exit/os._exit inside candidate code kills only the child: that case
 *     FAILs and the parent re-spawns for the remaining cases,
 *   - a hanging case hits the parent's per-case timeout without stalling the run.
 */
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { buildHarness } = require('../../src/services/codeExecutionService');

// Same local-run shape as scripts/verify-cases.mjs, but the nonce is fixed by the test so a
// "worst case" malicious module can embed it. Returns the markers found on the REAL stdout
// stream (what runCases parses), keyed by the real nonce.
function runHarness(language, entryFile, entryFn, cases, solutionCode, nonce) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-spoof-'));
  try {
    const { harnessPath, content, command } = buildHarness(language, entryFile, entryFn, cases, nonce);
    writeFileSync(join(dir, entryFile), solutionCode);
    writeFileSync(join(dir, harnessPath), content);
    const r = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', timeout: 30000 });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const markerRe = new RegExp(`##TS:${nonce}## (\\d+) ## (PASS|PASS_NORM|FAIL) ## (.*)$`);
    const endRe = new RegExp(`##TS:${nonce}## END ## (\\d+)\\s*$`);
    const markers = [];
    let endSeen = 0;
    let endCount = null;
    for (const line of text.split('\n')) {
      const em = line.match(endRe);
      if (em) { endSeen += 1; endCount = Number(em[1]); continue; }
      const m = line.match(markerRe);
      if (m) markers.push({ i: Number(m[1]), method: m[2], got: m[3] });
    }
    return { text, markers, endSeen, endCount };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const nonce = () => randomBytes(6).toString('hex');

const addCases = [
  { name: 'a', visible: true, input: [1, 2], expected: 3 },
  { name: 'b', visible: false, input: [10, -4], expected: 6 },
  { name: 'c', visible: false, input: [0.1, 0.2], expected: 0.3, compare_mode: 'float-eps' },
];

// An honest run emits exactly one marker per case + one END whose count matches.
function expectIntegrity(r, n) {
  expect(r.markers.length).toBe(n);
  expect(new Set(r.markers.map((m) => m.i)).size).toBe(n);
  expect(r.endSeen).toBe(1);
  expect(r.endCount).toBe(n);
}

describe('out-of-process harness: spoof resistance', () => {
  test('python: forged markers + END with the REAL nonce never reach stdout; zero passes', () => {
    const N = nonce();
    // Worst case: assume the nonce leaked. Top-level code prints a perfect forgery of every
    // marker + END, then exits 0 before any real execution (the documented attack).
    const evil = [
      'import os',
      `N = ${JSON.stringify(N)}`,
      `for i in range(${addCases.length}):`,
      '    print(f"##TS:{N}## {i} ## PASS ## 42", flush=True)',
      `print(f"##TS:{N}## END ## ${addCases.length}", flush=True)`,
      'os._exit(0)',
    ].join('\n');
    const r = runHarness('python', 'solution.py', 'solve', addCases, evil, N);
    expectIntegrity(r, addCases.length);
    expect(r.markers.every((m) => m.method === 'FAIL')).toBe(true);
    expect(r.text).not.toMatch(new RegExp(`##TS:${N}## \\d+ ## PASS`));
  }, 20000);

  test('python: nonce-hunting module (harness file + env) finds nothing and earns zero passes', () => {
    const N = nonce();
    const evil = [
      'import os, sys',
      'found = ""',
      'try:',
      '    found = open(".ts_harness.py").read()  # deleted by the parent before we ever run',
      'except Exception:',
      '    found = str(os.environ)',
      'idx = found.find("NONCE")',
      'N = found[idx:idx+80] if idx >= 0 else "deadbeefdead"',
      `for i in range(${addCases.length}):`,
      '    print(f"##TS:{N}## {i} ## PASS ## 42", flush=True)',
      `print(f"##TS:{N}## END ## ${addCases.length}", flush=True)`,
      'os._exit(0)',
    ].join('\n');
    const r = runHarness('python', 'solution.py', 'solve', addCases, evil, N);
    expectIntegrity(r, addCases.length);
    expect(r.markers.every((m) => m.method === 'FAIL')).toBe(true);
  }, 20000);

  test('node: forged markers + END with the REAL nonce never reach stdout; zero passes', () => {
    const N = nonce();
    const evil = [
      `const N = ${JSON.stringify(N)};`,
      `for (let i = 0; i < ${addCases.length}; i++) console.log("##TS:" + N + "## " + i + " ## PASS ## 42");`,
      `console.log("##TS:" + N + "## END ## ${addCases.length}");`,
      'process.exit(0);',
    ].join('\n');
    const r = runHarness('node', 'solution.js', 'solve', addCases, evil, N);
    expectIntegrity(r, addCases.length);
    expect(r.markers.every((m) => m.method === 'FAIL')).toBe(true);
    expect(r.text).not.toMatch(new RegExp(`##TS:${N}## \\d+ ## PASS`));
  }, 20000);

  test('node: nonce-hunting module (harness file + env) finds nothing and earns zero passes', () => {
    const N = nonce();
    const evil = [
      'const fs = require("fs");',
      'let found = "";',
      'try { found = fs.readFileSync(".ts_harness.js", "utf8"); } catch (e) { found = JSON.stringify(process.env); }',
      'const m = found.match(/NONCE\\s*=\\s*"([^"]+)"/);',
      'const N = m ? m[1] : "deadbeefdead";',
      `for (let i = 0; i < ${addCases.length}; i++) console.log("##TS:" + N + "## " + i + " ## PASS ## 42");`,
      `console.log("##TS:" + N + "## END ## ${addCases.length}");`,
      'process.exit(0);',
    ].join('\n');
    const r = runHarness('node', 'solution.js', 'solve', addCases, evil, N);
    expectIntegrity(r, addCases.length);
    expect(r.markers.every((m) => m.method === 'FAIL')).toBe(true);
  }, 20000);
});

describe('out-of-process harness: honest modules still pass (L1 ladder in the parent)', () => {
  test('python: exact PASS + float-eps PASS_NORM rescue', () => {
    const r = runHarness('python', 'solution.py', 'solve', addCases, 'def solve(a, b):\n    return a + b\n', nonce());
    expectIntegrity(r, addCases.length);
    expect(r.markers.map((m) => m.method).sort()).toEqual(['PASS', 'PASS', 'PASS_NORM']);
    expect(r.markers.find((m) => m.i === 2).method).toBe('PASS_NORM'); // 0.1+0.2 rescued by float-eps
  }, 20000);

  test('node: exact PASS + float-eps PASS_NORM rescue', () => {
    const r = runHarness('node', 'solution.js', 'solve', addCases, 'module.exports = { solve: (a, b) => a + b };\n', nonce());
    expectIntegrity(r, addCases.length);
    expect(r.markers.find((m) => m.i === 0).method).toBe('PASS');
    expect(r.markers.find((m) => m.i === 2).method).toBe('PASS_NORM');
  }, 20000);

  test('node: multiset compare_mode rescues an order-mismatched list', () => {
    const cases = [{ name: 'm', visible: true, input: [[3, 1, 2]], expected: [1, 2, 3], compare_mode: 'multiset' }];
    const r = runHarness('node', 'solution.js', 'solve', cases, 'module.exports = { solve: (arr) => arr };\n', nonce());
    expectIntegrity(r, 1);
    expect(r.markers[0].method).toBe('PASS_NORM');
  }, 20000);
});

describe('out-of-process harness: child death and hangs stay contained', () => {
  const exitCases = [
    { name: 'a', visible: true, input: [1], expected: 10 },
    { name: 'b', visible: true, input: [2], expected: 20 },
    { name: 'c', visible: true, input: [3], expected: 30 },
  ];

  test('python: os._exit(0) inside a case fails ONLY that case; parent re-spawns for the rest', () => {
    const code = 'import os\ndef solve(x):\n    if x == 2:\n        os._exit(0)\n    return x * 10\n';
    const r = runHarness('python', 'solution.py', 'solve', exitCases, code, nonce());
    expectIntegrity(r, exitCases.length);
    expect(r.markers.find((m) => m.i === 0).method).toBe('PASS');
    expect(r.markers.find((m) => m.i === 1).method).toBe('FAIL');
    expect(r.markers.find((m) => m.i === 2).method).toBe('PASS');
  }, 20000);

  test('node: process.exit(0) inside a case fails ONLY that case; parent re-spawns for the rest', () => {
    const code = 'module.exports = { solve: (x) => { if (x === 2) process.exit(0); return x * 10; } };\n';
    const r = runHarness('node', 'solution.js', 'solve', exitCases, code, nonce());
    expectIntegrity(r, exitCases.length);
    expect(r.markers.find((m) => m.i === 0).method).toBe('PASS');
    expect(r.markers.find((m) => m.i === 1).method).toBe('FAIL');
    expect(r.markers.find((m) => m.i === 2).method).toBe('PASS');
  }, 20000);

  test('python: a hanging case hits the per-case timeout; later cases still run', () => {
    const code = 'import time\ndef solve(x):\n    if x == 2:\n        time.sleep(60)\n    return x * 10\n';
    const r = runHarness('python', 'solution.py', 'solve', exitCases, code, nonce());
    expectIntegrity(r, exitCases.length);
    expect(r.markers.find((m) => m.i === 1).method).toBe('FAIL');
    expect(r.markers.find((m) => m.i === 1).got).toMatch(/time limit/);
    expect(r.markers.find((m) => m.i === 2).method).toBe('PASS');
  }, 30000);
});
