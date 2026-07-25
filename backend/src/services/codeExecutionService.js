/**
 * codeExecutionService — runs candidate code against a screen's hidden tests in an
 * ISOLATED E2B sandbox (a fresh microVM per run). Isolation is the whole point:
 * untrusted candidate code executes in E2B's VM, NEVER in our process, so it can
 * never read our env / service-role key. Disabled (no-op) when E2B_API_KEY is unset,
 * so the rest of the product keeps working without it.
 *
 * tests shape (stored on work_samples.tests):
 *   { command: string, files?: [{ path, content }], timeout_ms?: number }
 * The candidate's files + the test files are written into the sandbox and `command`
 * is run from the working dir. Exit code 0 = pass; we also best-effort parse a
 * "N passed / M failed" line from common runners (jest/pytest/node:test).
 */
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 60000;
const WORKDIR = '/home/user/work';

function isEnabled() {
  return Boolean(process.env.E2B_API_KEY);
}

// Resolve a candidate-supplied relative path safely INSIDE the sandbox workdir. The old single
// pass (`.replace(/\.\.(\/|\\)/g,'')`) was non-recursive and bypassable ("....//x" → "../x"), which
// matters now that candidates can POST arbitrary file paths to /run. Normalize the joined path and
// reject anything that escapes WORKDIR. Returns the absolute sandbox path, or null to skip.
function safeSandboxPath(rawPath) {
  const rel = String(rawPath || '').replace(/^\/+/, '');
  if (!rel) return null;
  const full = path.posix.normalize(`${WORKDIR}/${rel}`);
  return (full === WORKDIR || full.startsWith(`${WORKDIR}/`)) ? full : null;
}

function clip(s, n = 4000) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n) + '\n…(truncated)' : str;
}

async function runTests({ files = [], tests = {} } = {}) {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) return { available: false };
  if (!tests || !tests.command) return { available: true, ran: false, reason: 'no hidden tests configured' };

  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Number(tests.timeout_ms) || DEFAULT_TIMEOUT_MS);
  let sbx;
  try {
    const { Sandbox } = await import('e2b');
    sbx = await Sandbox.create({ apiKey });

    const writeAll = async (arr) => {
      for (const f of arr || []) {
        if (!f || !f.path) continue;
        // Resolve + confine to WORKDIR; skip anything that would escape the sandbox workdir.
        const full = safeSandboxPath(f.path);
        if (!full) continue;
        await sbx.files.write(full, String(f.content || ''));
      }
    };
    await writeAll(files);
    await writeAll(tests.files);

    const started = Date.now();
    let res;
    let timedOut = false;
    try {
      res = await sbx.commands.run(tests.command, { cwd: WORKDIR, timeoutMs });
    } catch (e) {
      // Non-zero exit throws in some SDK versions — capture it as a failing run. A timeout throws
      // without a real exit code; flag it so we can report "time limit exceeded" rather than a
      // generic error. Require a missing exit code for the message fallback so a normal failing run
      // that merely prints "timeout" isn't misclassified as a TLE.
      const msg = String(e?.message || e || '');
      timedOut = e?.name === 'TimeoutError' || (e?.exitCode == null && /timed?\s*out/i.test(msg));
      res = { exitCode: e.exitCode ?? (timedOut ? 124 : 1), stdout: e.stdout || '', stderr: e.stderr || msg };
    }
    const durationMs = Date.now() - started;
    const exitCode = typeof res.exitCode === 'number' ? res.exitCode : 1;
    const passed = exitCode === 0;
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    const pm = out.match(/(\d+)\s+pass(?:ed|ing)?/i);
    const fm = out.match(/(\d+)\s+fail(?:ed|ing)?/i);
    const passedCount = pm ? Number(pm[1]) : passed ? 1 : 0;
    const failedCount = fm ? Number(fm[1]) : passed ? 0 : 1;
    // Coarse verdict so the UI can show "Time limit exceeded" / error vs success distinctly.
    const verdict = timedOut ? 'time_limit' : passed ? 'ok' : 'error';

    return {
      available: true,
      ran: true,
      passed,
      exitCode,
      verdict,
      timedOut,
      passedCount,
      failedCount,
      total: passedCount + failedCount,
      durationMs,
      // `clip` length is overridable so the per-case runner can recover all ##TS## marker lines.
      stdout: clip(res.stdout, tests.clip || 4000),
      stderr: clip(res.stderr, tests.clip || 4000),
    };
  } catch (e) {
    // Sandbox provisioning / SDK error — surface as "couldn't run", never throw.
    return { available: true, ran: false, error: String(e && e.message ? e.message : e) };
  } finally {
    try {
      if (sbx) await sbx.kill();
    } catch {
      /* ignore */
    }
  }
}

