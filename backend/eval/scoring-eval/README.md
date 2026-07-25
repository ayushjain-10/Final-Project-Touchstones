# Scoring eval harness (offline golden-set)

An offline harness that **measures how consistent the proof-of-skill scorer is** and how
far it lands from the score it already stored. It closes the audit's "no golden set for
scoring" gap: before this, scoring had no baseline number for run-to-run spread or error.

**Honest framing:** this *measures* consistency — it does **not** assert that scoring is
"deterministic". The grader is an LLM; re-grades will move a little. The value is the
baseline (mean abs error, mean stdev, parse-fail %) so drift can be watched over time.

It runs on the **existing Azure OpenAI deployment** — no new keys. Both scripts read
`backend/.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_OPENAI_*`).

## What it does

1. **`build-gold-set.js`** — reads the dev DB: live (non-superseded) `proof_scores`
   joined to `work_sample_submissions` and the `work_samples` rubric. Freezes a sample
   as `gold-set.json`: `{ id, rubric, response, stored_score, … }`. Skips rows missing a
   rubric or a response, and rows whose stored score used a *different* rubric version than
   the work sample now carries (that would be an unfair re-grade). Capped at ~15 (pilot).

2. **`run-eval.js`** — for each gold item, re-grades it **K times (default 3)** through the
   **same grader path the app uses**, then reports per item:
   - **mean re-score** across the K runs
   - **stdev** across the K runs (run-to-run consistency)
   - **|err|** = |mean re-score − `stored_score`| (agreement with the score on file)
   - **parse-fail rate** (runs whose grader output could not be parsed)

   …and an aggregate: **mean abs error**, **mean stdev**, **parse-fail %**.

### Why it's the *real* path, not a lookalike

`run-eval.js` reuses the app's own primitives:
- `proofScoringService.buildSystemPrompt(rubric)` — the exact grader system prompt
- `proofScoringService.computeScore(rubric, per_criterion)` — the exact 0..100 score math
  (points computed in our code, never read from model prose — the anti-injection defense)
- `aiService.getLLM()` — the exact Azure-backed client the app grades with

The only re-declared piece is the strict JSON-schema (kept module-private in
`proofScoringService`); it is a byte-faithful copy of that file's `GRADER_JSON_SCHEMA`.

## Usage

```bash
cd backend

# 1) Build the gold set from dev (writes gold-set.json, gitignored):
DOTENV_CONFIG_PATH=.env node eval/scoring-eval/build-gold-set.js
#   GOLD_LIMIT=15 caps the set (default 15).

# 2) Run the eval (all items, K=3):
DOTENV_CONFIG_PATH=.env node eval/scoring-eval/run-eval.js

# Tiny smoke (keep token spend near zero) — 2 items, 2 re-grades each:
node eval/scoring-eval/run-eval.js --items=2 --runs=2
#   or: GOLD_ITEMS=2 GOLD_RUNS=2 node eval/scoring-eval/run-eval.js
```

> The scripts load `backend/.env` themselves (via `dotenv`), so `DOTENV_CONFIG_PATH` is
> optional — it's shown above only to match the repo's usual invocation.

## Reading the numbers: cross-model baselines

`stored_score` is whatever the app saved at the time — and some historical scores were
produced by a **different model** than today's grader (the codebase migrated Anthropic →
Azure). For those items, `|err|` is a **cross-model disagreement**, not grader noise. The
runner captures the baseline's `stored_model`, tags such items `[baseline model: …]`, and
reports a **same-model-only** mean abs error alongside the overall one. When you want a
clean grader-noise baseline, read the same-model line (or rebuild the gold set after the
current grader has scored a fresh batch). This is a *feature* of the harness: it makes the
migration's effect on scores visible instead of hiding it inside one averaged number.

## Token spend

Each re-grade is one grader call (~the same size as a live score, capped at
`AI_SCORE_MAX_TOKENS`, default 800 output tokens). Cost ≈ items × K. Keep both small for
routine checks; grow N for a real baseline run.

## `gold-set.json` is gitignored

It contains candidate response text. Per project rules we never persist candidate
transcripts to VCS — regenerate it from the dev DB when needed. See `.gitignore`.

## Env knobs (all optional, all default to the app's values)

| Var | Default | Effect |
|---|---|---|
| `GOLD_LIMIT` | 15 | max gold items the builder writes |
| `GOLD_POOL_LIMIT` | 80 | live scores the builder scans before filtering |
| `GOLD_ITEMS` / `--items=` | all | items the runner evaluates |
| `GOLD_RUNS` / `--runs=` | 3 | re-grades per item |
| `AI_SCORE_MAX_TOKENS` | 800 | grader output cap (mirrors the app) |
| `AI_SCORE_TIMEOUT_MS` | 30000 | per-call timeout (mirrors the app) |
| `AZURE_STRUCTURED_OUTPUTS` | off | strict json_schema mode (mirrors the app) |
