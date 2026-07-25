# Automated Resume Screening: Classical ML vs. LLM Scoring

Final-project study for resume↔job-description (JD) matching, framed as supervised
relevance classification: given a `(resume, JD)` pair, predict match (1) / no-match (0).
This is the screening core of **Touchstone**.

## What it does
- **Data prep** (`pipeline.py`): loads resumes, constructs a **balanced labeled pair set**
  (each resume × its own-category JD = match; × a different-category JD = no-match),
  and standardizes text (lowercase, tokenize, stop-word removal).
- **Features**: TF-IDF (1–2 grams) over the resume+JD corpus; per-pair vector =
  `[tfidf(resume) | tfidf(jd) | cosine(resume, jd)]`.
- **Classical models** (`pipeline.py`): Logistic Regression, Decision Tree,
  Random Forest, Gradient Boosting, and linear SVM — trained with **stratified k-fold
  cross-validation** and `class_weight="balanced"` (out-of-fold predictions, no leakage).
- **Unsupervised baselines**: TF-IDF cosine, keyword (Jaccard) overlap.
- **LLM scorer** (`llm_baseline.py`): zero-shot Anthropic Claude Haiku rates each pair
  0–100; disk-cached; optional **Batch API** (~50% cheaper).
- **Evaluation**: ROC-AUC, precision/recall/F1 (at 0.5 and best-F1 threshold), confusion
  matrices, Brier score (calibration), and a **per-category fairness** check (per-job-family
  AUC + disparity).

## Run it
```bash
pip install -r requirements.txt

# quick, no API key (used by the ML Study CI workflow)
python run_study.py --sample --no-llm

# full study — place the Kaggle CSV at ml/data/UpdatedResumeDataSet.csv first
python run_study.py --folds 5 --pairs-per-category 40

# include the LLM scorer (needs ANTHROPIC_API_KEY in backend/.env), Batch API, cost-capped
python run_study.py --llm-batch --llm-max 300
```
Outputs land in `ml/results/`: `metrics.json`, `summary.csv`, `summary.md`.

## Data
Kaggle **UpdatedResumeDataSet** (962 resumes, 25 categories):
<https://www.kaggle.com/datasets/gauravduttakiit/resume-dataset> → save as
`ml/data/UpdatedResumeDataSet.csv`. A 30-resume `sample_resumes.csv` is bundled so the
pipeline runs with no download. JDs are in `job_descriptions.json` (one per category).

## Course-module mapping
Data cleaning/standardization (2–3) · TF-IDF / NLP (12) · Logistic Regression (6–7) ·
Decision Trees & ensembles (8–9) · SVM (16) · model evaluation: ROC-AUC, P/R/F1,
confusion, calibration, k-fold CV (10–11) · class imbalance + fairness (13).

## Notes / honest limits
- Labels are a **category-as-match proxy** — a resume is "matched" to its own category's
  JD. This introduces label noise (a real match isn't strictly same-category); documented
  as a study limitation.
- The bundled sample is tiny (smoke-test scale). Real numbers come from the full Kaggle run.
