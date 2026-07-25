"""
pipeline.py — classical-ML half of the resume<->JD matching study.

Frames screening as supervised relevance classification: given a (resume, JD)
pair, predict match (1) / no-match (0). Mirrors the course pipeline:
clean -> TF-IDF (NLP) -> train classical classifiers with stratified k-fold CV
-> evaluate (ROC-AUC, precision/recall/F1, confusion, calibration) -> per-category
fairness check. Also includes the two unsupervised baselines from the proposal
(TF-IDF cosine, keyword overlap).
"""
import re
import json
import math
import random
import numpy as np
import pandas as pd
from scipy.sparse import hstack, csr_matrix
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.metrics import (
    roc_auc_score, precision_recall_fscore_support, confusion_matrix,
    brier_score_loss, accuracy_score,
)

# Small built-in stopword list (keeps the pipeline dependency-free in CI; an
# optional nltk lemmatization pass can be layered on for the full study).
STOPWORDS = set("""
a an and are as at be by for from has have in is it its of on or that the to was were will with
this these those i you he she they we my our your their experience skills work years strong
""".split())

TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z+#.]{1,}")


def clean_text(s: str) -> str:
    s = str(s or "").lower()
    toks = [t for t in TOKEN_RE.findall(s) if t not in STOPWORDS and len(t) > 1]
    return " ".join(toks)


def load_resumes(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    # normalize column names (Kaggle: "Category","Resume")
    cols = {c.lower(): c for c in df.columns}
    cat_col = cols.get("category") or list(df.columns)[0]
    res_col = cols.get("resume") or list(df.columns)[-1]
    df = df[[cat_col, res_col]].rename(columns={cat_col: "category", res_col: "resume"})
    df["category"] = df["category"].astype(str).str.strip()
    df = df.dropna(subset=["resume"]).reset_index(drop=True)
    return df


def build_pairs(df: pd.DataFrame, jds: dict, pairs_per_category: int = 40, seed: int = 42) -> pd.DataFrame:
    """Construct a balanced labeled pair set. For each resume in a category that
    has a JD: one positive (own-category JD) and one negative (a different
    category's JD). Returns columns: resume, jd, text, label, category."""
    rng = random.Random(seed)
    jd_cats = [c for c in jds.keys()]
    usable = [c for c in df["category"].unique() if c in jds]
    rows = []
    for cat in usable:
        sub = df[df["category"] == cat]
        if len(sub) > pairs_per_category:
            sub = sub.sample(pairs_per_category, random_state=seed)
        for _, r in sub.iterrows():
            resume = clean_text(r["resume"])
            # positive
            rows.append({"resume": resume, "jd": clean_text(jds[cat]), "label": 1, "category": cat})
            # negative: a different category's JD
            others = [c for c in jd_cats if c != cat]
            neg = rng.choice(others)
            rows.append({"resume": resume, "jd": clean_text(jds[neg]), "label": 0, "category": cat})
    pairs = pd.DataFrame(rows)
    pairs["text"] = pairs["resume"] + " [SEP] " + pairs["jd"]
    pairs = pairs.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return pairs


def featurize(pairs: pd.DataFrame, max_features: int = 5000):
    """TF-IDF features. Fit one vectorizer on the resume+JD corpus, then build a
    per-pair feature matrix [tfidf(resume) | tfidf(jd) | cosine(resume,jd)]."""
    corpus = pd.concat([pairs["resume"], pairs["jd"]]).unique().tolist()
    vec = TfidfVectorizer(max_features=max_features, ngram_range=(1, 2), sublinear_tf=True, min_df=1)
    vec.fit(corpus)
    rv = vec.transform(pairs["resume"])
    jv = vec.transform(pairs["jd"])
    cos = np.asarray(normalize(rv).multiply(normalize(jv)).sum(axis=1)).ravel()
    X = hstack([rv, jv, csr_matrix(cos.reshape(-1, 1))]).tocsr()
    return X, {"vectorizer": vec, "cosine": cos, "resume_vecs": rv, "jd_vecs": jv}


def _models(seed: int):
    return {
        "logreg": LogisticRegression(max_iter=2000, class_weight="balanced"),
        "decision_tree": DecisionTreeClassifier(class_weight="balanced", random_state=seed),
        "random_forest": RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=seed, n_jobs=-1),
        "gradient_boosting": GradientBoostingClassifier(random_state=seed),
        "svm": SVC(kernel="linear", probability=True, class_weight="balanced", random_state=seed),
    }


