-- 081 — Make the signup welcome email ROLE-AWARE. The live trigger
-- users_resend_audience (AFTER INSERT ON auth.users) → notify_resend_on_new_user() already adds the
-- contact to the Resend audience and sends a welcome — but the copy is recruiter-framed ("author a
-- screen, invite a candidate"), which is wrong now that every signup defaults to account_type
-- 'candidate' (077). handle_new_user (trigger 'on_auth_user_created') fires before this one
-- (alphabetical), so the profile + its account_type exist by the time we run; branch on it.
-- Unchanged: vault key read, audience upsert, and the fail-safe `exception when others then return new`
-- (a welcome failure can never block signup).
--
-- NOTE: this function was applied by hand to the live DB (not previously in a migration); this file
-- captures the role-aware version in source. Apply via the Management API like the other migrations.

CREATE OR REPLACE FUNCTION public.notify_resend_on_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net', 'vault'
AS $function$
declare
  k text;
  meta jsonb;
  fname text;
  acct text;
  bodytext text;
  html text;
begin
  if new.email is null then return new; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if k is null then return new; end if;
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fname := coalesce(nullif(coalesce(meta->>'first_name', split_part(coalesce(meta->>'full_name', meta->>'name', ''), ' ', 1)), ''), 'there');

  -- add to the audience (unchanged)
  perform net.http_post(
    url := 'https://api.resend.com/audiences/0754ed02-fa55-4417-8c14-1cec558332c5/contacts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_strip_nulls(jsonb_build_object('email', lower(new.email), 'first_name', nullif(fname, 'there'), 'unsubscribed', false))
  );

  -- role-aware body (the profile exists by now; default to candidate framing if missing)
  select account_type into acct from public.profiles where id = new.id;
  if acct = 'recruiter' then
    bodytext := 'Hi ' || fname || ', your account is ready. Author a short, AI-allowed real-work screen, invite a candidate, and get one explainable, audit-ready score with the reasoning behind it.';
  else
    bodytext := 'Hi ' || fname || ', welcome! When a company invites you to a short, real-work Touchstones screen, it''ll appear in your portal. AI is allowed — we measure how you think, not whether you memorized. There''s nothing to set up; just open your invitation link when it arrives.';
  end if;

  html := replace($html$<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:0;background-color:#F1EADD;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;"><tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:34px 36px;"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">Welcome to Touchstones</h1><p style="margin:0 0 14px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">%%BODY%%</p><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">Questions? Just reply — a real person reads these.</p><hr style="border:none;border-top:1px solid #E7DDCF;margin:24px 0 16px;"><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Touchstones · 2058 Rutherford Lane, Fremont, CA 94539</p></td></tr></table></td></tr></table></body></html>$html$, '%%BODY%%', bodytext);

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', 'Touchstones <ayush@touchstones.ai>', 'reply_to', 'support@touchstones.ai', 'to', jsonb_build_array(new.email), 'subject', 'Welcome to Touchstones', 'html', html)
  );

  return new;
exception when others then
  return new;
end;
$function$;
