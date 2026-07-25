-- 079 — Harden the self-promotion guard. The column-level REVOKE in 077 was INEFFECTIVE: a
-- table-level UPDATE grant to `authenticated` (Supabase's default) overrides column-level REVOKEs,
-- so a candidate could PATCH their own profile to account_type='recruiter' via direct PostgREST
-- (verified by a direct-PostgREST attack test). The robust fix is a BEFORE UPDATE trigger that
-- forbids the user-facing roles from changing the role columns. service_role (the backend approval
-- flow) and superuser migrations are unaffected, so the backend stays the only writer.
--
-- NOTE: NOT SECURITY DEFINER on purpose — we need current_user to reflect the PostgREST-set role
-- (authenticated / anon / service_role); a SECURITY DEFINER function would report the owner instead.

CREATE OR REPLACE FUNCTION public.guard_profile_role_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.recruiter_status IS DISTINCT FROM OLD.recruiter_status
       OR NEW.recruiter_verified_at IS DISTINCT FROM OLD.recruiter_verified_at
     ) THEN
    RAISE EXCEPTION 'role columns (account_type/recruiter_status) are not user-editable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_role ON public.profiles;
CREATE TRIGGER profiles_guard_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role_columns();
