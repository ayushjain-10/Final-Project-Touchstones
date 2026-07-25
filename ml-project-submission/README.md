# Touchstones - ML Final Project Submission

**Verified real-work screening for engineering hiring in the AI era.**
Ayush Jain, Christoph Dittrich, Mark Garvin Jeyaraj - Northeastern University, July 2026.

This folder contains everything for the final submission. The product itself lives in the parent
repository (`backend/`, `frontend/`); this folder holds the paper, figures, and presentation, plus
pointers to the code that implements and evaluates the two feedback items.

## Contents

| File | What it is |
|------|-----------|
| `report.pdf` | The written report (scientific-paper format, 11pt, single-spaced). Submit this. |
| `report.html` | Source for the report (rendered to PDF with headless Chrome). |
| `Touchstones-Presentation.pptx` | **Editable PowerPoint** (9 slides, navy theme, each speaker's lines in the slide notes). Opens in PowerPoint, Keynote, or Google Slides. |
| `presentation-deck.pdf` | Read-only PDF of the same deck (quick view). |
| `presentation-deck.html` | HTML source for the PDF deck. |
| `presentation-script.md` | Timed speaker script + the live-demo walkthrough. Record from this. |
| `figures/` | The figures + the raw JSON the evals produced (reproducible). |

## The two things we fixed (instructor feedback)

1. **Cold-start calibration.** The calibration layer used to collapse to an "insufficient data"
   state before a customer had outcome labels. We added a Beta-Binomial (empirical-Bayes) posterior
   that shrinks a score band's advance rate toward a documented prior, tiers it honestly
   (prior -> provisional -> calibrated), and reports a 90% credible interval that narrows as data
   arrives. In simulation it cuts error by **56.6%** when labels are scarce and is **100% available**
   vs. 0% for the raw band, with **95.1%** interval coverage.
   - Code: `backend/src/services/calibrationService.js` (`shrinkRate`, `betai`, `betaQuantile`, `COLD_START_PRIOR`)
   - UI: `frontend/src/components/CalibrationBadge.jsx` (the "Advance-rate estimate" block)
   - Tests: `backend/tests/unit/calibrationService.spec.js`
   - Eval: `backend/eval/calibration-coldstart.mjs`

2. **Subgroup fairness, early and on synthetic data.** We run the EEOC four-fifths (80%) rule on
   synthetic cohorts now. A blind scorer passes (min impact ratio **0.87**); a deliberately biased
   scorer is flagged (**0.35**); a tiny group is suppressed for privacy.
   - Code: `backend/src/services/complianceService.js` (`fourFifths`, `computeAdverseImpact`)
   - Eval: `backend/eval/fairness-fourfifths.mjs`

## Reproduce everything (no database or API key needed)

```bash
# from the repository root
cd backend && npm install
node eval/calibration-coldstart.mjs     # cold-start numbers + figures -> backend/eval/out/
node eval/fairness-fourfifths.mjs       # fairness numbers + figure   -> backend/eval/out/
npx jest tests/unit/calibrationService.spec.js tests/unit/complianceService.spec.js   # the math tests
```

## Run the live demo (for the video)

The demo is interactive: every panel calls the real backend services. Start both servers:

```bash
cd backend && npm install && npm start      # API on http://localhost:3001 (grader + services)
cd frontend && npm install && npm run dev   # app on http://localhost:3000
```
Open **http://localhost:3000/demo/features** (public, no login). Score a candidate submission and
try to prompt-inject it (the code-computed score does not move and is flagged), drag the cold-start
calibration slider, and edit subgroup counts to trip the four-fifths check. See
`presentation-script.md` for the exact walkthrough. The backend needs `backend/.env`
(Anthropic/Azure grader key) for the scorer; calibration and fairness are pure and need no keys.

## Regenerate the PDFs from source

```bash
cd ml-project-submission
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --no-pdf-header-footer --virtual-time-budget=12000 \
  --print-to-pdf=report.pdf "file://$(pwd)/report.html"
"$CHROME" --headless=new --no-pdf-header-footer --virtual-time-budget=10000 \
  --print-to-pdf=presentation-deck.pdf "file://$(pwd)/presentation-deck.html"
```

## Repository

`github.com/ayushjain-10/touchstone` (branch `development`). Full system: 710 automated tests passing.
