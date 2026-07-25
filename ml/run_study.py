"""
run_study.py — orchestrates the resume<->JD matching study.

Usage:
  python run_study.py --sample --no-llm            # quick, no API key (CI default)
  python run_study.py                              # full: needs ml/data/UpdatedResumeDataSet.csv
  python run_study.py --llm-batch --llm-max 200    # include LLM scorer (Batch API)

Outputs to ml/results/: metrics.json, summary.csv, summary.md
"""
import argparse
import json
import pathlib
import pandas as pd
import pipeline as P


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/UpdatedResumeDataSet.csv")
    ap.add_argument("--sample", action="store_true", help="use bundled sample_resumes.csv")
    ap.add_argument("--no-llm", action="store_true", help="skip the LLM scorer (no API key / cost)")
    ap.add_argument("--llm-batch", action="store_true", help="use Anthropic Batch API (~50% cheaper)")
    ap.add_argument("--llm-max", type=int, default=None, help="cap LLM-scored pairs (cost control)")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--pairs-per-category", type=int, default=40)
    ap.add_argument("--max-features", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="results")
    args = ap.parse_args()

    here = pathlib.Path(__file__).parent
    data_path = (here / "sample_resumes.csv") if args.sample else pathlib.Path(args.data)
    if not data_path.is_absolute():
        data_path = here / data_path
    if not data_path.exists():
        raise SystemExit(f"Dataset not found: {data_path}\nUse --sample, or put the Kaggle CSV in ml/data/.")

    jds = json.loads((here / "job_descriptions.json").read_text())
    df = P.load_resumes(str(data_path))
    print(f"Loaded {len(df)} resumes across {df['category'].nunique()} categories from {data_path.name}")

    pairs = P.build_pairs(df, jds, pairs_per_category=args.pairs_per_category, seed=args.seed)
    y = pairs["label"].values
    print(f"Built {len(pairs)} pairs ({int(y.sum())} match / {int(len(y)-y.sum())} no-match), "
          f"{pairs['category'].nunique()} categories")

    X, extras = P.featurize(pairs, max_features=args.max_features)

    results, percat = [], {}

    print(f"Training classical classifiers ({args.folds}-fold stratified CV)...")
    for name, proba in P.run_classifiers(X, y, folds=args.folds, seed=args.seed).items():
        results.append(P.evaluate(name, y, proba, fixed_threshold=0.5))
        percat[name] = P.per_category(pairs, y, proba)

    print("Scoring unsupervised baselines (TF-IDF cosine, keyword overlap)...")
    for name, score in P.baseline_scores(pairs, extras).items():
        results.append(P.evaluate(name, y, score, fixed_threshold=0.5))
        percat[name] = P.per_category(pairs, y, score)

    if not args.no_llm:
        try:
            import llm_baseline as L
            scores = L.score_pairs(pairs, use_batch=args.llm_batch, max_pairs=args.llm_max)
            yL = y[:len(scores)]
            results.append(P.evaluate("llm_haiku_zeroshot", yL, scores, fixed_threshold=0.5))
            percat["llm_haiku_zeroshot"] = P.per_category(pairs.iloc[:len(scores)], yL, scores)
        except Exception as e:
            print(f"LLM baseline skipped: {e}")

    results.sort(key=lambda r: (r["roc_auc"] if r["roc_auc"] == r["roc_auc"] else -1), reverse=True)

    outdir = here / args.out
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "metrics.json").write_text(json.dumps(
        {"results": results, "per_category": percat, "config": vars(args), "n_pairs": int(len(pairs))}, indent=2))
    pd.DataFrame(results).drop(columns=["confusion@0.5"]).to_csv(outdir / "summary.csv", index=False)

    cols = ["model", "roc_auc", "f1@0.5", "f1@best", "precision@0.5", "recall@0.5", "brier"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join(["---"] * len(cols)) + "|"]
    for r in results:
        lines.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    (outdir / "summary.md").write_text(
        f"# Resume<->JD matching - results\n\n{len(pairs)} pairs, {args.folds}-fold CV.\n\n" + "\n".join(lines) + "\n")

    print("\n=== RESULTS (ranked by ROC-AUC) ===")
    print("\n".join(lines))
    print(f"\nWrote {outdir}/metrics.json, summary.csv, summary.md")


if __name__ == "__main__":
    main()
