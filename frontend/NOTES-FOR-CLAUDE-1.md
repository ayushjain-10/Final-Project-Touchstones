# Notes for CLAUDE 1 (backend) — from CLAUDE 2 (frontend)

Context: items the frontend needs or noticed against the **live dev backend**
(`touchstone-api-dev.onrender.com`) while wiring the self-serve loop. None of these
block the core loop today — each has a graceful frontend fallback — but they'd make
the product more complete. Frontend changes live on `claude-2`; nothing here was
edited in the backend.

---

## 1. Clean up a throwaway screen I created while probing the billing gate
While confirming the free-tier gate contract I created one work_sample as the demo
recruiter and **could not delete it** (no delete route — see #2):

- `work_sample` id `66cb34fb-6929-4974-b448-17de45fa5964`, title **"[gate-probe] delete me"**,
  owner `f1f4f5dd-4e1b-4db5-9203-d4aa76cc1a99` (demo recruiter).

Please delete that row (or it clears on the next `seedDemo`). It shows up in the demo
recruiter's Dashboard/Activity until removed.

## 2. No "delete work sample" endpoint
`DELETE /api/proof/work-samples/:id` → 404 (route not found). A recruiter can author a
screen but never remove one, so the Dashboard/Library accumulate test screens. Consider
adding an owner-scoped soft-delete. (Frontend has no delete UI yet — will add once the
route exists.)

## 3. Candidate-facing "Run" needs current-code execution
Mission asks for a candidate Run-before-submit. Today `POST /api/proof/submissions/:id/run`
executes the **stored** `response_code` (`reconstructFiles(sub.response_code, …)`) and only
when the screen has `tests.command`. A candidate hasn't submitted yet, so a Run button would
execute empty/stale code — misleading. **I deliberately did NOT ship a fake Run.** To enable a
real one, the backend would need either:
  - `POST /run` (or a new `/check`) that accepts the **current files in the request body** and
    runs them (candidate-authorized), and/or
  - a notion of **visible/sample tests** distinct from hidden tests, so candidates get feedback
    without exposing the hidden suite.
Until then the candidate flow stays submit→score (which works). Recruiter-side `ExecutionPanel`
(runs stored code on the Result page) is unaffected and degrades cleanly on `available:false` /
`ran:false`.

## 4. Audit record can 404 for an already-scored submission
`GET /api/proof/scores/:id/audit.json` returns `{ "error": "audit record not found" }` for the
seeded scored submission (Jordan Lee, score `d7395c1c-…`). The Result page now handles this
gracefully ("No audit record is available for this result yet."), but ideally **every scored
submission should have an immutable audit record** created at score time so "Export audit trail"
always works. Please confirm audit-record creation in the scoring path (seed data may predate it).

## 5. No in-app billing portal / plan management
Only `POST /api/payments/checkout` exists (used for upgrade). There's **no** `POST /api/payments/portal`
(Stripe customer portal) or subscription-management route, yet the Pricing FAQ implies "cancel from
your workspace." Consider adding a portal-session endpoint; the frontend can then surface a "Manage
subscription" button. `GET /api/payments/usage` ✅ exists and is now wired (sidebar + Author meter).

## 6. (confirmation, not a request) free-tier gate contract the frontend relies on
- `GET /api/payments/usage` → `{ plan, limit, used, remaining }` ✅ used by AppSidebar + Author.
- Create is NOT gated: `POST /api/proof/work-samples` → 201 always.
- Send IS gated at the cap: `POST /api/proof/work-samples/:id/invite` → **HTTP 402** with
  `{ error, upgrade:true, plan, limit, used }`. Frontend keys the limit-reached UI off
  `ApiError.status === 402` / `body.upgrade`. Please keep this shape stable.

## 7. (minor) `score-direction` returns `needs_review` without sub-scores
`POST /api/proof/submissions/:id/score-direction` returned `{ status:'needs_review', submissionId }`
(no `prompt_quality` / `error_catching` / `verification_rigor` / `direction_score`) for the seeded
submission even with 6 logged AI interactions. `DirectionPanel` degrades to a neutral state, but
confirm whether full sub-scores should be returned there.

## 8. `POST /proof/submissions/:id/score` is NOT safely idempotent (HIGH-ish)
Re-scoring an already-scored submission returns **HTTP 500**:
`failed to write proof_scores: duplicate key value violates unique constraint "uq_proof_scores_live_submission_rubric"`.
(Some submissions return `cached:true` correctly, but others hit this — so it's inconsistent.)
Impact: the frontend cannot safely call `scoreSubmission` to "fetch or compute" a score. The Result
page now resolves a submission's score by **reading the latest `proof_scores` row via Supabase**
(no re-score), exactly like the Dashboard does. If you want the frontend to be able to (re)score on
demand, please make `POST .../score` upsert/no-op on the existing `(submission, rubric)` row instead
of throwing on the unique constraint — ideally returning the existing score with `cached:true`.

Also (data nit): some submissions have a `proof_scores` row but their `work_sample_submissions.status`
is still `submitted` (not `scored`), so they read as "Submitted" in Activity even though a score
exists. Worth reconciling status with the presence of a score row.
