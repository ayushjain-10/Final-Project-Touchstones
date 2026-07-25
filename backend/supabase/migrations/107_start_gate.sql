-- 107 -- Start gate: the assessment timer starts at explicit candidate Start (2026-07-10).
-- Behavior change (backend): createSubmission (proof.js, shared with the invite claim in
-- portal.js) no longer stamps started_at / deadline_at at assignment. Both stay NULL until the
-- candidate presses Start (POST /api/proof/submissions/:id/start), which stamps
-- started_at = now() and deadline_at = now() + work_samples.duration_minutes. deadlineSweep only
-- reminds / expires rows whose deadline_at matches its range filters, and SQL NULL comparisons are
-- never true, so an assigned-but-never-started screen can no longer expire or burn its timer.
--
-- Schema reality (011_proof_work_samples.sql): started_at and deadline_at are already nullable
-- TIMESTAMPTZ, so no column change is needed. This migration documents the new semantics and adds
-- a partial index for the sweep's two scans (active status + deadline_at range).
--
-- DOWN (reversible):
--   drop index if exists idx_wss_active_deadline;
--   comment on column public.work_sample_submissions.started_at is null;
--   comment on column public.work_sample_submissions.deadline_at is null;

comment on column public.work_sample_submissions.started_at is
  'When the candidate pressed Start (null until then). Rows created before migration 107 stamped this at assignment.';

comment on column public.work_sample_submissions.deadline_at is
  'Server-enforced deadline, stamped at Start as started_at + work_samples.duration_minutes. Null until the candidate starts; null rows are never reminded or expired by deadlineSweep.';

-- deadlineSweep scans status IN ('assigned','in_progress') with a deadline_at range each tick.
-- The partial index keeps both queries cheap and naturally excludes unstarted (null) rows.
create index if not exists idx_wss_active_deadline
  on public.work_sample_submissions (deadline_at)
  where status in ('assigned', 'in_progress') and deadline_at is not null;

select 'start gate (107) ready' as status;
