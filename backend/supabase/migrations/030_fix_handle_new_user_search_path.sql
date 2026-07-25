-- 030_fix_handle_new_user_search_path.sql
-- handle_new_user() is the auth.users → profiles signup trigger. It was SECURITY
-- DEFINER with NO pinned search_path, so when it fires from the auth schema it could
-- not resolve the unqualified `profiles` table → EVERY signup failed with the opaque
-- "Database error creating new user" (and the demo seed). Fix: pin search_path = public,
-- schema-qualify the insert, and ON CONFLICT DO NOTHING so a pre-existing profile (e.g.
-- created by the backend's ensureAuthUser path) never breaks the signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    INSERT INTO public.profiles (id, email, first_name, last_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', '')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$function$;

SELECT 'handle_new_user search_path fixed' AS status;