def run_classifiers(X, y, folds: int = 5, seed: int = 42) -> dict:
    """Stratified k-fold out-of-fold probabilities for each classifier (honest,
    no train/test leakage). Returns {name: oof_prob}."""
    skf = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
    out = {}
    for name, clf in _models(seed).items():
        try:
            proba = cross_val_predict(clf, X, y, cv=skf, method="predict_proba", n_jobs=None)[:, 1]
        except Exception as e:  # pragma: no cover
            proba = None
            print(f"  ! {name} failed: {e}")
        if proba is not None:
            out[name] = proba
    return out


def baseline_scores(pairs: pd.DataFrame, extras: dict) -> dict:
    """Unsupervised baselines from the proposal: TF-IDF cosine and keyword overlap."""
    cos = extras["cosine"]

    def jaccard(a, b):
        sa, sb = set(a.split()), set(b.split())
        return len(sa & sb) / len(sa | sb) if (sa | sb) else 0.0

    overlap = np.array([jaccard(r, j) for r, j in zip(pairs["resume"], pairs["jd"])])
    return {"tfidf_cosine": cos, "keyword_overlap": overlap}


def _best_threshold(y, score):
    """Threshold that maximizes F1 (baselines/LLM aren't calibrated to 0.5)."""
    ts = np.unique(score)
    if len(ts) > 200:
        ts = np.quantile(score, np.linspace(0, 1, 200))
    best_t, best_f1 = 0.5, -1.0
    for t in ts:
        pred = (score >= t).astype(int)
        _, _, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
        if f1 > best_f1:
            best_f1, best_t = f1, float(t)
    return best_t, best_f1


def evaluate(name: str, y, score, fixed_threshold: float = 0.5) -> dict:
    y = np.asarray(y)
    score = np.asarray(score, dtype=float)
    auc = roc_auc_score(y, score) if len(np.unique(y)) > 1 else float("nan")
    pred = (score >= fixed_threshold).astype(int)
    p, r, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    cm = confusion_matrix(y, pred).tolist()
    bt, bf1 = _best_threshold(y, score)
    # Brier needs scores in [0,1]
    s01 = score if (score.min() >= 0 and score.max() <= 1) else (score - score.min()) / (score.ptp() or 1)
    brier = brier_score_loss(y, s01)
    return {
        "model": name, "roc_auc": round(float(auc), 4),
        "precision@0.5": round(float(p), 4), "recall@0.5": round(float(r), 4), "f1@0.5": round(float(f1), 4),
        "best_threshold": round(bt, 4), "f1@best": round(float(bf1), 4),
        "brier": round(float(brier), 4), "accuracy@0.5": round(float(accuracy_score(y, pred)), 4),
        "confusion@0.5": cm,
    }


def per_category(pairs: pd.DataFrame, y, score) -> dict:
    """Per-category ROC-AUC (fairness check across job families)."""
    score = np.asarray(score, dtype=float)
    y = np.asarray(y)
    out = {}
    for cat in sorted(pairs["category"].unique()):
        m = (pairs["category"] == cat).values
        if m.sum() >= 2 and len(np.unique(y[m])) > 1:
            out[cat] = round(float(roc_auc_score(y[m], score[m])), 4)
    if out:
        vals = list(out.values())
        out["_disparity"] = round(max(vals) - min(vals), 4)
    return out
