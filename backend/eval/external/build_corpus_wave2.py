#!/usr/bin/env python3
"""
build_corpus_wave2.py — Wave-2 execution-truth corpus (n>=200, SUBTLE negatives).
----------------------------------------------------------------------------------
Wave-1 (build_corpus.py) showed regex mutants are too easy: every grader hit 100%
precision, so models could only be separated on recall. Wave-2 fixes that with:
  • ~100 POSITIVES: HumanEval canonical solutions, each execution-VERIFIED to pass
    its full test suite (we run the tests, we never trust labels).
  • ~100 SUBTLE NEGATIVES, each execution-verified to FAIL >=1 assert AND PASS >=1
    assert (plausible-but-wrong, not garbage):
      a) AST-level semantic mutants: slice/range off-by-one, min/max swap, wrong
         initial accumulator, boundary comparison flips (< vs <=), dropped
         early-return guards, float rounding direction (floor/ceil, int/round),
         sorted key/reverse misuse, += overwritten by =, dropped abs().
      b) Optional LLM plausible-wrong rewrites via the Azure shim creds in
         backend/.env (gpt-5.4-mini): "introduce ONE subtle logic bug"; capped at
         W2_LLM_CALL_CAP real API calls, responses cached, every rewrite
         execution-verified like the mutants.
All programs (positives AND negatives) are normalized through ast.parse+unparse so
style is identical across labels (no comment/formatting tells for the grader).
Per-assert pass/fail counts come from an AST-instrumented copy of HumanEval's own
check(): every `assert` is wrapped in try/except counters, run in a subprocess.

Dependency-free (stdlib only). Deterministic given the same seed + cached LLM
responses. Non-circular for the AST path; the LLM path is verified by execution,
never by another model.

Untrusted-code note: same stance as Wave-1 — only canonical solutions, derived
mutants, and reviewed-model rewrites of canonical code run here, each in a
subprocess with a timeout. Not a sandbox for arbitrary completions.

Usage:
  python3 backend/eval/external/build_corpus_wave2.py
  W2_SKIP_LLM=1 python3 backend/eval/external/build_corpus_wave2.py   # AST mutants only
Env knobs: W2_POS=100 W2_NEG=100 W2_SEED=42 W2_MAX_PER_TASK=2 W2_TRIES_PER_TASK=10
           W2_LLM_TARGET=30 W2_LLM_CALL_CAP=40 CORPUS_TIMEOUT=10
Outputs: corpus-wave2.jsonl (rows: task_id, entry_point, program, execution_truth,
         source, mutation) + corpus-wave2.report.json + one summary line on stdout.
"""
import ast
import gzip
import json
import os
import re
import subprocess
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from random import Random

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "HumanEval.jsonl.gz")
OUT = os.path.join(HERE, "corpus-wave2.jsonl")
REPORT = os.path.join(HERE, "corpus-wave2.report.json")
LLM_CACHE = os.path.join(HERE, ".wave2-llm-cache.json")
ENV_FILE = os.path.join(HERE, "..", "..", ".env")
URL = "https://github.com/openai/human-eval/raw/master/data/HumanEval.jsonl.gz"

SEED = int(os.environ.get("W2_SEED", "42"))
POS_TARGET = int(os.environ.get("W2_POS", "100"))
NEG_TARGET = int(os.environ.get("W2_NEG", "100"))
MAX_PER_TASK = int(os.environ.get("W2_MAX_PER_TASK", "2"))
TRIES_PER_TASK = int(os.environ.get("W2_TRIES_PER_TASK", "10"))
LLM_TARGET = int(os.environ.get("W2_LLM_TARGET", "30"))
LLM_CALL_CAP = int(os.environ.get("W2_LLM_CALL_CAP", "40"))
SKIP_LLM = os.environ.get("W2_SKIP_LLM") == "1"
TIMEOUT = int(os.environ.get("CORPUS_TIMEOUT", "10"))
WORKERS = min(12, os.cpu_count() or 4)


# ---------------------------------------------------------------------------
# Execution harness: per-assert pass/fail counting
# ---------------------------------------------------------------------------

def _bump(key):
    return ast.parse(f"_W2C['{key}'] += 1").body[0]


