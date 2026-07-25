-- 113 -- Domain-event outbox for the Confluent event backbone (2026-07-14).
-- Transactional-outbox pattern: AFTER triggers on the assessment lifecycle tables append a row to
-- public.domain_events in the SAME transaction as the domain write; an in-app relay
-- (backend/src/services/eventRelay.js, gated on CONFLUENT_STREAMING_ENABLED, default OFF) later
-- publishes unpublished rows to Confluent Cloud topics and stamps published_at. Nothing in this
-- migration talks to Kafka; with the flag off the only change is one extra insert per captured
-- lifecycle write.
--
-- COMPLIANCE RULE (product stance, enforced here and in backend tests): NO PII ever enters an
-- event payload. No emails, names, free text, response code, decline reasons, integrity meta, or
-- transcripts. Payloads carry pseudonymous ids (uuid), statuses, event types, timestamps, and
-- numeric metadata ONLY. Because payloads are pseudonymous, domain_events rows deliberately
-- PERSIST through candidate erasure: the candidate.erased event emitted from the
-- candidate_erasures ledger below IS the provable deletion record, and erasing it would destroy
-- the proof of erasure itself.
--
-- Topics + partition keys (per-subject ordering comes from the key; cross-topic ordering from
-- seq; consumers must treat delivery as at-least-once and dedupe on event id):
--   touchstones.lifecycle.v1  invite.sent (key = invite id), session.started,
--                             submission.submitted, submission.declined, review.scored
--                             (key = submission id)
--   touchstones.consent.v1    consent.recorded (key = submission id, else candidate id)
--   touchstones.integrity.v1  integrity.signal (key = submission id)
--   touchstones.deletion.v1   candidate.erased (key = the erased candidate's pseudonymous id)
--
-- DOWN (reversible; run manually to roll back):
--   drop trigger if exists trg_domain_event_invite_sent on public.work_sample_invites;
--   drop trigger if exists trg_domain_event_consent_recorded on public.proof_consent;
--   drop trigger if exists trg_domain_event_session_started on public.work_sample_submissions;
--   drop trigger if exists trg_domain_event_submission_submitted on public.work_sample_submissions;
--   drop trigger if exists trg_domain_event_submission_declined on public.work_sample_submissions;
--   drop trigger if exists trg_domain_event_integrity_signal on public.submission_integrity_events;
--   drop trigger if exists trg_domain_event_review_scored on public.proof_scores;
--   drop trigger if exists trg_domain_event_candidate_erased on public.candidate_erasures;
--   drop function if exists public.domain_event_invite_sent();
--   drop function if exists public.domain_event_consent_recorded();
--   drop function if exists public.domain_event_session_started();
--   drop function if exists public.domain_event_submission_submitted();
--   drop function if exists public.domain_event_submission_declined();
--   drop function if exists public.domain_event_integrity_signal();
--   drop function if exists public.domain_event_review_scored();
--   drop function if exists public.domain_event_candidate_erased();
--   drop function if exists public.emit_domain_event(text, text, text, jsonb);
--   -- restore erase_candidate to the 104 body (see 104_erasure_integrity_tombstone.sql);
--   drop table if exists public.candidate_erasures;
--   drop table if exists public.domain_events;

-- 1) The outbox itself -------------------------------------------------------------------------
-- seq (bigserial) is the relay's global publish order; (published_at, seq) serves the relay scan
-- (published_at is null order by seq). RLS enabled with NO policies: default-deny keeps anon and
-- authenticated out entirely; only the backend service role (which bypasses RLS) and the
-- security-definer emitters below can touch it (same posture as work_sample_invites, 106).
create table if not exists public.domain_events (
  id            uuid primary key default gen_random_uuid(),
  seq           bigserial,
  occurred_at   timestamptz not null default now(),
  event_type    text not null,
  topic         text not null,
  partition_key text not null,
  payload       jsonb not null,
  published_at  timestamptz
);

