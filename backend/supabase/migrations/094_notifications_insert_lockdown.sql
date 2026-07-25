-- 094_notifications_insert_lockdown
-- The "Service can create notifications" INSERT policy was PERMISSIVE for role public WITH CHECK (true),
-- so any authenticated (or anon) user could insert a notification into ANY user's feed (forgery/phishing:
-- an arbitrary message + link dropped into a recruiter's notification list). Notifications are only ever
-- created by the backend via supabaseAdmin (comments.js, workflowNotify.js) = service_role, which bypasses
-- RLS. Drop the end-user INSERT path; keep users' own SELECT + UPDATE (mark-as-read). Also strip
-- INSERT/DELETE/TRUNCATE grants from end-user roles (TRUNCATE is RLS-immune).
-- REVERSAL (down): recreate policy "Service can create notifications" FOR INSERT TO public WITH CHECK
-- (true); GRANT INSERT ON public.notifications TO authenticated, anon.
drop policy if exists "Service can create notifications" on public.notifications;
revoke insert, delete, truncate on public.notifications from anon, authenticated;
