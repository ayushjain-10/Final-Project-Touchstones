#!/usr/bin/env python3
"""
build_corpus.py — Wave-1 execution-truth corpus for the grader-vs-execution eval.
--------------------------------------------------------------------------------
Dependency-free (Python stdlib only). Downloads HumanEval (MIT, OpenAI) and, for N
problems, emits:
  • the CANONICAL solution                       -> execution_truth = True   (correct)
  • deterministic single-edit MUTANTS that FAIL  -> execution_truth = False  (plausible-but-wrong)

Every label comes from actually RUNNING the code against HumanEval's own tests, so a
grader-vs-truth eval built on this corpus is strictly non-circular (no LLM in the loop).

Untrusted-code note: only HumanEval canonical solutions + trivial derived mutants run here,
each in a subprocess with a wall-clock timeout. Do NOT point this at arbitrary model
completions without a real sandbox (docker ganler/evalplus).

Usage:
  python3 backend/eval/external/build_corpus.py            # CORPUS_N=25, 2 mutants/problem
  CORPUS_N=50 CORPUS_MUTANTS=3 python3 .../build_corpus.py
"""
import gzip
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "HumanEval.jsonl.gz")
OUT = os.path.join(HERE, "corpus.jsonl")
URL = "https://github.com/openai/human-eval/raw/master/data/HumanEval.jsonl.gz"

N = int(os.environ.get("CORPUS_N", "25"))
MUTANTS_PER = int(os.environ.get("CORPUS_MUTANTS", "2"))
TIMEOUT = int(os.environ.get("CORPUS_TIMEOUT", "10"))

# Single-edit mutation rules (first match on the SOLUTION body). Each aims to inject a
# realistic bug (wrong operator, boundary, sign) that a careless reader might miss.
MUTATIONS = [
    (r"==", "!="),
    (r"!=", "=="),
    (r"<=", "<"),
    (r">=", ">"),
    (r"(?<![<>=!])<(?![=])", ">"),
    (r"(?<![<>=!])>(?![=])", "<"),
    (r"\band\b", "or"),
    (r"\bor\b", "and"),
    (r"\bTrue\b", "False"),
    (r"\bFalse\b", "True"),
    (r"\+ 1\b", "+ 0"),
    (r"- 1\b", "- 0"),
    (r"\+", "-"),
]


def download():
    if not os.path.exists(DATA):
        print(f"downloading {URL} ...", file=sys.stderr)
        urllib.request.urlretrieve(URL, DATA)


def load_problems():
    with gzip.open(DATA, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def runs_ok(program, test, entry):
    """True iff `program` passes HumanEval's own check() for this task."""
    src = program + "\n" + test + f"\n\ncheck({entry})\n"
    try:
        r = subprocess.run(
            [sys.executable, "-c", src],
            capture_output=True,
            timeout=TIMEOUT,
        )
        return r.returncode == 0
    except Exception:
        return False


def mutants_of(body):
    out = []
    for pat, repl in MUTATIONS:
        m = re.search(pat, body)
        if not m:
            continue
        mutant = body[: m.start()] + repl + body[m.end():]
        if mutant != body:
            out.append((f"{pat} -> {repl}", mutant))
    return out


def main():
    download()
    problems = load_problems()[:N]
    rows = []
    stats = {"canonical_pass": 0, "canonical_skip": 0, "mutants_tried": 0, "mutants_kept": 0}

    for p in problems:
        prompt, sol, test, entry = p["prompt"], p["canonical_solution"], p["test"], p["entry_point"]
        canonical = prompt + sol
        if not runs_ok(canonical, test, entry):
            stats["canonical_skip"] += 1
            continue
        stats["canonical_pass"] += 1
        rows.append({
            "task_id": p["task_id"], "entry_point": entry, "program": canonical,
            "execution_truth": True, "source": "canonical", "mutation": None,
        })
        kept = 0
        for desc, mbody in mutants_of(sol):
            if kept >= MUTANTS_PER:
                break
            stats["mutants_tried"] += 1
            mprog = prompt + mbody
            try:
                compile(mprog, "<mutant>", "exec")
            except SyntaxError:
                continue
            # keep ONLY mutants that genuinely fail the tests (plausible-but-wrong)
            if not runs_ok(mprog, test, entry):
                rows.append({
                    "task_id": p["task_id"], "entry_point": entry, "program": mprog,
                    "execution_truth": False, "source": "mutant", "mutation": desc,
                })
                kept += 1
                stats["mutants_kept"] += 1

    with open(OUT, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    pos = sum(1 for r in rows if r["execution_truth"])
    neg = len(rows) - pos
    print(f"wrote {len(rows)} programs -> {OUT}")
    print(json.dumps(stats))
    print(f"positives(correct)={pos}  negatives(plausible-but-wrong)={neg}")


if __name__ == "__main__":
    main()