create index if not exists idx_domain_events_unpublished
  on public.domain_events (published_at, seq);

alter table public.domain_events enable row level security;

comment on table public.domain_events is
  'Transactional outbox for the Confluent event backbone. Pseudonymous payloads only (ids, statuses, timestamps, numeric metadata; never PII, free text, or media). Rows persist through candidate erasure by design: the deletion event is the provable erasure record. Relay: backend/src/services/eventRelay.js.';

-- 2) Emitter helper ----------------------------------------------------------------------------
-- SECURITY DEFINER so triggers fired by end-user DML (e.g. a candidate inserting their own
-- proof_consent row under RLS) can still append to the outbox, which end users cannot touch.
-- Locked down: only service_role may call it directly.
create or replace function public.emit_domain_event(
  p_event_type text, p_topic text, p_partition_key text, p_payload jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.domain_events (event_type, topic, partition_key, payload)
  values (p_event_type, p_topic, p_partition_key, p_payload);
$$;

revoke execute on function public.emit_domain_event(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.emit_domain_event(text, text, text, jsonb) to service_role;

-- 3) Pseudonymous erasure ledger ---------------------------------------------------------------
-- 104 tombstones integrity payloads inside erase_candidate but never left a queryable record that
-- an erasure happened. This ledger is that record: one row per erasure, ids only. candidate_id
-- has NO foreign key on purpose: the ledger must outlive the profile row it refers to (hard
-- erasure cascades the profile away when the auth user is deleted). RLS enabled, no policies
-- (service-role only), same posture as domain_events above.
create table if not exists public.candidate_erasures (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  mode         text not null check (mode in ('hard', 'anonymized')),
  occurred_at  timestamptz not null default now()
);

alter table public.candidate_erasures enable row level security;

comment on table public.candidate_erasures is
  'Pseudonymous right-to-erasure ledger: one row per erase_candidate run (ids + mode only, never PII). Written inside the erasure transaction; the AFTER INSERT trigger emits the candidate.erased domain event, the provable deletion record on touchstones.deletion.v1.';

-- 4) Trigger emitters (tiny bodies, insert-only) -----------------------------------------------
-- All SECURITY DEFINER for the same reason as emit_domain_event: several source tables accept
-- end-user DML under RLS, and the outbox must not be writable by those roles directly.
-- Payload builders are the no-PII enforcement point; backend/tests/unit/eventBackbone.spec.js
-- statically asserts no PII-ish key ever appears here.

