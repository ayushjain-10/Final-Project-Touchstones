-- ============================================
-- Assessment Templates Library (+ recruiter custom assessments)
-- ============================================
-- A LIBRARY of reusable, role-specific assessment TEMPLATES (engineering work
-- samples for different POSITIONS) plus recruiter-authored CUSTOM templates.
--
-- This is NOT a second tasks table: `work_samples` (011) remains the concrete,
-- assigned-and-scored task. An assessment_template is a reusable BLUEPRINT a
-- recruiter clones/copies a `work_sample` FROM (frontend/route does the copy).
--
-- The 2026-native wedge: every template describes REAL work where USING AI IS
-- EXPLICITLY ALLOWED. The differentiator we measure is HOW the candidate directs
-- the AI and catches its mistakes (see 028_direct_ai_replay.sql / aiDirectionService).
--
-- Rubric shape is INTENTIONALLY identical to work_samples.rubric so a clone is a
-- straight copy and proofScoringService.computeScore() can grade it unchanged:
--   { "criteria": [ { id, requirement, points_possible, weight, anchors[] }, ... ] }
-- The 0-100 score is computed IN OUR CODE from per-criterion points (negative
-- `weight` = penalty criterion); the model only ever emits points_awarded.

-- 1) assessment_templates --------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position       TEXT NOT NULL,                       -- frontend | backend | fullstack | data_ml | devops | mobile | ...
  title          TEXT NOT NULL,
  summary        TEXT,
  prompt_md      TEXT NOT NULL,
  starter_files  JSONB NOT NULL DEFAULT '[]',         -- [{ path, content, language }]
  languages      TEXT[] NOT NULL DEFAULT '{}',
  rubric         JSONB NOT NULL,                       -- { criteria: [{id, requirement, points_possible, weight, anchors}] }
  time_limit_min INT,
  is_public      BOOLEAN NOT NULL DEFAULT FALSE,       -- TRUE + created_by NULL = read-only library row
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id         UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assessment_templates_position ON assessment_templates(position);
CREATE INDEX IF NOT EXISTS idx_assessment_templates_created_by ON assessment_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_assessment_templates_public ON assessment_templates(is_public) WHERE is_public = TRUE;

-- keep updated_at fresh (reuses the project-wide trigger fn from 002_standalone_schema.sql)
DROP TRIGGER IF EXISTS update_assessment_templates_updated_at ON assessment_templates;
CREATE TRIGGER update_assessment_templates_updated_at
  BEFORE UPDATE ON assessment_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2) RLS -------------------------------------------------------------------
-- Visibility: public library rows (is_public = true) are readable by every
-- authenticated user; a recruiter additionally sees their own rows. Writes are
-- always self-scoped to created_by = auth.uid(), so library rows (created_by NULL)
-- are read-only to everyone — no policy lets anyone UPDATE/DELETE/own them.
ALTER TABLE assessment_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS at_select ON assessment_templates;
CREATE POLICY at_select ON assessment_templates
  FOR SELECT
  TO authenticated
  USING (is_public = TRUE OR created_by = auth.uid());

DROP POLICY IF EXISTS at_insert ON assessment_templates;
CREATE POLICY at_insert ON assessment_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS at_update ON assessment_templates;
CREATE POLICY at_update ON assessment_templates
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS at_delete ON assessment_templates;
CREATE POLICY at_delete ON assessment_templates
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- 3) SEED — 6 high-quality, genuinely role-specific library templates -------
-- All seeds: is_public = TRUE, created_by = NULL (read-only library).
-- Re-running is safe: we clear prior library seeds before inserting.
DELETE FROM assessment_templates WHERE is_public = TRUE AND created_by IS NULL;

INSERT INTO assessment_templates
  (position, title, summary, prompt_md, starter_files, languages, rubric, time_limit_min, is_public, created_by)
VALUES

