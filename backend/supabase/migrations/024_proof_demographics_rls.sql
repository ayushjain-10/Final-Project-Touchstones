-- 024_proof_demographics_rls.sql  (roadmap #11)
-- proof_demographics holds special-category data (sex, race/ethnicity) collected ONLY
-- for aggregate EEOC/LL-144 adverse-impact auditing — it is NEVER joined into the
-- scoring path and must NEVER be recruiter-readable. 011 added a policy `demo_self`
-- FOR ALL USING/ WITH CHECK (candidate_id = auth.uid()), which contradicts the table's
-- own "service-role only" comment: FOR ALL grants the subject SELECT/UPDATE/DELETE too,
-- and any future recruiter-readable widening of that policy would expose Art.9 data.
--
-- Correct posture: the subject may only INSERT their own row (self-report). Reads happen
-- exclusively via the service-role (bias-audit aggregation), never via PostgREST. So:
-- drop demo_self, add an INSERT-only WITH CHECK (candidate_id = auth.uid()), and add NO
-- select/update/delete policy — with RLS enabled, absent policies = deny for end users.

-- Drop the over-broad FOR ALL policy by its real name (defined in 011_proof_work_samples).
DROP POLICY IF EXISTS demo_self ON proof_demographics;

-- RLS is already enabled (011); assert it idempotently in case of partial state.
ALTER TABLE proof_demographics ENABLE ROW LEVEL SECURITY;

-- INSERT-only by the subject. No USING clause (INSERT has no row to read); the WITH CHECK
-- binds the inserted row to the authenticated subject so one candidate cannot file
-- demographics under another's id.
CREATE POLICY demo_self_insert ON proof_demographics
  FOR INSERT
  TO authenticated
  WITH CHECK (candidate_id = auth.uid());

-- Deliberately NO select/update/delete policy: only the service-role (bias-audit worker,
-- which bypasses RLS) reads this table. Subjects cannot read it back, recruiters cannot
-- see it at all.

SELECT 'proof_demographics RLS hardened (insert-only by subject, service-role read)' AS status;
