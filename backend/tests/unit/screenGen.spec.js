/**
 * screenGenService — "Author with AI" (CC2/S2) unit tests.
 *
 * Mocks the shared Claude wrapper + spendGuard so we exercise the GUARDRAILS without
 * hitting the network: rubric normalization (sums to 100), runnable hidden-test harness
 * generation (actually executed with `node`), spend-ceiling + AI-unavailable degradation,
 * and the freeform (non-codeable) path.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomBytes } = require('crypto');

jest.mock('../../src/services/aiService', () => ({ getLLM: jest.fn() }));
jest.mock('../../src/services/spendGuard', () => {
  class SpendCeilingError extends Error {
    constructor(reason) {
      super(`LLM spend guard tripped: ${reason}`);
      this.name = 'SpendCeilingError';
      this.reason = reason;
      this.statusCode = 429;
    }
  }
  return { reserve: jest.fn(() => ({ ok: true })), SpendCeilingError };
});

const aiService = require('../../src/services/aiService');
const spendGuard = require('../../src/services/spendGuard');
const screenGen = require('../../src/services/screenGenService');
const codeExec = require('../../src/services/codeExecutionService');

function mockModel(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  const create = jest.fn(async () => ({ content: [{ type: 'text', text }], usage: {} }));
  aiService.getLLM.mockReturnValue({ anthropic: { messages: { create } }, model: 'test-model' });
  return create;
}

// Run a {kind:'cases'} tests object against a candidate solution using the REAL modern harness
// (codeExecutionService.buildHarness) with local node — identical to what runCases does in E2B.
// Returns a boolean[] of per-case pass/fail.
function runCasesLocally(hiddenTests, solutionCode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screengen-'));
  try {
    const nonce = randomBytes(6).toString('hex');
    const { harnessPath, content, command } = codeExec.buildHarness(
      hiddenTests.language, hiddenTests.entry_file, hiddenTests.entry_fn, hiddenTests.cases, nonce,
    );
    fs.writeFileSync(path.join(dir, hiddenTests.entry_file), solutionCode);
    fs.writeFileSync(path.join(dir, harnessPath), content);
    const r = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', timeout: 30000 });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const re = new RegExp(`##TS:${nonce}## (\\d+) ## (PASS|PASS_NORM|FAIL) ## (.*)$`);
    const parsed = {};
    for (const line of text.split('\n')) {
      const m = line.match(re);
      if (m) parsed[Number(m[1])] = m[2] !== 'FAIL'; // PASS or PASS_NORM both count as passed
    }
    return hiddenTests.cases.map((_, i) => parsed[i] === true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const UNIT_FUNCTION_OUTPUT = {
  title: 'Fix the broken totals helper',
  role: 'Senior Backend Engineer',
  role_family: 'backend',
  language: 'javascript',
  task_kind: 'unit_function',
  task_markdown:
    '## Fix the order-total helper\nA billing helper under-counts line items on retries. Reproduce it, fix the root cause, and keep the public signature. AI is allowed — use it well and verify the output.',
  duration_minutes: 45,
  entry: { export: 'default' },
  starter_files: [
    { path: 'solution.js', language: 'javascript', content: 'module.exports = (a, b) => a; // BUG\n' },
  ],
  cases: [
    { name: 'adds positives', args: [2, 3], expected: 5 },
    { name: 'handles negatives', args: [-1, 1], expected: 0 },
    { name: 'zero', args: [0, 0], expected: 0 },
  ],
  rubric: [
    { label: 'Correct root-cause fix', points: 4, requirement: 'Fixes the real bug' },
    { label: 'Edge cases', points: 3, requirement: 'Covers retries/boundaries' },
    { label: 'Directs & verifies the AI', points: 3, requirement: 'Checks AI output' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  spendGuard.reserve.mockReturnValue({ ok: true, remaining: 100 });
});

describe('generateFromJD — unit_function (runnable tests)', () => {
  test('produces a code draft with a normalized rubric and a runnable harness', async () => {
    mockModel(UNIT_FUNCTION_OUTPUT);
    const draft = await screenGen.generateFromJD({ jd: 'We need a backend engineer for billing.', accountId: 'acct-1' });

    expect(draft.response_type).toBe('code');
    expect(draft.input_kind).toBe('jd');
    expect(draft.ai_allowed).toBe(true);
    expect(draft.role).toBe('Senior Backend Engineer');
    expect(draft.languages).toEqual(['javascript']);

    // Rubric normalized to sum EXACTLY 100, every criterion >= 1, has requirement text.
    const total = draft.rubric.reduce((s, r) => s + r.points, 0);
    expect(total).toBe(100);
    expect(draft.rubric.every((r) => r.points >= 1 && r.label && r.requirement)).toBe(true);

    // Hidden tests in the MODERN {kind:'cases'} shape runCases/isCaseTests consume (renames applied).
    expect(draft.hidden_tests.kind).toBe('cases');
    expect(draft.hidden_tests.language).toBe('javascript');
    expect(draft.hidden_tests.entry_file).toBe('solution.js');
    expect(draft.hidden_tests.entry_fn).toBe('solve');
    expect(draft.hidden_tests.timeout_ms).toBeGreaterThan(0);
    expect(draft.hidden_tests.cases).toHaveLength(3);
    expect(draft.hidden_tests.cases[0]).toMatchObject({ name: 'adds positives', input: [2, 3], expected: 5 });
    expect(draft.hidden_tests.cases.every((c) => Array.isArray(c.input) && 'expected' in c && typeof c.visible === 'boolean')).toBe(true);
    expect(draft.hidden_tests.cases.filter((c) => c.visible).length).toBe(1);
    expect(draft.starter_files.some((f) => f.path === 'solution.js')).toBe(true);
    expect(draft.test_summary).toMatchObject({ kind: 'unit_function', case_count: 3 });
  });

  test('the generated cases pass a CORRECT solution and fail a WRONG one (via the real runCases harness)', async () => {
    mockModel(UNIT_FUNCTION_OUTPUT);
    const draft = await screenGen.generateFromJD({ jd: 'Backend billing engineer needed.', accountId: 'acct-1' });

    // Correct implementation -> every case passes (the reference agrees with the generated expecteds).
    expect(runCasesLocally(draft.hidden_tests, 'module.exports = (a, b) => a + b;\n').every(Boolean)).toBe(true);
    // Wrong implementation -> at least one case fails (the cases discriminate a wrong solution).
    expect(runCasesLocally(draft.hidden_tests, 'module.exports = () => 999;\n').some((p) => p === false)).toBe(true);
  });
});

describe('guardrails + degradation', () => {
  test('freeform output yields a markdown screen with no hidden tests', async () => {
    mockModel({
      title: 'Design a metrics pipeline',
      role: 'Staff Data Engineer',
      role_family: 'data',
      language: 'python',
      task_kind: 'freeform',
      task_markdown:
        'Design a daily revenue pipeline that is correct across timezone changes. Explain your approach, tradeoffs, and how you would monitor it. AI is allowed.',
      duration_minutes: 60,
      rubric: [
        { label: 'Correctness', points: 50, requirement: 'Handles tz edge cases' },
        { label: 'Monitoring plan', points: 50, requirement: 'Observability story' },
      ],
    });
    const draft = await screenGen.generateFromJD({ jd: 'Hiring a staff data engineer.', accountId: 'acct-1' });
    expect(draft.response_type).toBe('markdown');
    expect(draft.hidden_tests).toBeNull();
    expect(draft.test_summary.kind).toBe('none');
    expect(draft.rubric.reduce((s, r) => s + r.points, 0)).toBe(100);
  });

  test('spend ceiling -> SpendCeilingError (route maps to 429)', async () => {
    spendGuard.reserve.mockReturnValue({ ok: false, reason: 'account_daily_quota', remaining: 0 });
    await expect(
      screenGen.generateFromJD({ jd: 'A reasonably long job description here.', accountId: 'acct-1' })
    ).rejects.toMatchObject({ name: 'SpendCeilingError', reason: 'account_daily_quota' });
  });

  test('no Anthropic client -> AI_UNAVAILABLE (route maps to 503)', async () => {
    aiService.getLLM.mockReturnValue({ anthropic: null, model: 'x' });
    await expect(
      screenGen.generateFromJD({ jd: 'A reasonably long job description here.', accountId: 'acct-1' })
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });

  test('unparseable model output -> GENERATION_FAILED (route maps to 502)', async () => {
    mockModel('the model forgot to return json this time, sorry');
    await expect(
      screenGen.generateFromJD({ jd: 'A reasonably long job description here.', accountId: 'acct-1' })
    ).rejects.toMatchObject({ code: 'GENERATION_FAILED' });
  });
});

describe('generateFromRepo', () => {
  test('snippet input is tagged as a snippet generation', async () => {
    mockModel(UNIT_FUNCTION_OUTPUT);
    const draft = await screenGen.generateFromRepo({ snippet: 'export function add(a,b){return a+b}', accountId: 'acct-1' });
    expect(draft.input_kind).toBe('snippet');
    expect(draft.response_type).toBe('code');
  });
});

describe('normalizeRubric (unit)', () => {
  test('always sums to 100 with each criterion >= 1', () => {
    const out = screenGen.normalizeRubric([
      { label: 'a', points: 3 },
      { label: 'b', points: 1 },
      { label: 'c', points: 1 },
    ]);
    expect(out.reduce((s, r) => s + r.points, 0)).toBe(100);
    expect(out.every((r) => r.points >= 1)).toBe(true);
  });

  test('falls back to a default rubric when fewer than 2 criteria survive', () => {
    const out = screenGen.normalizeRubric([{ label: '', points: 10 }]);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.reduce((s, r) => s + r.points, 0)).toBe(100);
  });

  // Regression: the all-zero/negative-points branch must ALSO total exactly 100
  // (the old even-split left 3/6/7 criteria at 99/96/98).
  test.each([2, 3, 5, 6, 7])('all-zero points across %i criteria still sums to 100', (count) => {
    const rows = Array.from({ length: count }, (_, i) => ({ label: `c${i}`, points: 0 }));
    const out = screenGen.normalizeRubric(rows);
    expect(out.length).toBe(count);
    expect(out.reduce((s, r) => s + r.points, 0)).toBe(100);
    expect(out.every((r) => r.points >= 1)).toBe(true);
  });

  test('negative points are clamped and still total 100', () => {
    const out = screenGen.normalizeRubric([
      { label: 'a', points: -5 },
      { label: 'b', points: -1 },
      { label: 'c', points: -9 },
    ]);
    expect(out.reduce((s, r) => s + r.points, 0)).toBe(100);
    expect(out.every((r) => r.points >= 1)).toBe(true);
  });
});

describe('harness hardening (review fixes)', () => {
  test('a candidate cannot poison results by printing fake nonce-tagged PASS lines', async () => {
    mockModel(UNIT_FUNCTION_OUTPUT);
    const draft = await screenGen.generateFromJD({ jd: 'Backend billing engineer needed.', accountId: 'a' });
    // A WRONG solution that ALSO spews fake "##TS:...## PASS" lines with a GUESSED nonce. The real
    // harness tags each line with a per-run random nonce the candidate cannot know, so the parser
    // ignores the spoofed lines and the wrong solution still fails.
    const spoof =
      "for (let i = 0; i < 9; i++) console.log('##TS:guessednonce## ' + i + ' ## PASS ## 0');\nmodule.exports = () => 999;\n";
    expect(runCasesLocally(draft.hidden_tests, spoof).some((p) => p === false)).toBe(true);
  });

  test('a generated starter file named _runtests.js is filtered out (cannot shadow the harness)', async () => {
    mockModel({
      ...UNIT_FUNCTION_OUTPUT,
      starter_files: [
        { path: 'solution.js', content: 'module.exports = (a, b) => a;\n' },
        { path: '_runtests.js', content: 'console.log("999 passed");\n' },
      ],
    });
    const draft = await screenGen.generateFromJD({ jd: 'Backend billing engineer needed.', accountId: 'a' });
    expect(draft.starter_files.some((f) => f.path === '_runtests.js')).toBe(false);
    expect(draft.starter_files.some((f) => f.path === 'solution.js')).toBe(true);
  });
});

// S2 SSRF (v2-hardening): from-repo is SSRF-SAFE BY CONSTRUCTION — repo_url is a model
// SIGNAL ONLY and is never fetched server-side. This locks that property: even with a
// localhost / cloud-metadata URL, generateFromRepo must make NO outbound network egress.
describe('generateFromRepo — SSRF safety (repo_url is never fetched)', () => {
  const HOSTILE = [
    'http://127.0.0.1:6379/',
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://localhost:5432/',
    'file:///etc/passwd',
  ];

  test.each(HOSTILE)('does not fetch a hostile repo_url (%s)', async (repo_url) => {
    mockModel({ ...UNIT_FUNCTION_OUTPUT, title: 'From a repo signal' });
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const draft = await screenGen.generateFromRepo({ repo_url, language: 'javascript', accountId: 'a' });
      expect(draft).toBeTruthy(); // produced from the model signal, not a fetch
      // The hostile URL must NEVER be the target of an outbound fetch.
      for (const call of fetchSpy.mock.calls) {
        expect(String(call[0])).not.toContain('169.254.169.254');
        expect(String(call[0])).not.toContain('127.0.0.1');
        expect(String(call[0])).not.toContain('localhost');
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