-- ---- FRONTEND: React component + bugfix ----
(
  'frontend',
  'Fix a flaky React data-table: sorting + empty/loading states',
  'Debug and harden a real React table component whose sorting corrupts rows and whose loading/empty states are broken. AI is allowed — we score how you direct it and verify its output.',
  $md$## Context
You have inherited a `<UserTable>` component used on our admin dashboard. QA filed three bugs:

1. **Sorting corrupts data** — clicking a column header sometimes drops or duplicates rows.
2. **No loading state** — while data is fetching the table renders a blank flash.
3. **Empty result crashes** — when the API returns `[]` the component throws.

## Your task
Working in `UserTable.jsx`, fix all three bugs and add a minimal test in `UserTable.test.jsx` that would have caught bug #1.

**Using an AI assistant is explicitly allowed and expected.** What we evaluate is HOW you direct it: the prompts you write, whether you catch the mistakes it makes (the common AI "fix" mutates the array in place — that is the root cause of bug #1), and whether you verify the result rather than pasting it.

## Constraints
- Do not pull in a table library; fix the existing code.
- Keep the public props API (`users`, `isLoading`, `onRowClick`) unchanged.
- Explain, in 3–5 sentences at the top of your submission, the root cause of the sorting bug and how you confirmed your fix.
$md$,
  $json$[
    {
      "path": "src/UserTable.jsx",
      "language": "jsx",
      "content": "import React, { useState } from 'react';\n\nexport function UserTable({ users, isLoading, onRowClick }) {\n  const [sortKey, setSortKey] = useState('name');\n\n  // BUG: sort() mutates the prop array in place and the comparator is unstable\n  const sorted = users.sort((a, b) => a[sortKey] > b[sortKey]);\n\n  return (\n    <table>\n      <thead>\n        <tr>\n          {['name', 'email', 'role'].map((k) => (\n            <th key={k} onClick={() => setSortKey(k)}>{k}</th>\n          ))}\n        </tr>\n      </thead>\n      <tbody>\n        {sorted.map((u) => (\n          <tr key={u.id} onClick={() => onRowClick(u)}>\n            <td>{u.name}</td>\n            <td>{u.email}</td>\n            <td>{u.role}</td>\n          </tr>\n        ))}\n      </tbody>\n    </table>\n  );\n}\n"
    },
    {
      "path": "src/UserTable.test.jsx",
      "language": "jsx",
      "content": "import { render, screen, fireEvent } from '@testing-library/react';\nimport { UserTable } from './UserTable';\n\n// TODO: add a test that fails on the in-place-mutation sorting bug.\n"
    }
  ]$json$::jsonb,
  ARRAY['javascript','jsx'],
  $rubric${
    "criteria": [
      { "id": "root_cause", "requirement": "Correctly identifies the in-place array mutation (and/or unstable comparator) as the root cause of the sorting bug.", "points_possible": 25, "weight": 1, "anchors": ["0: no/​wrong cause", "12: partially right", "25: precise root cause with reasoning"] },
      { "id": "sort_fix", "requirement": "Sorting is fixed correctly: copies before sorting and uses a stable numeric/locale comparator; rows are never dropped or duplicated.", "points_possible": 25, "weight": 1, "anchors": ["0: still buggy", "25: correct, no mutation"] },
      { "id": "states", "requirement": "Adds a non-crashing loading state and a graceful empty state without changing the public props API.", "points_possible": 20, "weight": 1, "anchors": ["0: missing", "20: both handled, API intact"] },
      { "id": "test", "requirement": "Adds a focused test that would actually fail on the original sorting bug.", "points_possible": 20, "weight": 1, "anchors": ["0: none/trivial", "20: a real regression test"] },
      { "id": "ai_direction", "requirement": "Submission shows the candidate directed the AI and verified/corrected its output (explains the catch), rather than pasting an unchecked answer.", "points_possible": 10, "weight": 1, "anchors": ["0: copy-paste", "10: clear direction + verification"] },
      { "id": "unverified_ai_slop", "requirement": "PENALTY: ships an AI suggestion that is wrong or unverified (e.g. the mutating 'fix', dead imports, hallucinated API).", "points_possible": 15, "weight": -1, "anchors": ["0: clean", "15: shipped unverified AI output"] }
    ]
  }$rubric$::jsonb,
  60, TRUE, NULL
),

-- ---- BACKEND: Node/Express API endpoint + tests ----
(
  'backend',
  'Build an idempotent Express "transfer funds" endpoint with tests',
  'Implement a money-transfer POST endpoint in Express with validation, idempotency, and concurrency safety, plus tests. AI allowed — we score direction and verification, not raw output.',
  $md$## Context
Our payments service needs a `POST /accounts/:id/transfer` endpoint. A naive version already exists and is unsafe.

## Your task
In `transfer.js`, implement the handler so that it:

1. **Validates** input (`toAccountId` present and != source, `amount` a positive number).
2. Is **idempotent**: the same `Idempotency-Key` header must never apply the transfer twice.
3. Is **concurrency-safe**: two simultaneous transfers must not overdraw the balance.
4. Returns correct status codes: `400` invalid, `404` unknown account, `409` insufficient funds, `200` success.

Add tests in `transfer.test.js` covering at least: a happy path, an overdraw, and a duplicate idempotency key.

**Using an AI assistant is explicitly allowed.** We evaluate how you direct it. A common AI answer checks the balance and then deducts in two separate steps — that is a race condition. Catching and fixing that (and explaining why) is the signal we score.

## Notes
- A tiny in-memory `db` is provided (`db.accounts`, `db.idempotency`). Treat its operations as the unit of atomicity you must reason about.
- Explain your concurrency strategy in 3–5 sentences at the top.
$md$,
  $json$[
    {
      "path": "transfer.js",
      "language": "javascript",
      "content": "// In-memory store (the 'database' for this exercise).\nconst db = {\n  accounts: new Map([\n    ['a1', { id: 'a1', balance: 100 }],\n    ['a2', { id: 'a2', balance: 0 }],\n  ]),\n  idempotency: new Map(),\n};\n\n// TODO: make this validated, idempotent, and concurrency-safe.\nasync function transfer(req, res) {\n  const from = db.accounts.get(req.params.id);\n  const to = db.accounts.get(req.body.toAccountId);\n  from.balance -= req.body.amount; // unsafe: no checks, no atomicity\n  to.balance += req.body.amount;\n  res.json({ ok: true });\n}\n\nmodule.exports = { transfer, db };\n"
    },
    {
      "path": "transfer.test.js",
      "language": "javascript",
      "content": "const { transfer, db } = require('./transfer');\n\n// TODO: tests — happy path, overdraw (409), duplicate Idempotency-Key.\n"
    }
  ]$json$::jsonb,
  ARRAY['javascript','typescript'],
  $rubric${
    "criteria": [
      { "id": "validation", "requirement": "Validates inputs and returns 400 for missing/invalid toAccountId, self-transfer, or non-positive amount.", "points_possible": 20, "weight": 1, "anchors": ["0: none", "20: all cases + correct 400s"] },
      { "id": "idempotency", "requirement": "Same Idempotency-Key never applies the transfer twice and returns the original result.", "points_possible": 25, "weight": 1, "anchors": ["0: missing", "12: partial", "25: correct replay-safe behavior"] },
      { "id": "concurrency", "requirement": "Check-then-deduct race is closed (atomic guard / lock / compare-and-set) so concurrent transfers cannot overdraw.", "points_possible": 25, "weight": 1, "anchors": ["0: race remains", "25: provably safe + explained"] },
      { "id": "status_codes", "requirement": "Returns correct status codes: 404 unknown account, 409 insufficient funds, 200 success.", "points_possible": 10, "weight": 1, "anchors": ["0: wrong", "10: all correct"] },
      { "id": "tests", "requirement": "Tests cover happy path, overdraw, and duplicate idempotency key, and actually assert outcomes.", "points_possible": 15, "weight": 1, "anchors": ["0: none", "15: all three, meaningful asserts"] },
      { "id": "ai_direction", "requirement": "Shows the candidate caught the concurrency flaw in any AI-suggested version and verified the fix.", "points_possible": 5, "weight": 1, "anchors": ["0: pasted", "5: directed + verified"] },
      { "id": "unverified_ai_slop", "requirement": "PENALTY: ships unverified AI output (e.g. the two-step check-then-deduct race, or non-functional code).", "points_possible": 15, "weight": -1, "anchors": ["0: clean", "15: unverified/broken"] }
    ]
  }$rubric$::jsonb,
  75, TRUE, NULL
),

-- ---- FULLSTACK: thin slice end-to-end ----
(
  'fullstack',
  'Ship a thin vertical slice: API + React for a "saved searches" feature',
  'Implement a small end-to-end feature — an Express endpoint plus a React form that consumes it — wiring validation, loading, and error states. AI allowed; we score how you direct and verify it across the stack.',
  $md$## Context
Recruiters want to save and re-run named searches. The data model exists; the wiring does not.

## Your task
Deliver one **thin vertical slice** end to end:

1. **API** (`api/savedSearches.js`): implement `POST /saved-searches` (create) and `GET /saved-searches` (list for the current user). Validate that `name` is non-empty and `query` is an object. Reject duplicates by name with `409`.
2. **UI** (`web/SavedSearches.jsx`): a form that creates a saved search and a list that shows existing ones, with loading and error states and optimistic-but-correct updates.

**Using an AI assistant is explicitly allowed.** The signal is how you direct it across BOTH layers and keep the contract consistent — AI frequently drifts the field names between the API and the form (e.g. `title` vs `name`). Catching that mismatch is exactly what we score.

## Constraints
- Keep the API contract and the form in sync; document the request/response shape in a comment.
- Handle the error path in the UI (a failed create must not leave a phantom row).
- 3–5 sentence note: what you asked the AI for, and one thing you corrected.
$md$,
  $json$[
    {
      "path": "api/savedSearches.js",
      "language": "javascript",
      "content": "// Express router stub. Implement POST (create) and GET (list).\n// db.savedSearches: Array<{ id, userId, name, query }>\nconst express = require('express');\nconst router = express.Router();\nconst db = { savedSearches: [] };\n\n// TODO: POST /  -> validate { name, query }, reject duplicate name (409)\n// TODO: GET  /  -> list current user's saved searches\n\nmodule.exports = { router, db };\n"
    },
    {
      "path": "web/SavedSearches.jsx",
      "language": "jsx",
      "content": "import React, { useEffect, useState } from 'react';\n\n// TODO: form to create a saved search + list of existing ones.\n// Must handle loading + error; a failed create must not leave a phantom row.\nexport function SavedSearches() {\n  return <div />;\n}\n"
    }
  ]$json$::jsonb,
  ARRAY['javascript','jsx'],
  $rubric${
    "criteria": [
      { "id": "api_create", "requirement": "POST validates name/query, persists scoped to the current user, and returns the created row.", "points_possible": 20, "weight": 1, "anchors": ["0: missing/unscoped", "20: validated + user-scoped"] },
      { "id": "api_list_dupes", "requirement": "GET lists only the current user's rows; duplicate name returns 409.", "points_possible": 15, "weight": 1, "anchors": ["0: neither", "15: both correct"] },
      { "id": "ui_wiring", "requirement": "Form creates via the API and the list reflects it; field names match the API contract on both sides.", "points_possible": 25, "weight": 1, "anchors": ["0: broken/mismatched", "25: consistent contract end-to-end"] },
      { "id": "ui_states", "requirement": "Loading and error states are handled; a failed create does not leave a phantom row.", "points_possible": 20, "weight": 1, "anchors": ["0: none", "20: both, no phantom row"] },
      { "id": "contract_doc", "requirement": "Request/response shape is documented and consistent across layers.", "points_possible": 10, "weight": 1, "anchors": ["0: absent", "10: clear + accurate"] },
      { "id": "ai_direction", "requirement": "Shows the candidate caught the cross-layer field-name drift (or similar) the AI introduced and reconciled it.", "points_possible": 10, "weight": 1, "anchors": ["0: pasted", "10: directed + reconciled"] },
      { "id": "unverified_ai_slop", "requirement": "PENALTY: API and UI disagree on the contract, or ships non-working AI output.", "points_possible": 15, "weight": -1, "anchors": ["0: consistent", "15: contract mismatch shipped"] }
    ]
  }$rubric$::jsonb,
  90, TRUE, NULL
),

-- ---- DATA_ML: Python data/ML task ----
(
  'data_ml',
  'Clean a leaky dataset and fix an over-optimistic churn model',
  'Diagnose data leakage in a churn pipeline, fix the split, and report honest metrics in Python. AI allowed — we score whether you catch the leakage the AI misses.',
  $md$## Context
A teammate reports 0.99 ROC-AUC on a customer-churn model and wants to ship it. The notebook (`churn.py`) is provided. The number is too good to be true.

## Your task
1. Find and explain the **data leakage** (hint: a feature is derived from the label, and the scaler is fit on the full dataset before splitting).
2. Fix the pipeline: proper train/test split, fit preprocessing on **train only**, drop the leaky feature.
3. Report **honest** metrics (ROC-AUC, precision/recall) and a one-paragraph readout a non-ML stakeholder can act on.

**Using an AI assistant is explicitly allowed.** The signal: AI tools will happily "improve" the model without noticing the leakage. Catching that the 0.99 is an artifact — and proving it with a corrected split — is exactly what we evaluate.

## Constraints
- Use pandas + scikit-learn only.
- Wrap preprocessing + model in a single `Pipeline` so the fix is structural, not ad hoc.
- 3–5 sentence note on what you asked the AI and what you rejected.
$md$,
  $json$[
    {
      "path": "churn.py",
      "language": "python",
      "content": "import pandas as pd\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import roc_auc_score\n\ndf = pd.read_csv('customers.csv')\n# LEAK 1: 'days_since_churn' is derived from the label.\n# LEAK 2: scaler is fit on ALL rows before the split.\nX = df.drop(columns=['churned'])\ny = df['churned']\nX_scaled = StandardScaler().fit_transform(X)\nmodel = LogisticRegression().fit(X_scaled, y)\nprint('AUC', roc_auc_score(y, model.predict_proba(X_scaled)[:, 1]))  # ~0.99, bogus\n"
    },
    {
      "path": "customers.csv",
      "language": "text",
      "content": "customer_id,tenure_months,monthly_charges,days_since_churn,churned\n1,12,50.0,0,0\n2,3,80.0,5,1\n3,24,30.0,0,0\n4,1,99.0,2,1\n5,36,45.0,0,0\n"
    }
  ]$json$::jsonb,
  ARRAY['python'],
  $rubric${
    "criteria": [
      { "id": "find_leak", "requirement": "Identifies BOTH leaks: the label-derived feature and the scaler fit before the split.", "points_possible": 30, "weight": 1, "anchors": ["0: neither", "15: one", "30: both, explained"] },
      { "id": "fix_split", "requirement": "Implements a correct train/test split with preprocessing fit on train only (ideally via a Pipeline).", "points_possible": 25, "weight": 1, "anchors": ["0: not fixed", "25: structurally correct"] },
      { "id": "drop_feature", "requirement": "Drops/handles the leaky feature and justifies it.", "points_possible": 15, "weight": 1, "anchors": ["0: kept", "15: dropped + justified"] },
      { "id": "honest_metrics", "requirement": "Reports realistic metrics (AUC/precision/recall) and a stakeholder-readable readout.", "points_possible": 20, "weight": 1, "anchors": ["0: still bogus/none", "20: honest + clear readout"] },
      { "id": "ai_direction", "requirement": "Shows the candidate overrode the AI's leakage-blind 'improvements' and verified the corrected result.", "points_possible": 10, "weight": 1, "anchors": ["0: accepted blindly", "10: directed + verified"] },
      { "id": "unverified_ai_slop", "requirement": "PENALTY: keeps the leaky/over-optimistic result or ships non-running code.", "points_possible": 15, "weight": -1, "anchors": ["0: clean", "15: leakage shipped"] }
    ]
  }$rubric$::jsonb,
  90, TRUE, NULL
),

-- ---- DEVOPS: CI / IaC debugging ----
(
  'devops',
  'Fix a broken CI pipeline and a misconfigured Terraform security group',
  'Debug a failing GitHub Actions workflow and tighten an over-permissive Terraform security group. AI allowed — we score whether you catch the insecure default it suggests.',
  $md$## Context
Two infra problems landed in the same PR:

1. **CI is red.** `.github/workflows/ci.yml` fails: the test job can't find dependencies and the cache key is wrong, so every run is slow and flaky.
2. **An open security group.** `main.tf` provisions an SG that allows `0.0.0.0/0` on port 22 (SSH). Security flagged it.

## Your task
1. Fix `ci.yml` so the pipeline installs deps correctly, caches effectively, and runs tests on PRs.
2. Fix `main.tf` so SSH is restricted to a parameterized admin CIDR (no `0.0.0.0/0`), keeping the app port (443) reachable.

**Using an AI assistant is explicitly allowed.** The catch: AI tools frequently regenerate IaC with `0.0.0.0/0` "to make it work," and suggest pinning actions to `@master`. Spotting and rejecting those insecure defaults is the signal we score.

## Constraints
- Pin third-party actions to a version, not a moving branch.
- Parameterize the admin CIDR via a variable; do not hardcode a public range.
- 3–5 sentence note: what the AI suggested that you rejected, and why.
$md$,
  $json$[
    {
      "path": ".github/workflows/ci.yml",
      "language": "yaml",
      "content": "name: CI\non: [push]            # BUG: PRs are never tested\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@master   # BUG: moving ref\n      - run: npm test                    # BUG: deps never installed; no cache\n"
    },
    {
      "path": "main.tf",
      "language": "hcl",
      "content": "resource \"aws_security_group\" \"app\" {\n  name = \"app-sg\"\n\n  ingress {                # BUG: SSH open to the world\n    from_port   = 22\n    to_port     = 22\n    protocol    = \"tcp\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n\n  ingress {\n    from_port   = 443\n    to_port     = 443\n    protocol    = \"tcp\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n}\n"
    }
  ]$json$::jsonb,
  ARRAY['yaml','hcl'],
  $rubric${
    "criteria": [
      { "id": "ci_deps_cache", "requirement": "CI installs dependencies (e.g. npm ci) and uses a correct, effective cache key.", "points_possible": 20, "weight": 1, "anchors": ["0: still broken", "20: installs + caches correctly"] },
      { "id": "ci_pr_trigger", "requirement": "Workflow runs on pull_request (not just push) so PRs are gated.", "points_possible": 15, "weight": 1, "anchors": ["0: push only", "15: PRs tested"] },
      { "id": "action_pinning", "requirement": "Third-party actions are pinned to a version/SHA, not a moving branch like @master.", "points_possible": 15, "weight": 1, "anchors": ["0: moving ref", "15: pinned"] },
      { "id": "sg_ssh_locked", "requirement": "SSH (22) is restricted to a parameterized admin CIDR; no 0.0.0.0/0 on SSH.", "points_possible": 25, "weight": 1, "anchors": ["0: still open", "25: variable-driven, locked"] },
      { "id": "app_port_intact", "requirement": "App port (443) remains reachable; the change does not break serving traffic.", "points_possible": 10, "weight": 1, "anchors": ["0: broke 443", "10: intact"] },
      { "id": "ai_direction", "requirement": "Shows the candidate rejected an insecure AI default (0.0.0.0/0 or @master) and explained why.", "points_possible": 15, "weight": 1, "anchors": ["0: accepted", "15: rejected + explained"] },
      { "id": "unverified_ai_slop", "requirement": "PENALTY: ships an insecure AI default (world-open SSH, moving action ref) or invalid config.", "points_possible": 20, "weight": -1, "anchors": ["0: clean", "20: insecure default shipped"] }
    ]
  }$rubric$::jsonb,
  60, TRUE, NULL
),

-- ---- MOBILE: React Native bugfix + UX ----
(
  'mobile',
  'Fix a React Native list: crashes on empty data and leaks on unmount',
  'Debug a React Native screen that crashes on empty data, mishandles pull-to-refresh, and leaks a timer on unmount. AI allowed — we score how you direct it and verify on the platform constraints.',
  $md$## Context
A `ProductList` screen in our React Native app has three field-reported issues:

1. **Crash on empty/slow network** — when the API returns no items the screen white-screens.
2. **Pull-to-refresh stuck** — the spinner never clears after a refresh.
3. **Memory leak** — a `setInterval` polling timer keeps running after the screen unmounts, causing "setState on unmounted component" warnings.

## Your task
In `ProductList.jsx`, fix all three: render a proper empty state, correctly manage the `refreshing` state, and clean up the interval on unmount.

**Using an AI assistant is explicitly allowed.** The signal is how you direct it under React Native constraints — AI often returns web-React patterns (e.g. a plain `<div>`, or `ScrollView` where `FlatList` is needed for long lists) that don't fit mobile. Catching and adapting those is what we score.

## Constraints
- Use `FlatList` with `ListEmptyComponent`; do not render a giant ScrollView.
- Clean up the timer in the effect's teardown.
- 3–5 sentence note: one AI suggestion you adapted for mobile and why.
$md$,
  $json$[
    {
      "path": "ProductList.jsx",
      "language": "jsx",
      "content": "import React, { useEffect, useState } from 'react';\nimport { FlatList, Text, View, RefreshControl } from 'react-native';\n\nexport function ProductList({ fetchProducts }) {\n  const [items, setItems] = useState([]);\n  const [refreshing, setRefreshing] = useState(false);\n\n  useEffect(() => {\n    // BUG: interval is never cleared on unmount\n    setInterval(async () => setItems(await fetchProducts()), 5000);\n  }, []);\n\n  // BUG: refreshing never resets; BUG: empty data white-screens\n  const onRefresh = async () => {\n    setRefreshing(true);\n    setItems(await fetchProducts());\n  };\n\n  return (\n    <FlatList\n      data={items}\n      keyExtractor={(it) => String(it.id)}\n      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}\n      renderItem={({ item }) => <View><Text>{item.name}</Text></View>}\n    />\n  );\n}\n"
    }
  ]$json$::jsonb,
  ARRAY['javascript','jsx'],
  $rubric${
    "criteria": [
      { "id": "empty_state", "requirement": "Renders a proper ListEmptyComponent so empty/slow data no longer white-screens.", "points_possible": 20, "weight": 1, "anchors": ["0: still crashes/blank", "20: graceful empty state"] },
      { "id": "refresh_state", "requirement": "Pull-to-refresh sets and CLEARS refreshing correctly (including on error).", "points_possible": 25, "weight": 1, "anchors": ["0: stuck", "25: always resets"] },
      { "id": "timer_cleanup", "requirement": "The polling interval is cleared in the effect teardown; no setState-after-unmount.", "points_possible": 30, "weight": 1, "anchors": ["0: leak remains", "30: cleaned up correctly"] },
      { "id": "mobile_idioms", "requirement": "Uses RN-appropriate components (FlatList, not a web div/giant ScrollView).", "points_possible": 15, "weight": 1, "anchors": ["0: web patterns", "15: correct RN idioms"] },
      { "id": "ai_direction", "requirement": "Shows the candidate adapted a web-React AI suggestion to mobile and verified it.", "points_possible": 10, "weight": 1, "anchors": ["0: pasted web code", "10: adapted + verified"] },
      { "id": "unverified_ai_slop", "requirement": "PENALTY: ships web-React patterns that don't run in RN, or leaves a leak/crash.", "points_possible": 15, "weight": -1, "anchors": ["0: clean", "15: broken/web-only shipped"] }
    ]
  }$rubric$::jsonb,
  60, TRUE, NULL
);

-- Pin search_path on the shared trigger function defensively (idempotent; already
-- done in 016 but safe to re-assert in case this migration runs on a fresh DB).
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;

SELECT 'assessment_templates library (6 seeds) ready' AS status;