class AssertCounter(ast.NodeTransformer):
    """Wrap every assert so one failure doesn't hide the rest: we need to know a
    negative both FAILS >=1 and PASSES >=1 assert (subtle, not garbage)."""

    def visit_Assert(self, node):
        return ast.copy_location(
            ast.Try(
                body=[node, _bump("passed")],
                handlers=[ast.ExceptHandler(
                    type=ast.Name(id="Exception", ctx=ast.Load()), name=None,
                    body=[_bump("failed")])],
                orelse=[], finalbody=[],
            ), node)


def run_counted(program, test_src, entry):
    """Run HumanEval's check() with instrumented asserts. Returns (passed, failed)
    or None when the run is unusable (crash outside an assert, timeout, no marker)."""
    try:
        ttree = AssertCounter().visit(ast.parse(test_src))
        ast.fix_missing_locations(ttree)
        src = "\n".join([
            program,
            "\nimport json as _w2json\n_W2C = {'passed': 0, 'failed': 0}\n",
            ast.unparse(ttree),
            f"\ncheck({entry})\nprint('W2RESULT ' + _w2json.dumps(_W2C))\n",
        ])
        r = subprocess.run([sys.executable, "-c", src], capture_output=True,
                           timeout=TIMEOUT, text=True)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    for line in r.stdout.splitlines():
        if line.startswith("W2RESULT "):
            c = json.loads(line[len("W2RESULT "):])
            return c["passed"], c["failed"]
    return None


# ---------------------------------------------------------------------------
# AST mutators — one mutation site per generated candidate
# ---------------------------------------------------------------------------

def _fold_add(expr, delta):
    """expr ± 1 with constant folding so `a[:-1]` becomes `a[:-2]`, not `a[:-1 - 1]`."""
    if isinstance(expr, ast.Constant) and type(expr.value) is int:
        return ast.Constant(expr.value + delta)
    if (isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.USub)
            and isinstance(expr.operand, ast.Constant) and type(expr.operand.value) is int):
        return ast.Constant(-expr.operand.value + delta)
    op = ast.Add() if delta > 0 else ast.Sub()
    return ast.BinOp(left=expr, op=op, right=ast.Constant(abs(delta)))


class Mutator(ast.NodeTransformer):
    name = "base"

    def __init__(self, target=None):
        self.target = target  # site index to mutate; None = count-only pass
        self.sites = 0

    def take(self):
        i = self.sites
        self.sites += 1
        return self.target is not None and i == self.target


class CmpBoundary(Mutator):
    """< vs <= (and > vs >=): off-by-one at boundaries, NOT Wave-1's gross < -> >."""
    name = "cmp_boundary"
    SWAP = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt}

    def visit_Compare(self, node):
        self.generic_visit(node)
        node.ops = [self.SWAP[type(op)]() if type(op) in self.SWAP and self.take() else op
                    for op in node.ops]
        return node


class SliceBound(Mutator):
    name = "slice_bound"

    def visit_Subscript(self, node):
        self.generic_visit(node)
        sl = node.slice
        if isinstance(sl, ast.Slice):
            if sl.upper is not None:
                if self.take():
                    sl.upper = _fold_add(sl.upper, -1)
            elif self.take():
                sl.upper = ast.Constant(-1)  # a[i:] -> a[i:-1]: drops last element
            if sl.lower is not None:
                if self.take():
                    sl.lower = _fold_add(sl.lower, +1)
            elif self.take():
                sl.lower = ast.Constant(1)  # a[:n] -> a[1:n]: skips first element
        return node


class RangeBound(Mutator):
    """Missing final iteration (stop-1) or skipped first iteration (start+1)."""
    name = "range_bound"

    def visit_Call(self, node):
        self.generic_visit(node)
        if (isinstance(node.func, ast.Name) and node.func.id == "range" and node.args
                and not any(isinstance(a, ast.Starred) for a in node.args)):
            stop_i = 0 if len(node.args) == 1 else 1
            if self.take():
                node.args[stop_i] = _fold_add(node.args[stop_i], -1)
            if len(node.args) >= 2 and self.take():
                node.args[0] = _fold_add(node.args[0], +1)
        return node


class MinMaxSwap(Mutator):
    name = "minmax_swap"

    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id in ("min", "max") and self.take():
            node.func.id = "max" if node.func.id == "min" else "min"
        return node


class InitAcc(Mutator):
    """Wrong initial accumulator: `total = 0` -> `total = 1` (and 1 -> 0)."""
    name = "init_acc"

    def visit_Assign(self, node):
        self.generic_visit(node)
        v = node.value
        if (len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                and isinstance(v, ast.Constant) and type(v.value) in (int, float)
                and v.value in (0, 1, 0.0, 1.0) and self.take()):
            one, zero = (1.0, 0.0) if type(v.value) is float else (1, 0)
            node.value = ast.Constant(one if v.value == 0 else zero)
        return node