// --- Run a candidate's PROGRAM directly (no hidden tests) so they get IDE-style stdout. ---
// Used when a screen has no hidden tests: instead of "nothing runs", we execute their entry
// file in the same isolated E2B microVM and return stdout/stderr so console.log shows up.
// Same isolation guarantees as runTests (untrusted code never touches our process).
const SAFE_ENTRY = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

// Candidate-chosen language → the entry-file extension we prefer when picking what to run.
const LANG_ENTRY_EXT = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  go: 'go',
  rust: 'rs',
  ruby: 'rb',
  php: 'php',
};

// Choose a sensible entry file: the language's preferred extension first, then a conventional
// name, then the first runnable file.
function pickEntry(list, preferExt) {
  const byName = (re) => list.find((f) => re.test(f.path));
  const chosen =
    (preferExt && list.find((f) => f.path.toLowerCase().endsWith(`.${preferExt}`))) ||
    byName(/(^|\/)(main|solution|index|app)\.(mjs|cjs|js|py|ts|java|cpp|cc|cxx|c|go|rs|rb|php)$/i) ||
    byName(/\.(mjs|cjs|js)$/) ||
    byName(/\.py$/) ||
    byName(/\.ts$/) ||
    byName(/\.(java|cpp|cc|cxx|c|go|rs|rb|php)$/i) ||
    list[0];
  return chosen ? chosen.path : null;
}

// Build the run command for an entry file. Returns null for an unsafe path or unsupported type.
// Compiled languages compile-then-run in the same disposable VM. (The path is also confined to
// WORKDIR on write; this is defense-in-depth — the code already runs inside a disposable VM, so
// this is not the security boundary. The entry path is SAFE_ENTRY-validated, so no shell metachars.)
function entryRunCommand(entry) {
  const p = String(entry || '');
  if (!SAFE_ENTRY.test(p) || p.includes('..')) return null;
  const out = '/tmp/ts_run';
  if (/\.py$/.test(p)) return `python3 ${p}`;
  if (/\.ts$/.test(p)) return `npx --yes tsx ${p}`;
  if (/\.(mjs|cjs|js)$/.test(p)) return `node ${p}`;
  if (/\.java$/.test(p)) {
    const cls = path.posix.basename(p).replace(/\.java$/, '');
    return `javac -d . ${p} && java ${cls}`;
  }
  if (/\.(cpp|cc|cxx)$/.test(p)) return `g++ -O2 -std=c++17 -o ${out} ${p} && ${out}`;
  if (/\.c$/.test(p)) return `gcc -O2 -o ${out} ${p} && ${out}`;
  if (/\.go$/.test(p)) return `go run ${p}`;
  if (/\.rs$/.test(p)) return `rustc -O -o ${out} ${p} && ${out}`;
  if (/\.rb$/.test(p)) return `ruby ${p}`;
  if (/\.php$/.test(p)) return `php ${p}`;
  return null;
}