-- invite.sent: NOT the invite email, NOT the recruiter message. Keyed by invite id because no
-- submission exists yet.
create or replace function public.domain_event_invite_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'invite.sent', 'touchstones.lifecycle.v1', new.id::text,
    jsonb_build_object(
      'invite_id',      new.id,
      'work_sample_id', new.work_sample_id,
      'invited_by',     new.invited_by,
      'invited_at',     new.created_at
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_invite_sent on public.work_sample_invites;
create trigger trg_domain_event_invite_sent
  after insert on public.work_sample_invites
  for each row execute function public.domain_event_invite_sent();

-- consent.recorded: ids + modality + version tag only; never the consent copy. Fires ONLY for
-- granted rows: a declined consent decision is never exposed to any external system (ADR-001
-- Principle 7, 088), and Kafka is an external system.
create or replace function public.domain_event_consent_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'consent.recorded', 'touchstones.consent.v1',
    coalesce(new.submission_id::text, new.candidate_id::text),
    jsonb_build_object(
      'consent_id',      new.id,
      'candidate_id',    new.candidate_id,
      'submission_id',   new.submission_id,
      'modality',        new.modality,
      'consent_version', new.consent_version,
      'granted_at',      new.granted_at
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_consent_recorded on public.proof_consent;
create trigger trg_domain_event_consent_recorded
  after insert on public.proof_consent
  for each row
  when (new.decision = 'granted')
  execute function public.domain_event_consent_recorded();

-- session.started: the 107 start gate stamps started_at exactly once (null until Start).
create or replace function public.domain_event_session_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'session.started', 'touchstones.lifecycle.v1', new.id::text,
    jsonb_build_object(
      'submission_id',  new.id,
      'work_sample_id', new.work_sample_id,
      'candidate_id',   new.candidate_id,
      'started_at',     new.started_at,
      'deadline_at',    new.deadline_at
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_session_started on public.work_sample_submissions;
create trigger trg_domain_event_session_started
  after update on public.work_sample_submissions
  for each row
  when (old.started_at is null and new.started_at is not null)
  execute function public.domain_event_session_started();

-- submission.submitted: status transition only; never response_text/response_code.
create or replace function public.domain_event_submission_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'submission.submitted', 'touchstones.lifecycle.v1', new.id::text,
    jsonb_build_object(
      'submission_id',  new.id,
      'work_sample_id', new.work_sample_id,
      'candidate_id',   new.candidate_id,
      'submitted_at',   new.submitted_at,
      'status',         new.status
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_submission_submitted on public.work_sample_submissions;
create trigger trg_domain_event_submission_submitted
  after update on public.work_sample_submissions
  for each row
  when (old.status is distinct from 'submitted' and new.status = 'submitted')
  execute function public.domain_event_submission_submitted();

-- submission.declined: declined_at transition only. metadata.decline_reason is candidate free
-- text (108) and MUST NOT ride along.
create or replace function public.domain_event_submission_declined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'submission.declined', 'touchstones.lifecycle.v1', new.id::text,
    jsonb_build_object(
      'submission_id',  new.id,
      'work_sample_id', new.work_sample_id,
      'declined_at',    new.declined_at
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_submission_declined on public.work_sample_submissions;
create trigger trg_domain_event_submission_declined
  after update on public.work_sample_submissions
  for each row
  when (old.declined_at is null and new.declined_at is not null)
  execute function public.domain_event_submission_declined();

-- integrity.signal: event kind + chain position only; NEVER meta (it can carry payload text,
-- 104) and never the hashes (the chain in Postgres is the tamper-evidence primitive, not Kafka).
create or replace function public.domain_event_integrity_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'integrity.signal', 'touchstones.integrity.v1', new.submission_id::text,
    jsonb_build_object(
      'integrity_event_id', new.id,
      'submission_id',      new.submission_id,
      'kind',               new.type,
      'category',           new.category,
      'chain_seq',          new.seq,
      'server_ts',          new.server_ts
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_integrity_signal on public.submission_integrity_events;
create trigger trg_domain_event_integrity_signal
  after insert on public.submission_integrity_events
  for each row execute function public.domain_event_integrity_signal();

-- review.scored: normalized score + outcome only; never per_criterion or override_reason
-- (free text). Outcome is a routing status (advance/reject/review) produced with human review in
-- the loop, never an automated verdict from a biometric-adjacent signal.
create or replace function public.domain_event_review_scored()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'review.scored', 'touchstones.lifecycle.v1', new.submission_id::text,
    jsonb_build_object(
      'score_id',         new.id,
      'submission_id',    new.submission_id,
      'rubric_version',   new.rubric_version,
      'normalized_score', new.normalized_score,
      'outcome',          new.outcome
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_review_scored on public.proof_scores;
create trigger trg_domain_event_review_scored
  after insert on public.proof_scores
  for each row execute function public.domain_event_review_scored();

-- candidate.erased: the provable deletion record. Ids + mode only; the id it names is
-- pseudonymous after erasure (profile scrubbed or gone).
create or replace function public.domain_event_candidate_erased()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform emit_domain_event(
    'candidate.erased', 'touchstones.deletion.v1', new.candidate_id::text,
    jsonb_build_object(
      'erasure_id',   new.id,
      'candidate_id', new.candidate_id,
      'mode',         new.mode,
      'erased_at',    new.occurred_at
    ));
  return null;
end;
$$;

drop trigger if exists trg_domain_event_candidate_erased on public.candidate_erasures;
create trigger trg_domain_event_candidate_erased
  after insert on public.candidate_erasures
  for each row execute function public.domain_event_candidate_erased();

-- 5) erase_candidate: the exact 104 body + one ledger insert per branch ------------------------
-- The ONLY change vs 104 is the INSERT INTO candidate_erasures before each successful RETURN,
-- inside the same transaction, so the deletion record (and its domain event) exists if and only
-- if the erasure committed.
create or replace function public.erase_candidate(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_scored int;
begin
  select account_type into v_type from profiles where id = p_uid;
  if v_type is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_type <> 'candidate' then return jsonb_build_object('ok', false, 'reason', 'not_candidate'); end if;
  if exists (select 1 from work_samples where owner_id = p_uid) then
    return jsonb_build_object('ok', false, 'reason', 'owns_screens');
  end if;
  if exists (select 1 from workspace_members where member_id = p_uid or owner_id = p_uid) then
    return jsonb_build_object('ok', false, 'reason', 'workspace_member');
  end if;

  select count(*) into v_scored
  from proof_scores ps join work_sample_submissions s on s.id = ps.submission_id
  where s.candidate_id = p_uid;

  -- verified_credentials has no inbound FK from the audit chain -> safe to delete in both paths.
  delete from verified_credentials where candidate_id = p_uid;

  if v_scored = 0 then
    -- 104: the cascade into submission_integrity_events must pass the append-only trigger;
    -- transaction-local GUC, flipped off again immediately after the delete.
    perform set_config('touchstone.erasure', 'on', true);
    delete from work_sample_submissions where candidate_id = p_uid; -- cascades to all linked tables
    perform set_config('touchstone.erasure', 'off', true);
    -- 113: provable deletion record (pseudonymous ids only; emits candidate.erased).
    insert into candidate_erasures (candidate_id, mode) values (p_uid, 'hard');
    return jsonb_build_object('ok', true, 'mode', 'hard');
  else
    update work_sample_submissions set response_text = null, response_code = null where candidate_id = p_uid;
    update profiles
      set email = 'deleted-' || p_uid::text || '@deleted.invalid', first_name = null, last_name = null, company = null
      where id = p_uid;

    -- Scrub candidate free-text in the KEPT linked tables (085). Scope to this candidate's
    -- submissions; keep the numeric scores + hash-chain rows intact.
    update ai_interactions set content = '[erased]'
      where submission_id in (select id from work_sample_submissions where candidate_id = p_uid);
    update ai_direction_scores set reasoning = null, per_dimension = null
      where submission_id in (select id from work_sample_submissions where candidate_id = p_uid);
    update interview_probes set turns = '[]'::jsonb, dimensions = null, reasoning = null
      where submission_id in (select id from work_sample_submissions where candidate_id = p_uid);

    -- 104: tombstone integrity event payloads. Chain columns (seq, type, category,
    -- timestamps, prev_hash, row_hash, source) are preserved so linkage and the signable
    -- head_hash still verify; the verifier skips the content hash of erased rows.
    perform set_config('touchstone.erasure', 'on', true);
    update submission_integrity_events set meta = jsonb_build_object('erased', true)
      where submission_id in (select id from work_sample_submissions where candidate_id = p_uid);
    perform set_config('touchstone.erasure', 'off', true);

    -- 113: provable deletion record (pseudonymous ids only; emits candidate.erased).
    insert into candidate_erasures (candidate_id, mode) values (p_uid, 'anonymized');
    return jsonb_build_object('ok', true, 'mode', 'anonymized');
  end if;
end;
$$;

revoke execute on function public.erase_candidate(uuid) from public, anon, authenticated;
grant execute on function public.erase_candidate(uuid) to service_role;

select 'domain-event outbox (113) ready' as status;