class EarlyReturnDrop(Mutator):
    """Delete an `if cond: return X` guard — the classic forgotten special case."""
    name = "early_return_drop"

    def visit_If(self, node):
        self.generic_visit(node)
        if (len(node.body) == 1 and isinstance(node.body[0], ast.Return)
                and not node.orelse and self.take()):
            return None
        return node


class FloatRound(Mutator):
    """Rounding direction: floor<->ceil, int() truncation <-> round() banker's."""
    name = "float_round"

    def visit_Attribute(self, node):
        self.generic_visit(node)
        if node.attr in ("floor", "ceil") and self.take():
            node.attr = "ceil" if node.attr == "floor" else "floor"
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        if (isinstance(node.func, ast.Name) and node.func.id in ("int", "round")
                and len(node.args) == 1 and not node.keywords and self.take()):
            node.func.id = "round" if node.func.id == "int" else "int"
        return node


class SortMisuse(Mutator):
    """Drop key=/reverse= from sorted()/.sort()/min()/max(): relies on the wrong order."""
    name = "sort_misuse"

    def visit_Call(self, node):
        self.generic_visit(node)
        sortish = ((isinstance(node.func, ast.Name) and node.func.id in ("sorted", "min", "max"))
                   or (isinstance(node.func, ast.Attribute) and node.func.attr == "sort"))
        if sortish and node.keywords:
            node.keywords = [kw for kw in node.keywords
                             if not (kw.arg in ("key", "reverse") and self.take())]
        return node


class AugOverwrite(Mutator):
    """`total += x` -> `total = x`: accumulator silently overwritten each iteration."""
    name = "aug_overwrite"

    def visit_AugAssign(self, node):
        self.generic_visit(node)
        if isinstance(node.op, (ast.Add, ast.Sub)) and isinstance(node.target, ast.Name) and self.take():
            return ast.copy_location(ast.Assign(
                targets=[ast.Name(id=node.target.id, ctx=ast.Store())], value=node.value), node)
        return node


class AbsDrop(Mutator):
    """abs(x) -> x: sign bug that only bites on negative inputs."""
    name = "abs_drop"

    def visit_Call(self, node):
        self.generic_visit(node)
        if (isinstance(node.func, ast.Name) and node.func.id == "abs"
                and len(node.args) == 1 and not node.keywords and self.take()):
            return node.args[0]
        return node


MUTATORS = [CmpBoundary, SliceBound, RangeBound, MinMaxSwap, InitAcc,
            EarlyReturnDrop, FloatRound, SortMisuse, AugOverwrite, AbsDrop]


def candidates_for(src):
    """All single-site mutants of a normalized program: [(class_name, mutant_src)]."""
    out, seen = [], {src}
    for M in MUTATORS:
        counter = M(target=None)
        counter.visit(ast.parse(src))
        for k in range(counter.sites):
            mm = M(target=k)
            tree = mm.visit(ast.parse(src))
            ast.fix_missing_locations(tree)
            try:
                mutant = ast.unparse(tree)
                compile(mutant, "<mutant>", "exec")
            except Exception:
                continue  # e.g. early-return drop emptied a block
            if mutant not in seen:
                seen.add(mutant)
                out.append((M.name, mutant))
    return out


# ---------------------------------------------------------------------------
# Optional LLM plausible-wrong rewrites (Azure OpenAI, creds from backend/.env)
# ---------------------------------------------------------------------------

LLM_PROMPT = (
    "Introduce exactly ONE subtle logic bug into the Python program below. The bug must "
    "change the output on at least one valid input, but an experienced reviewer skimming "
    "the code should be likely to miss it. Keep the docstring, function names, variable "
    "names, structure, and style completely identical. Do not add or change any comments. "
    "Return ONLY the complete modified program, with no explanation and no markdown fences.\n\n"
)


def load_env_file(path):
    env = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip().removeprefix("export ").strip()] = v.strip().strip("'\"")
    except OSError:
        pass
    return env