async function runProgram({ files = [], entry = null, language = null, stdin = null } = {}) {
  if (!process.env.E2B_API_KEY) return { available: false };
  const list = (files || []).filter((f) => f && typeof f.path === 'string');
  if (!list.length) return { available: true, ran: false, reason: 'no code to run' };
  const preferExt = language ? LANG_ENTRY_EXT[String(language).toLowerCase()] : null;
  const chosen = entry && list.some((f) => f.path === entry) ? entry : pickEntry(list, preferExt);
  const command = entryRunCommand(chosen);
  if (!command) {
    return { available: true, ran: false, reason: `can't run "${chosen || 'this file'}" directly — supported: JS/TS, Python, Java, C/C++, Go, Rust, Ruby, PHP` };
  }
  // Optional custom stdin: write it to a workdir file and redirect the RUN command's input from it.
  // `cmd < <name>` binds the redirect to the LAST command in an `a && b` compile-then-run chain
  // (i.e. the program, not the compiler) — exactly what we want. Pick a dot-prefixed scratch name
  // that does NOT collide with any candidate file, so we never clobber their code.
  const hasStdin = typeof stdin === 'string' && stdin.length > 0;
  const taken = new Set(list.map((f) => f.path));
  let stdinPath = '.ts_stdin';
  for (let i = 0; taken.has(stdinPath); i++) stdinPath = `.ts_stdin_${i}`;
  const finalCommand = hasStdin ? `${command} < ${stdinPath}` : command;
  const testFiles = hasStdin ? [{ path: stdinPath, content: String(stdin).slice(0, 100000) }] : undefined;
  // Reuse runTests' sandbox plumbing by running the program as a single command, then re-shape:
  // a program run is exit-code + output, not pass/fail tests. Compiled languages (javac/g++/rustc)
  // need headroom for the compile step on top of execution.
  const r = await runTests({ files: list, tests: { command: finalCommand, files: testFiles, timeout_ms: 30000 } });
  if (!r || r.ran !== true) return r;
  return {
    available: true,
    ran: true,
    mode: 'program',
    entry: chosen,
    exitCode: r.exitCode,
    verdict: r.verdict,
    timedOut: r.timedOut,
    durationMs: r.durationMs,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-case test runner (LeetCode-style). A screen's `tests` may be the structured
// form: { kind:'cases', language:'python'|'node', entry_file, entry_fn, timeout_ms,
//         cases:[{ name, visible, input:[...args], expected }] }
// We GENERATE a harness that runs each case against the candidate's entry function,
// deep-compares the return value to `expected`, and prints ONE line per case tagged
// with a per-run random NONCE, plus an END sentinel carrying the emitted-marker count.
// SECURITY (out-of-process execution): the harness is a PARENT process that holds the
// nonce and emits ALL markers itself. The candidate module is imported only in a CHILD
// process (`.ts_child.py` / `.ts_child.js`) that receives case inputs as JSON lines on
// stdin and replies with raw JSON results on its stdout, which the parent captures as
// DATA (never echoed to its own stdout; child stderr is discarded). The child never
// sees the nonce or any `expected` value, and the parent deletes its own harness file
// before the first spawn so neither is readable off disk. Candidate top-level code
// therefore runs where forged ##TS## markers cannot reach the real stdout stream, an
// os._exit(0)/process.exit(0) kills only the child (the case FAILs and the parent
// re-spawns for the remaining cases), and a per-case wall-clock timeout in the parent
// kills a hung child (case FAILs, run continues; the E2B command timeout remains the
// whole-run backstop). The stdout parser (runCases) keeps its integrity checks:
// exactly one marker per case index, one END sentinel with a matching count,
// violations FAIL the affected cases and set spoof_suspected.
// The hidden cases' input/expected NEVER reach the candidate's sandbox in 'sample'
// mode, and are redacted by the caller for hidden results. The harness file itself
// only contains the cases being run, so in 'sample' mode there's nothing for the
// candidate to read to learn the hidden inputs.
// ─────────────────────────────────────────────────────────────────────────────

function isCaseTests(tests) {
  return tests && tests.kind === 'cases' && Array.isArray(tests.cases) && tests.cases.length > 0;
}

// Normalize a tests-language hint to the two harness families we can actually grade.
function normalizeCaseLang(l) {
  const s = String(l || '').toLowerCase();
  if (s === 'node' || s === 'javascript' || s === 'js') return 'node';
  if (s === 'python' || s === 'py' || s === 'python3') return 'python';
  return null;
}

// A screen may allow MORE than one graded language (tests.languages, e.g. ['node','python']):
// the cases are language-agnostic JSON in/out, so the same suite grades either. Pick the harness
// by which supported entry file the candidate actually submitted (solution.js vs solution.py);
// fall back to the screen's primary language. Single-language screens (no tests.languages) keep
// the exact legacy behavior.
function resolveCaseTarget(tests, files) {
  const declared = Array.isArray(tests.languages) && tests.languages.length
    ? tests.languages
    : [tests.language || 'python'];
  const langs = [...new Set(declared.map(normalizeCaseLang).filter(Boolean))];
  const primary = normalizeCaseLang(tests.language) || langs[0] || 'python';
  const base = String(tests.entry_file || 'solution.js').replace(/\.(js|py)$/i, '');
  const entryFor = (lang) => `${base}.${lang === 'node' ? 'js' : 'py'}`;
  if (langs.length > 1) {
    for (const lang of langs) {
      if ((files || []).some((f) => f && f.path === entryFor(lang))) {
        return { language: lang, entryFile: entryFor(lang) };
      }
    }
  }
  return { language: primary, entryFile: tests.entry_file || entryFor(primary) };
}

// base64 the case data so arbitrary JSON (unicode, quotes, nulls) embeds safely in the harness source.
function b64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function buildPyHarness(entryFile, entryFn, cases, nonce) {
  const data = b64(cases.map((c) => ({ input: c.input, expected: c.expected, compare_mode: c.compare_mode || 'exact' })));
  // Child runner: imports the candidate module and evaluates one case per stdin line, replying
  // with a raw JSON result line on stdout. It contains NO nonce and NO expected values — the
  // parent sends only case inputs and does all comparison + marker emission itself. A forged
  // result line from candidate code is therefore no more powerful than returning that value.
  const childSrc = `import json, sys, importlib.util
try:
    spec = importlib.util.spec_from_file_location("ts_solution", ${JSON.stringify(entryFile)})
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    fn = getattr(mod, ${JSON.stringify(entryFn)})
    print(json.dumps({"ready": True}), flush=True)
except Exception as e:
    print(json.dumps({"load_error": str(e)}), flush=True)
    sys.exit(0)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except Exception:
        continue
    try:
        got = fn(*msg.get("args", []))
        try:
            out = json.dumps({"i": msg.get("i"), "ok": True, "got": got})
        except Exception:
            out = json.dumps({"i": msg.get("i"), "ok": False, "error": "unserializable result: " + repr(got)[:200]})
    except Exception as e:
        out = json.dumps({"i": msg.get("i"), "ok": False, "error": str(e)})
    print(out, flush=True)
`;
  // Layer-1 canonicalization ladder (rescue-only): exact first, else a per-case tolerant compare
  // (float epsilon / order-agnostic multiset / whitespace-trim / key-order-independent objects).
  // Only ever turns a FAIL into a PASS_NORM; never a PASS into a FAIL. Python `==` already ignores
  // dict key order, so the gains here are float, list-order and whitespace. Evaluated in the
  // PARENT on the JSON-transported `got` (so e.g. a tuple return arrives as a list, which
  // _deep_eq already treated as equivalent).
  return `import json, base64, os, subprocess, sys, threading, queue, time, math
NONCE = ${JSON.stringify(nonce)}
CASES = json.loads(base64.b64decode(${JSON.stringify(data)}).decode("utf-8"))
CHILD_PATH = ".ts_child.py"
CASE_TIMEOUT = 5.0

def _num_eq(a, b):
    try:
        a = float(a); b = float(b)
    except Exception:
        return a == b
    if math.isnan(a) or math.isnan(b):
        return math.isnan(a) and math.isnan(b)
    return abs(a - b) <= max(1e-9, 1e-9 * max(abs(a), abs(b)))

def _deep_eq(a, b, floats, unordered):
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return _num_eq(a, b) if floats else a == b
    if isinstance(a, str) and isinstance(b, str):
        return a.strip() == b.strip()
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return False
        if not unordered:
            return all(_deep_eq(x, y, floats, unordered) for x, y in zip(a, b))
        used = [False] * len(b)
        for x in a:
            j = next((k for k in range(len(b)) if not used[k] and _deep_eq(x, b[k], floats, unordered)), -1)
            if j < 0:
                return False
            used[j] = True
        return True
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_deep_eq(a[k], b[k], floats, unordered) for k in a)
    return a == b

def _norm_eq(got, expected, mode):
    if mode == 'float-eps':
        return _deep_eq(got, expected, True, False)
    if mode in ('multiset', 'unordered-json'):
        return _deep_eq(got, expected, True, True)
    return _deep_eq(got, expected, False, False)

def emit(i, method, got):
    try: s = json.dumps(got, default=str)
    except Exception: s = str(got)
    if len(s) > 240: s = s[:240] + "..."
    print(f"##TS:{NONCE}## {i} ## {method} ## " + s, flush=True)

with open(CHILD_PATH, "w") as f:
    f.write(base64.b64decode(${JSON.stringify(Buffer.from(childSrc, 'utf8').toString('base64'))}).decode("utf-8"))
try:
    os.remove(__file__)  # nonce + expected values must never be readable off disk by the child
except Exception:
    pass

child = None
lines = None
load_failed = None

def _spawn():
    p = subprocess.Popen([sys.executable, CHILD_PATH], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    q = queue.Queue()
    def _pump():
        for ln in p.stdout:
            q.put(ln)
        q.put(None)
    threading.Thread(target=_pump, daemon=True).start()
    return p, q

def _kill():
    global child
    if child is not None:
        try: child.kill()
        except Exception: pass
    child = None

# Next JSON dict line from the child before the deadline; anything the candidate prints that
# isn't a JSON object is candidate noise — skipped, never re-emitted.
def _read_json(deadline):
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            return "timeout", None
        try:
            ln = lines.get(timeout=left)
        except queue.Empty:
            return "timeout", None
        if ln is None:
            return "eof", None
        try:
            obj = json.loads(ln)
        except Exception:
            continue
        if isinstance(obj, dict):
            return "ok", obj

# Spawn (or re-spawn after a crash) and wait for the child's ready line. A load failure is
# permanent for the run — every remaining case FAILs with the reason, no useless re-spawns.
def _ensure_child():
    global child, lines, load_failed
    if load_failed is not None:
        return False
    if child is not None and child.poll() is None:
        return True
    child, lines = _spawn()
    deadline = time.monotonic() + CASE_TIMEOUT
    while True:
        status, obj = _read_json(deadline)
        if status == "ok" and obj.get("ready") is True:
            return True
        if status == "ok" and "load_error" in obj:
            load_failed = "load error: " + str(obj["load_error"])
            _kill(); return False
        if status == "ok":
            continue
        load_failed = "load error: candidate process " + ("timed out" if status == "timeout" else "exited") + " during import"
        _kill(); return False

for i, c in enumerate(CASES):
    try:
        if not _ensure_child():
            emit(i, "FAIL", load_failed)
            continue
        try:
            child.stdin.write(json.dumps({"i": i, "args": c["input"]}) + "\\n")
            child.stdin.flush()
        except Exception:
            _kill(); emit(i, "FAIL", "candidate process exited"); continue
        deadline = time.monotonic() + CASE_TIMEOUT
        res = None
        while True:
            status, obj = _read_json(deadline)
            if status == "timeout":
                _kill(); emit(i, "FAIL", "time limit exceeded"); break
            if status == "eof":
                _kill(); emit(i, "FAIL", "candidate process exited before returning"); break
            if obj.get("i") != i:
                continue
            res = obj; break
        if res is None:
            continue
        if res.get("ok"):
            got = res.get("got")
            if got == c["expected"]:
                emit(i, "PASS", got)
            elif _norm_eq(got, c["expected"], c.get("compare_mode", "exact")):
                emit(i, "PASS_NORM", got)
            else:
                emit(i, "FAIL", got)
        else:
            emit(i, "FAIL", "ERROR: " + str(res.get("error")))
    except Exception as e:
        # one-marker-per-case discipline even on a harness bug: never skip, never double-emit
        _kill(); emit(i, "FAIL", "harness error: " + str(e))
print(f"##TS:{NONCE}## END ## {len(CASES)}", flush=True)
_kill()
`;
}

function buildNodeHarness(entryFile, entryFn, cases, nonce) {
  const data = b64(cases.map((c) => ({ input: c.input, expected: c.expected, compare_mode: c.compare_mode || 'exact' })));
  // Child runner: requires the candidate module and evaluates one case per stdin line, replying
  // with a raw JSON result line on stdout. It contains NO nonce and NO expected values — the
  // parent sends only case inputs and does all comparison + marker emission itself. A forged
  // result line from candidate code is therefore no more powerful than returning that value.
  const childSrc = `const readline = require("readline");
let fn;
try {
  const m = require(${JSON.stringify('./' + entryFile)});
  fn = (typeof m === "function") ? m : (m[${JSON.stringify(entryFn)}] || m.default);
  if (typeof fn !== "function") throw new Error("no function '" + ${JSON.stringify(entryFn)} + "' exported from " + ${JSON.stringify(entryFile)});
  console.log(JSON.stringify({ ready: true }));
} catch (e) {
  console.log(JSON.stringify({ load_error: String((e && e.message) || e) }));
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  if (!msg || typeof msg !== "object") return;
  let out;
  try {
    const got = fn(...(msg.args || []));
    try { out = JSON.stringify({ i: msg.i, ok: true, got: got }); }
    catch (e) { out = JSON.stringify({ i: msg.i, ok: false, error: "unserializable result" }); }
  } catch (e) {
    out = JSON.stringify({ i: msg.i, ok: false, error: String((e && e.message) || e) });
  }
  console.log(out);
});
`;
  // Layer-1 canonicalization ladder (rescue-only): exact (JSON.stringify) first, else a per-case
  // tolerant compare. This fixes the big live false-negative source here — JSON.stringify equality
  // is BOTH key-insertion-order and list-order sensitive — plus float/whitespace. Only ever turns a
  // FAIL into a PASS_NORM; never a PASS into a FAIL. Evaluated in the PARENT on the
  // JSON-transported `got` (a lossless round-trip for anything JSON.stringify-comparable).
  return `const NONCE = ${JSON.stringify(nonce)};
const CASES = JSON.parse(Buffer.from(${JSON.stringify(data)}, "base64").toString("utf8"));
const CHILD_PATH = ".ts_child.js";
const CASE_TIMEOUT_MS = 5000;
const fs = require("fs");
const { spawn } = require("child_process");
function strictEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function numEq(a, b) { return Math.abs(a - b) <= Math.max(1e-9, 1e-9 * Math.max(Math.abs(a), Math.abs(b))); }
function deepEq(a, b, floats, unordered) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return floats ? numEq(a, b) : a === b;
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (!unordered) return a.every((x, i) => deepEq(x, b[i], floats, unordered));
    const used = new Array(b.length).fill(false);
    return a.every((x) => { const j = b.findIndex((y, k) => !used[k] && deepEq(x, y, floats, unordered)); if (j < 0) return false; used[j] = true; return true; });
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k], floats, unordered));
  }
  return false;
}
function normEq(got, expected, mode) {
  if (mode === "float-eps") return deepEq(got, expected, true, false);
  if (mode === "multiset" || mode === "unordered-json") return deepEq(got, expected, true, true);
  return deepEq(got, expected, false, false);
}
function emit(i, method, got) {
  let s; try { s = JSON.stringify(got); } catch (e) { s = String(got); }
  if (s === undefined) s = "undefined";
  if (s.length > 240) s = s.slice(0, 240) + "...";
  console.log("##TS:" + NONCE + "## " + i + " ## " + method + " ## " + s);
}

fs.writeFileSync(CHILD_PATH, Buffer.from(${JSON.stringify(Buffer.from(childSrc, 'utf8').toString('base64'))}, "base64").toString("utf8"));
try { fs.unlinkSync(__filename); } catch (e) {} // nonce + expected values must never be readable off disk by the child

const TIMEOUT = Symbol("timeout");
function startChild() {
  const p = spawn(process.execPath, [CHILD_PATH], { stdio: ["pipe", "pipe", "ignore"] });
  p.stdin.on("error", () => {}); // EPIPE when the child dies mid-write: handled via EOF below
  const items = []; const waits = [];
  const push = (x) => { const w = waits.shift(); if (w) w(x); else items.push(x); };
  let buf = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\\n")) >= 0) { push(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  });
  p.on("close", () => push(null));
  const next = (ms) => items.length
    ? Promise.resolve(items.shift())
    : new Promise((resolve) => {
        const w = (x) => { clearTimeout(t); resolve(x); };
        const t = setTimeout(() => { const k = waits.indexOf(w); if (k >= 0) waits.splice(k, 1); resolve(TIMEOUT); }, Math.max(0, ms));
        waits.push(w);
      });
  return { p, next };
}
// Next JSON object line from the child before the deadline; anything the candidate prints that
// isn't a JSON object is candidate noise — skipped, never re-emitted.
async function readJson(child, deadline) {
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return { status: "timeout" };
    const line = await child.next(left);
    if (line === TIMEOUT) return { status: "timeout" };
    if (line === null) return { status: "eof" };
    let obj; try { obj = JSON.parse(line); } catch (e) { continue; }
    if (obj && typeof obj === "object") return { status: "ok", obj: obj };
  }
}
(async () => {
  let child = null;
  let loadFailed = null;
  const kill = () => { if (child) { try { child.p.kill("SIGKILL"); } catch (e) {} } child = null; };
  // Spawn (or re-spawn after a crash) and wait for the child's ready line. A load failure is
  // permanent for the run — every remaining case FAILs with the reason, no useless re-spawns.
  async function ensureChild() {
    if (loadFailed !== null) return false;
    if (child && child.p.exitCode === null && !child.p.killed) return true;
    child = startChild();
    const deadline = Date.now() + CASE_TIMEOUT_MS;
    for (;;) {
      const r = await readJson(child, deadline);
      if (r.status === "ok" && r.obj.ready === true) return true;
      if (r.status === "ok" && "load_error" in r.obj) { loadFailed = "load error: " + r.obj.load_error; kill(); return false; }
      if (r.status === "ok") continue;
      loadFailed = "load error: candidate process " + (r.status === "timeout" ? "timed out" : "exited") + " during import";
      kill(); return false;
    }
  }
  for (let i = 0; i < CASES.length; i++) {
    try {
      if (!(await ensureChild())) { emit(i, "FAIL", loadFailed); continue; }
      try { child.p.stdin.write(JSON.stringify({ i: i, args: CASES[i].input }) + "\\n"); } catch (e) {}
      const deadline = Date.now() + CASE_TIMEOUT_MS;
      let res = null;
      for (;;) {
        const r = await readJson(child, deadline);
        if (r.status === "timeout") { kill(); emit(i, "FAIL", "time limit exceeded"); break; }
        if (r.status === "eof") { kill(); emit(i, "FAIL", "candidate process exited before returning"); break; }
        if (r.obj.i !== i) continue;
        res = r.obj; break;
      }
      if (!res) continue;
      if (res.ok) {
        const got = res.got;
        if (strictEq(got, CASES[i].expected)) emit(i, "PASS", got);
        else if (normEq(got, CASES[i].expected, CASES[i].compare_mode || "exact")) emit(i, "PASS_NORM", got);
        else emit(i, "FAIL", got);
      } else {
        emit(i, "FAIL", "ERROR: " + res.error);
      }
    } catch (e) {
      // one-marker-per-case discipline even on a harness bug: never skip, never double-emit
      kill(); emit(i, "FAIL", "harness error: " + ((e && e.message) || e));
    }
  }
  console.log("##TS:" + NONCE + "## END ## " + CASES.length);
  kill();
  process.exit(0);
})();
`;
}

// Build { command, files:[harness] } for a set of cases in a given language.
function buildHarness(language, entryFile, entryFn, cases, nonce) {
  const lang = String(language || 'python').toLowerCase();
  const isNode = lang === 'node' || lang === 'javascript' || lang === 'js';
  const harnessPath = isNode ? '.ts_harness.js' : '.ts_harness.py';
  const content = isNode
    ? buildNodeHarness(entryFile, entryFn, cases, nonce)
    : buildPyHarness(entryFile, entryFn, cases, nonce);
  const command = isNode ? `node ${harnessPath}` : `python3 ${harnessPath}`;
  return { harnessPath, content, command };
}

// Run a screen's structured test cases. mode:'sample' runs only the visible cases (so hidden
// inputs never enter the candidate's interactive sandbox); mode:'all' runs everything (submit /
// recruiter). Returns per-case { name, visible, passed, got, input, expected }. The CALLER is
// responsible for redacting hidden cases' input/expected/got before sending them to a candidate.
async function runCases({ files = [], tests = {}, mode = 'all' } = {}) {
  if (!process.env.E2B_API_KEY) return { available: false };
  if (!isCaseTests(tests)) return { available: true, ran: false, reason: 'no test cases configured' };
  const { language, entryFile } = resolveCaseTarget(tests, files);
  const entryFn = tests.entry_fn || 'solve';
  const runSet = mode === 'sample' ? tests.cases.filter((c) => c.visible) : tests.cases;
  if (!runSet.length) return { available: true, ran: true, kind: 'cases', cases: [], passedCount: 0, failedCount: 0, total: 0, verdict: 'ok' };

  const nonce = crypto.randomBytes(6).toString('hex');
  const { harnessPath, content, command } = buildHarness(language, entryFile, entryFn, runSet, nonce);
  const r = await runTests({
    files,
    tests: { command, files: [{ path: harnessPath, content }], timeout_ms: tests.timeout_ms || 15000, clip: 40000 },
  });
  if (!r || r.ran !== true) return { available: r?.available !== false, ran: false, kind: 'cases', cases: [], reason: r?.reason, error: r?.error, timedOut: r?.timedOut };

  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const re = new RegExp(`##TS:${nonce}## (\\d+) ## (PASS|PASS_NORM|FAIL) ## (.*)$`);
  const endRe = new RegExp(`##TS:${nonce}## END ## (\\d+)\\s*$`);
  const parsed = {};
  const dupes = new Set();
  let endSeen = 0;
  let endCount = null;
  let spoofSuspected = false;
  for (const line of text.split('\n')) {
    const em = line.match(endRe);
    if (em) { endSeen += 1; endCount = Number(em[1]); continue; }
    const m = line.match(re);
    if (!m) continue;
    const idx = Number(m[1]);
    // A marker for an index outside the run set can only be forged: the harness never emits one.
    if (idx >= runSet.length) { spoofSuspected = true; continue; }
    if (parsed[idx]) { dupes.add(idx); continue; }
    parsed[idx] = { method: m[2], got: m[3] };
  }
  // Integrity checks (partial anti-spoof hardening; see the header comment above buildPyHarness).
  // An honest run emits EXACTLY one marker per case plus ONE END sentinel whose count equals the
  // markers we accepted. A duplicated index means at least one forged line, so that case cannot be
  // trusted: FAIL it. A missing/duplicated END sentinel or a count mismatch means the process
  // exited before the real loop finished (early-exit forge) or extra lines were injected: the
  // unseen cases FAIL below (no accepted marker => passed:false, never a silent skip) and the run
  // is flagged. A timeout legitimately kills the run before END, so END checks are skipped then.
  for (const idx of dupes) { delete parsed[idx]; }
  if (dupes.size > 0) spoofSuspected = true;
  if (!r.timedOut && (endSeen !== 1 || endCount !== Object.keys(parsed).length)) spoofSuspected = true;
  const cases = runSet.map((c, i) => {
    const p = parsed[i];
    // PASS (exact) and PASS_NORM (canonicalized rescue) both count as passed. pass_method is retained
    // so the score path can compute rawExact vs adjudicated ratios and surface how each case passed.
    const method = p ? p.method : dupes.has(i) ? 'spoof_suspected' : (r.timedOut ? 'time_limit' : 'no_output');
    return {
      name: c.name || `Test ${i + 1}`,
      visible: !!c.visible,
      passed: method === 'PASS' || method === 'PASS_NORM',
      pass_method: method,
      compare_mode: c.compare_mode || 'exact',
      got: p ? p.got : dupes.has(i) ? 'conflicting result lines (spoof suspected)' : (r.timedOut ? 'time limit exceeded' : 'no output'),
      input: c.input,
      expected: c.expected,
    };
  });
  const passedCount = cases.filter((c) => c.passed).length;
  const exactPassCount = cases.filter((c) => c.pass_method === 'PASS').length;
  return {
    available: true, ran: true, kind: 'cases', cases,
    passedCount, exactPassCount, failedCount: cases.length - passedCount, total: cases.length,
    spoof_suspected: spoofSuspected,
    verdict: r.timedOut ? 'time_limit' : spoofSuspected ? 'error' : passedCount === cases.length ? 'ok' : 'error',
    timedOut: !!r.timedOut, durationMs: r.durationMs,
  };
}

// Redact a runCases result for a CANDIDATE: hidden cases keep only name + pass/fail (no input,
// expected, or got), and get a generic name so the hidden data isn't inferable.
function redactCasesForCandidate(result) {
  if (!result || !Array.isArray(result.cases)) return result;
  let hiddenIdx = 0;
  const cases = result.cases.map((c) => {
    if (c.visible) return c;
    hiddenIdx += 1;
    return { name: `Hidden test ${hiddenIdx}`, visible: false, passed: c.passed };
  });
  return { ...result, cases };
}

module.exports = { isEnabled, runTests, runProgram, runCases, isCaseTests, redactCasesForCandidate, buildHarness, safeSandboxPath, resolveCaseTarget };
