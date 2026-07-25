-- 108 -- Candidate decline (2026-07-10).
-- A candidate may decline an assigned screen BEFORE starting it
-- (POST /api/proof/submissions/:id/decline): only status='assigned' with started_at IS NULL
-- qualifies, so a started/submitted/scored/expired screen can never flip to declined. The route
-- sets status='declined' and declined_at=now(). The candidate's optional reason is
-- candidate-supplied text and rides in the existing metadata jsonb (103) as
-- metadata.decline_reason: no new text column, and the backend never logs it. declined_at gets a
-- real column so recruiter views (funnel, activity) can filter declined rows cheaply.
--
-- Status stays free TEXT (011 defines it with no CHECK constraint), so there is no constraint to
-- extend: 'declined' joins the documented value set below. 'declined' is TERMINAL for the row,
-- but a RE-INVITE un-declines: the invite endpoint's upsert resets the declined claimed
-- submission back to a clean 'assigned' row (declined_at + metadata.decline_reason cleared,
-- started_at/deadline_at back to null) because the recruiter explicitly asked again.
-- deadlineSweep only touches status IN ('assigned','in_progress'), so declined rows are never
-- reminded or expired.
--
-- DOWN (reversible):
--   update public.work_sample_submissions
--     set status = 'assigned', metadata = metadata - 'decline_reason'
--     where status = 'declined';
--   alter table public.work_sample_submissions drop column if exists declined_at;
--   comment on column public.work_sample_submissions.status is null;

alter table public.work_sample_submissions
  add column if not exists declined_at timestamptz;

comment on column public.work_sample_submissions.declined_at is
  'When the candidate declined the screen (allowed pre-start only: status was assigned with started_at null). Null unless status=declined. The optional candidate-supplied reason lives in metadata.decline_reason; a re-invite resets the row to assigned and clears both.';

comment on column public.work_sample_submissions.status is
  'assigned | in_progress | submitted | scored | expired | declined. Free text by design (011 shipped no CHECK constraint); the backend service role is the only writer (080).';

select 'candidate decline (108) ready' as status;
