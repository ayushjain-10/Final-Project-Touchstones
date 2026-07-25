-- 102 -- Email unsubscribe / suppression store (CAN-SPAM hardening, 2026-07-09).
-- One row per recipient address that has ever been issued an unsubscribe token; unsubscribed_at is
-- stamped when the recipient opts out (link click or RFC 8058 one-click POST). Marketing/nurture
-- send paths (backend waitlistNurture sweep; the pg_net trigger emails via 105) embed the token in
-- their unsubscribe URL and List-Unsubscribe headers. Transactional email (invites, score
-- notifications, OTP) never consults this table. Resend Broadcasts keep their own built-in
-- {{{RESEND_UNSUBSCRIBE_URL}}} mechanism; the backend endpoint mirrors opt-outs into the Resend
-- audience so both stay in sync.
--
-- Access: RLS enabled with NO policies. Only the service role (backend) and the SECURITY DEFINER
-- helper below (called by the pg_net trigger functions, see 105) touch it. No tenant column by
-- design: the table keys on bare recipient addresses, which span tenants.
--
-- DOWN (reversible):
--   drop function if exists public.get_or_create_unsubscribe_token(text);
--   drop table if exists public.email_unsubscribes;

create table if not exists public.email_unsubscribes (
  email           text primary key,
  token           uuid not null unique default gen_random_uuid(),
  unsubscribed_at timestamptz,
  source          text,
  created_at      timestamptz not null default now(),
  constraint email_unsubscribes_email_lower check (email = lower(email))
);

alter table public.email_unsubscribes enable row level security;

-- Issue (or return the existing) unsubscribe token for an address. SECURITY DEFINER so the pg_net
-- email trigger functions (105) can mint tokens without any table grant leaking to client roles.
create or replace function public.get_or_create_unsubscribe_token(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(trim(p_email));
  v_token uuid;
begin
  if v_email is null or v_email = '' then
    return null;
  end if;
  insert into public.email_unsubscribes (email) values (v_email)
  on conflict (email) do nothing;
  select token into v_token from public.email_unsubscribes where email = v_email;
  return v_token;
end;
$$;

revoke all on table public.email_unsubscribes from public, anon, authenticated;
revoke all on function public.get_or_create_unsubscribe_token(text) from public, anon, authenticated;
grant execute on function public.get_or_create_unsubscribe_token(text) to service_role;