def azure_chat(env, user_content):
    endpoint = env.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
    key = env.get("AZURE_OPENAI_KEY", "")
    dep = env.get("AZURE_OPENAI_DEPLOYMENT", "")
    ver = env.get("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
    if not endpoint or not key or not dep:
        raise RuntimeError("missing AZURE_OPENAI_* creds")
    body = {"model": dep, "messages": [{"role": "user", "content": user_content}]}
    # Mirror aiService.buildBody: gpt-5*/o* are reasoning models (max_completion_tokens,
    # no temperature, tunable effort); everything else keeps max_tokens.
    if re.match(r"^(o\d|gpt-5)", dep, re.I):
        body["max_completion_tokens"] = 4000
        body["reasoning_effort"] = "low"
    else:
        body["max_tokens"] = 2000
    req = urllib.request.Request(
        f"{endpoint}/openai/deployments/{dep}/chat/completions?api-version={ver}",
        data=json.dumps(body).encode(),
        headers={"api-key": key, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode())
    return data["choices"][0]["message"]["content"] or ""


def extract_code(text):
    m = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.S)
    return (m.group(1) if m else text).strip() + "\n"


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def main():
    if not os.path.exists(DATA):
        print(f"downloading {URL} ...", file=sys.stderr)
        urllib.request.urlretrieve(URL, DATA)
    with gzip.open(DATA, "rt", encoding="utf-8") as f:
        problems = [json.loads(line) for line in f if line.strip()]

    rng = Random(SEED)
    report = {"seed": SEED, "canonical": {}, "ast": {}, "llm": {}}

    # -- 1. verify every canonical solution against its full test suite ------
    def verify_canonical(p):
        try:
            norm = ast.unparse(ast.parse(p["prompt"] + p["canonical_solution"]))
        except Exception:
            return None
        res = run_counted(norm, p["test"], p["entry_point"])
        if res and res[1] == 0 and res[0] >= 1:
            return {"task_id": p["task_id"], "entry_point": p["entry_point"],
                    "program": norm, "test": p["test"], "asserts": res[0]}
        return None

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        verified = [v for v in ex.map(verify_canonical, problems) if v]
    report["canonical"] = {"total": len(problems), "verified": len(verified),
                           "skipped": len(problems) - len(verified)}
    print(f"canonical: {len(verified)}/{len(problems)} pass their full suite", file=sys.stderr)

    # -- 2. AST mutants: interleave classes per task, verify until quota ------
    def mutate_task(v):
        pools = defaultdict(list)
        for cls, mutant in candidates_for(v["program"]):
            pools[cls].append(mutant)
        task_rng = Random(f"{SEED}:{v['task_id']}")
        for lst in pools.values():
            task_rng.shuffle(lst)
        # round-robin classes so kept mutants are diverse, not all cmp flips
        order, classes = [], sorted(pools)
        for i in range(max((len(pools[c]) for c in classes), default=0)):
            for c in classes:
                if i < len(pools[c]):
                    order.append((c, pools[c][i]))
        kept, tries = [], 0
        for cls, mutant in order:
            if len(kept) >= MAX_PER_TASK or tries >= TRIES_PER_TASK:
                break
            tries += 1
            res = run_counted(mutant, v["test"], v["entry_point"])
            if res and res[0] >= 1 and res[1] >= 1:  # subtle: fails some, passes some
                kept.append({"task_id": v["task_id"], "entry_point": v["entry_point"],
                             "program": mutant, "source": "ast_mutant", "mutation": cls,
                             "passed": res[0], "failed": res[1]})
        return kept, tries

    ast_kept, ast_tried = [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for kept, tries in ex.map(mutate_task, verified):
            ast_kept.extend(kept)
            ast_tried += tries
    report["ast"] = {"verified_kept": len(ast_kept), "candidates_run": ast_tried}
    print(f"ast mutants: kept {len(ast_kept)} of {ast_tried} executed", file=sys.stderr)

    # -- 3. LLM plausible-wrong rewrites (optional, capped, cached) -----------
    llm_kept, llm_calls = [], 0
    env = load_env_file(ENV_FILE)
    if SKIP_LLM:
        report["llm"] = {"skipped": "W2_SKIP_LLM=1"}
    elif not (env.get("AZURE_OPENAI_ENDPOINT") and env.get("AZURE_OPENAI_KEY")
              and env.get("AZURE_OPENAI_DEPLOYMENT")):
        report["llm"] = {"skipped": "no AZURE_OPENAI_* creds in backend/.env"}
    else:
        cache = {}
        if os.path.exists(LLM_CACHE):
            with open(LLM_CACHE, encoding="utf-8") as f:
                cache = json.load(f)
        by_id = {v["task_id"]: v for v in verified}
        task_order = sorted(by_id)
        Random(f"{SEED}:llm").shuffle(task_order)
        # Fixed seeded sample of exactly LLM_CALL_CAP tasks: lifetime spend can never
        # exceed the cap, and re-runs replay the cache deterministically.
        for tid in task_order[:LLM_CALL_CAP]:
            if len(llm_kept) >= LLM_TARGET:
                break
            v = by_id[tid]
            if tid not in cache:
                try:
                    llm_calls += 1
                    cache[tid] = azure_chat(env, LLM_PROMPT + v["program"])
                except Exception as e:
                    print(f"llm call failed for {tid}: {e}", file=sys.stderr)
                    continue
            try:
                mutant = ast.unparse(ast.parse(extract_code(cache[tid])))
            except Exception:
                continue
            if mutant == v["program"]:
                continue
            res = run_counted(mutant, v["test"], v["entry_point"])
            if res and res[0] >= 1 and res[1] >= 1:
                llm_kept.append({"task_id": tid, "entry_point": v["entry_point"],
                                 "program": mutant, "source": "llm_mutant",
                                 "mutation": "llm_subtle_bug",
                                 "passed": res[0], "failed": res[1]})
        with open(LLM_CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=0)
        report["llm"] = {"api_calls": llm_calls, "verified_kept": len(llm_kept),
                         "cached_responses": len(cache)}
        print(f"llm mutants: kept {len(llm_kept)} ({llm_calls} API calls)", file=sys.stderr)

    # -- 4. assemble: dedupe, balance, per-task cap, deterministic shuffle ----
    seen = {v["program"] for v in verified}
    per_task = defaultdict(int)
    negatives = []

    def admit(c):
        if c["program"] in seen or per_task[c["task_id"]] >= MAX_PER_TASK:
            return False
        seen.add(c["program"])
        per_task[c["task_id"]] += 1
        negatives.append(c)
        return True

    for c in llm_kept:  # LLM rewrites first: scarce and most valuable
        if len(negatives) >= NEG_TARGET:
            break
        admit(c)
    # fill with AST mutants, round-robin by class, subtlest (lowest fail frac) first
    by_class = defaultdict(list)
    for c in ast_kept:
        by_class[c["mutation"]].append(c)
    for lst in by_class.values():
        lst.sort(key=lambda c: (c["failed"] / (c["passed"] + c["failed"]), c["task_id"]))
    classes = sorted(by_class)
    while len(negatives) < NEG_TARGET and any(by_class[c] for c in classes):
        for cls in classes:
            if len(negatives) >= NEG_TARGET:
                break
            while by_class[cls]:
                if admit(by_class[cls].pop(0)):
                    break

    pos_pool = sorted(verified, key=lambda v: v["task_id"])
    rng.shuffle(pos_pool)
    positives = pos_pool[:POS_TARGET]

    rows = [{"task_id": p["task_id"], "entry_point": p["entry_point"], "program": p["program"],
             "execution_truth": True, "source": "canonical", "mutation": None}
            for p in positives]
    rows += [{"task_id": c["task_id"], "entry_point": c["entry_point"], "program": c["program"],
              "execution_truth": False, "source": c["source"], "mutation": c["mutation"]}
             for c in negatives]
    rng.shuffle(rows)

    with open(OUT, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    # -- 5. summary ------------------------------------------------------------
    frac_hist = defaultdict(int)
    for c in negatives:
        fr = c["failed"] / (c["passed"] + c["failed"])
        frac_hist["<=25%" if fr <= .25 else "26-50%" if fr <= .5 else "51-75%" if fr <= .75 else ">75%"] += 1
    report.update({
        "total": len(rows),
        "positives": len(positives),
        "negatives": len(negatives),
        "by_source": dict(sorted(
            ((s, sum(1 for r in rows if r["source"] == s)) for s in {r["source"] for r in rows}))),
        "by_mutation": dict(sorted(
            ((m, sum(1 for c in negatives if c["mutation"] == m)) for m in {c["mutation"] for c in negatives}))),
        "negative_fail_fraction_hist": dict(sorted(frac_hist.items())),
        "negative_asserts_mean": {
            "passed": round(sum(c["passed"] for c in negatives) / max(1, len(negatives)), 1),
            "failed": round(sum(c["failed"] for c in negatives) / max(1, len(negatives)), 1),
        },
    })
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"wrote {len(rows)} programs -> {OUT}")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
