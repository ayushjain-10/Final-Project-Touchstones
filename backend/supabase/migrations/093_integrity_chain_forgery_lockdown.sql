-- 093_integrity_chain_forgery_lockdown
-- Closes the integrity-chain forgery on submission_integrity_events. Before this: the lone RLS policy
-- (ie_candidate, cmd=ALL for the owning candidate) plus default table DML grants let a candidate directly
-- INSERT/UPDATE/DELETE their own chain via PostgREST — forging server_observed rows, rewriting row hashes,
-- or deleting events — and the SECURITY DEFINER append_integrity_event RPC let ANY authenticated caller
-- pass p_source='server_observed'. The chain is meant to be RPC-only, append-only, service-attributed.
-- REVERSAL (down): recreate "ie_candidate" FOR ALL with the same predicate; GRANT INSERT,UPDATE,DELETE
-- ON submission_integrity_events TO authenticated, anon; and CREATE OR REPLACE the RPC without the
-- v_actor_role guard block. Documented here so this is reversible per project rules.

-- (1) Reads stay; writes go. Replace the ALL policy with SELECT-only (candidate reads its own chain).
drop policy if exists ie_candidate on public.submission_integrity_events;
create policy ie_candidate_read on public.submission_integrity_events
  for select to authenticated
  using (exists (
    select 1 from public.work_sample_submissions s
    where s.id = submission_integrity_events.submission_id
      and s.candidate_id = auth.uid()
  ));

-- (2) Defense in depth: strip direct DML grants (incl. TRUNCATE, which RLS does NOT gate) from end-user
-- roles. Every write now goes through append_integrity_event (SECURITY DEFINER); reads use the policy
-- above (candidate) or supabaseAdmin (recruiter timeline + digest; service_role bypasses RLS).
revoke insert, update, delete, truncate, references, trigger
  on public.submission_integrity_events from anon, authenticated;

-- (3) Harden the append RPC: only service_role (backend via supabaseAdmin) may assert 'server_observed';
-- any authenticated end-user is clamped to 'client_attested' and may only append to a submission it owns
-- (closes both the trusted-event forgery and the cross-submission IDOR that SECURITY DEFINER opened).
create or replace function public.append_integrity_event(
  p_submission_id uuid,
  p_type text,
  p_category text default null::text,
  p_meta jsonb default '{}'::jsonb,
  p_client_ts text default null::text,
  p_source text default 'client_attested'::text
) returns table(out_seq integer, out_row_hash text, out_prev_hash text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_lock_key   bigint;
  v_prev_seq   int;
  v_prev_hash  text;
  v_count      int;
  v_new_seq    int;
  v_new_hash   text;
  v_actor_role text;
  c_max_events constant int := 500;
begin
  if p_submission_id is null then
    raise exception 'append_integrity_event: submission_id required';
  end if;

  -- SECURITY (093): SECURITY DEFINER bypasses RLS, so this function is the trust boundary. Only the
  -- backend (service_role, via supabaseAdmin) may assert a trusted 'server_observed' row; every other
  -- caller is clamped to 'client_attested' and, if it is an end-user JWT, may only write to a
  -- submission it owns. auth.role()/auth.uid() are the invoker's JWT claims (not the definer).
  v_actor_role := coalesce(auth.role(), '');
  if v_actor_role <> 'service_role' then
    p_source := 'client_attested';
    if v_actor_role = 'authenticated'
       and not exists (
         select 1 from public.work_sample_submissions s
         where s.id = p_submission_id and s.candidate_id = auth.uid()
       ) then
      raise exception 'append_integrity_event: not authorized for submission %', p_submission_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if coalesce(p_source, '') not in ('client_attested', 'server_observed') then
    raise exception 'append_integrity_event: invalid source %', p_source;
  end if;

  -- Per-submission transaction-scoped advisory lock (serializes appends to the same chain).
  v_lock_key := hashtextextended(p_submission_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select e.seq, e.row_hash
    into v_prev_seq, v_prev_hash
  from submission_integrity_events e
  where e.submission_id = p_submission_id
  order by e.seq desc
  limit 1
  for update;

  select count(*) into v_count
  from submission_integrity_events
  where submission_id = p_submission_id;

  if v_count >= c_max_events then
    raise exception 'append_integrity_event: chain cap reached (% events) for submission %',
      c_max_events, p_submission_id
      using errcode = 'check_violation';
  end if;

  v_new_seq := coalesce(v_prev_seq, 0) + 1;
  v_prev_hash := coalesce(
    v_prev_hash,
    encode(digest('genesis:' || p_submission_id::text, 'sha256'), 'hex')
  );

  v_new_hash := public.integrity_row_hash(
    v_prev_hash, v_new_seq, p_type, p_category, coalesce(p_meta, '{}'::jsonb), p_client_ts
  );

  insert into submission_integrity_events
    (submission_id, seq, type, category, meta, client_ts, server_ts, ts,
     prev_hash, row_hash, source)
  values
    (p_submission_id, v_new_seq,
     left(coalesce(p_type, 'unknown'), 40),
     case when p_category is null then null else left(p_category, 24) end,
     coalesce(p_meta, '{}'::jsonb),
     p_client_ts,
     now(), now(),
     v_prev_hash, v_new_hash, p_source);

  out_seq := v_new_seq;
  out_row_hash := v_new_hash;
  out_prev_hash := v_prev_hash;
  return next;
end;
$function$;
