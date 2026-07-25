/**
 * The 10 real Touchstones assessments. Each is plain data + a reference (correct) and a buggy
 * solution. `scripts/verify-cases.mjs` runs both locally to PROVE the cases discriminate (reference
 * passes all, buggy fails ≥1) before `scripts/seed-assessments.mjs` writes them into work_samples
 * with the structured per-case `tests` contract (3 visible "sample" cases, 7 hidden).
 *
 * role_family ∈ { senior-engineer, backend, devops, frontend }. language is the GRADING language
 * (the auto-graded harness is per-language). Each `cases` array is ordered so the first 3 are
 * visible:true (samples) and the rest hidden.
 */
import twoSum from './two-sum.mjs';
import mergeIntervals from './merge-intervals.mjs';
import lruCache from './lru-cache.mjs';
import tokenBucket from './token-bucket.mjs';
import paginate from './paginate.mjs';
import dedupeOrders from './dedupe-orders.mjs';
import logErrorRates from './log-error-rates.mjs';
import semverCompare from './semver-compare.mjs';
import formatDuration from './format-duration.mjs';
import validatePassword from './validate-password.mjs';

export default [
  twoSum,
  mergeIntervals,
  lruCache,
  tokenBucket,
  paginate,
  dedupeOrders,
  logErrorRates,
  semverCompare,
  formatDuration,
  validatePassword,
];
