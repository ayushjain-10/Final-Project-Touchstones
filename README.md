# Touchstones - Verified Real-Work Screening for Engineering Hiring in the AI Era

**Machine Learning final project.** Ayush Jain, Christoph Dittrich, Mark Garvin Jeyaraj (Northeastern University).

Generative AI broke the traditional coding screen. Instead of trying to *detect* AI, Touchstones
*measures real, role-specific work with AI explicitly allowed* and turns it into one explainable,
audit-ready hiring signal: an LLM grades a messy work sample against a rubric and emits only
per-criterion points, and the 0-100 score is then computed deterministically in code (so it
resists prompt injection and is reproducible), with a per-role calibrated percentile, a behavioral
non-biometric proof-of-human signal, and a tamper-evident hash-chained audit log.

## Start here (graders)

The written report, slide deck, speaker script, and figures are in **[`ml-project-submission/`](ml-project-submission/)**:

- [`ml-project-submission/report.pdf`](ml-project-submission/report.pdf) - the paper
- [`ml-project-submission/presentation-deck.pdf`](ml-project-submission/presentation-deck.pdf) - slides
- [`ml-project-submission/presentation-script.md`](ml-project-submission/presentation-script.md) - talk + demo walkthrough

## The two evaluated contributions

1. **Cold-start calibration (empirical-Bayes).** Before a customer has outcome labels, a
   Beta-Binomial posterior shrinks each score band's advance rate toward a documented prior and
   reports a tiered estimate (`prior -> provisional -> calibrated`) with a 90% credible interval
   that narrows as data arrives - instead of collapsing to "insufficient data". In a 4,000-trial
   simulation this cuts error by **56.6%** when labels are scarce and stays **100% available**
   (vs. 0% for the raw band), with **95.1%** interval coverage.
   Code: `backend/src/services/calibrationService.js`; eval: `backend/eval/calibration-coldstart.mjs`.

2. **Subgroup fairness, checked early on synthetic data.** The EEOC four-fifths (80%) rule runs on
   synthetic cohorts now: a blind scorer passes (min impact ratio **0.87**), an injected-bias
   scorer is flagged (**0.35**), and a small group is suppressed for privacy.
   Code: `backend/src/services/complianceService.js`; eval: `backend/eval/fairness-fourfifths.mjs`.

## Reproduce the results (no database or API key needed)

```bash
cd backend && npm install
node eval/calibration-coldstart.mjs     # cold-start numbers + figures -> backend/eval/out/
node eval/fairness-fourfifths.mjs       # fairness numbers + figure   -> backend/eval/out/
npx jest tests/unit/calibrationService.spec.js tests/unit/complianceService.spec.js
```

## Run the live demo (interactive)

Every panel calls the real backend services, so start both servers:

```bash
cd backend && npm install && npm start      # API on http://localhost:3001
cd frontend && npm install && npm run dev   # app on http://localhost:3000
```

Open **`http://localhost:3000/demo/features`** (public, no login). Score a candidate submission and
try to prompt-inject it (the code-computed score does not move and is flagged), drag the cold-start
calibration slider, and edit subgroup counts to trip the four-fifths check. The scorer needs a
grader key in `backend/.env` (see `.env.example`); calibration and fairness are pure and need none.
Endpoints: `backend/src/routes/supabase/demo.js`.

## Layout

- `backend/` - Node/Express API, the scorer (`src/services/proofScoringService.js`), calibration,
  compliance, and the offline eval harnesses (`eval/`).
- `frontend/` - React (Vite) app, including the calibration UI and the demo route.
- `ml/` - a companion resume-screening study (LLM baseline + pipeline).
- `sdk/`, `tests/` - the verification SDK and end-to-end tests.

## Notes

This is a curated public snapshot for the course submission. It contains the product code and the
submission materials; it excludes business/go-to-market material and all credentials. Configure a
local environment from the `*.env.example` templates. Full system: 710 automated tests passing.
