-- 106 -- Work-sample invite tracking (2026-07-09).
-- One row per (screen, invited email). POST /api/proof/work-samples/:id/invite upserts here so
-- (a) recruiters can see who they invited and how far each person got
--     (GET /api/proof/work-samples/invites/overview), and
-- (b) a candidate who signs up AFTER being invited gets their pending invites converted into real
--     submissions on their first dashboard load (claim-on-arrival in GET /api/portal/assignments),
--     which stamps claimed_by / claimed_at / submission_id.
--
-- Access: RLS enabled. Recruiters can SELECT invites for screens they own (mirrors variants_owner,
-- 029). NO insert/update/delete policies for end users: every write goes through the backend
-- service role (invite upsert, claim stamp), so one candidate can never read or forge another
-- candidate's invite rows.
--
-- DOWN (reversible):
--   drop table if exists public.work_sample_invites;

create table if not exists public.work_sample_invites (
  id             uuid primary key default gen_random_uuid(),
  work_sample_id uuid not null references public.work_samples(id) on delete cascade,
  email          text not null,
  invited_by     uuid not null references public.profiles(id),
  message        text,
  created_at     timestamptz not null default now(),
  claimed_by     uuid references public.profiles(id),
  claimed_at     timestamptz,
  submission_id  uuid references public.work_sample_submissions(id) on delete set null,
  constraint work_sample_invites_email_lower check (email = lower(email)),
  constraint work_sample_invites_ws_email_unique unique (work_sample_id, email)
);

create index if not exists idx_work_sample_invites_email on public.work_sample_invites (email);
create index if not exists idx_work_sample_invites_ws on public.work_sample_invites (work_sample_id);

alter table public.work_sample_invites enable row level security;

-- Owner-scoped read only (mirrors variants_owner, 029). Writes have no policy on purpose:
-- RLS default-deny keeps the authenticated role out; the service role bypasses RLS.
drop policy if exists invites_owner_select on public.work_sample_invites;
create policy invites_owner_select on public.work_sample_invites for select to authenticated
  using (exists (select 1 from work_samples w where w.id = work_sample_id and w.owner_id = auth.uid()));

select 'work_sample_invites ready' as status;
