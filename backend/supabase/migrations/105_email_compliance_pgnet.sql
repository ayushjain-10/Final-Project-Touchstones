-- 105 -- CAN-SPAM compliance for the pg_net trigger emails (2026-07-09).
-- (105, not 103: 103_submission_metadata and 104_erasure_integrity_tombstone landed in parallel.)
-- Re-creates the two DB-side senders (081 notify_resend_on_new_user, 089 notify_resend_on_waitlist)
-- with: List-Unsubscribe / List-Unsubscribe-Post headers on every recipient-facing send, a visible
-- Unsubscribe link on the waitlist welcome (the marketing-relationship email), a help@touchstones.ai
-- contact link next to the postal line, and the standard from/reply-to pair used by the backend
-- (from "Touchstones <noreply@touchstones.ai>", reply-to help@touchstones.ai; the founder
-- notification keeps reply_to = the requester). Unsubscribe tokens come from
-- public.get_or_create_unsubscribe_token (migration 102); if 102 is missing or the call fails, the
-- send still goes out with a mailto-only List-Unsubscribe header.
-- The unsubscribe URL base mirrors the backend env API_PUBLIC_URL (https://api.touchstones.ai).
-- Suppression is NOT checked here: both triggers fire on a fresh signup/insert, which is fresh
-- consent; the ongoing marketing path (waitlistNurture sweep) checks it backend-side.
--
-- DOWN (reversible): re-apply 081_welcome_role_aware.sql and 089_waitlist_founder_notify.sql
-- (the exact prior definitions of both functions).

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
  t uuid;
  unsub_url text;
  hdrs jsonb;
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

  -- unsubscribe token (best effort; a mailto-only header still ships if this fails)
  begin
    t := public.get_or_create_unsubscribe_token(new.email);
  exception when others then
    t := null;
  end;
  if t is not null then
    unsub_url := 'https://api.touchstones.ai/api/email/unsubscribe?token=' || t::text;
    hdrs := jsonb_build_object(
      'List-Unsubscribe', '<mailto:help@touchstones.ai?subject=unsubscribe>, <' || unsub_url || '>',
      'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');
  else
    hdrs := jsonb_build_object('List-Unsubscribe', '<mailto:help@touchstones.ai?subject=unsubscribe>');
  end if;

  -- role-aware body (the profile exists by now; default to candidate framing if missing)
  select account_type into acct from public.profiles where id = new.id;
  if acct = 'recruiter' then
    bodytext := 'Hi ' || fname || ', your account is ready. Author a short, AI-allowed real-work screen, invite a candidate, and get one explainable, audit-ready score with the reasoning behind it.';
  else
    bodytext := 'Hi ' || fname || ', welcome! When a company invites you to a short, real-work Touchstones screen, it''ll appear in your portal. AI is allowed: we measure how you think, not whether you memorized. There''s nothing to set up; just open your invitation link when it arrives.';
  end if;

  html := replace($html$<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:0;background-color:#F1EADD;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;"><tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:34px 36px;"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">Welcome to Touchstones</h1><p style="margin:0 0 14px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">%%BODY%%</p><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">Questions? Just reply. A real person reads these.</p><hr style="border:none;border-top:1px solid #E7DDCF;margin:24px 0 16px;"><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Touchstones &middot; 2058 Rutherford Lane, Fremont, CA 94539 &middot; <a href="mailto:help@touchstones.ai" style="color:#897B67;text-decoration:underline;">help@touchstones.ai</a></p></td></tr></table></td></tr></table></body></html>$html$, '%%BODY%%', bodytext);

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', 'Touchstones <noreply@touchstones.ai>', 'reply_to', 'help@touchstones.ai', 'to', jsonb_build_array(new.email), 'subject', 'Welcome to Touchstones', 'html', html, 'headers', hdrs)
  );

  return new;
exception when others then
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_resend_on_waitlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'vault'
AS $function$
declare
  k text;
  fword text;
  fname text;
  subj text;
  html text;
  founder_subj text;
  founder_html text;
  esc_name text;
  esc_email text;
  esc_company text;
  esc_msg text;
  t uuid;
  unsub_url text;
  hdrs jsonb;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if k is null then return new; end if;
  fword := nullif(split_part(coalesce(new.name, ''), ' ', 1), '');
  fname := coalesce(fword, 'there');

  -- 1) add to the Resend audience
  perform net.http_post(
    url := 'https://api.resend.com/audiences/0754ed02-fa55-4417-8c14-1cec558332c5/contacts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_strip_nulls(jsonb_build_object('email', lower(new.email), 'first_name', fword, 'unsubscribed', false))
  );

  -- 2) send the right confirmation exactly once
  if new.welcomed_at is null then
    -- unsubscribe token (best effort; a mailto-only header still ships if this fails)
    begin
      t := public.get_or_create_unsubscribe_token(new.email);
    exception when others then
      t := null;
    end;
    if t is not null then
      unsub_url := 'https://api.touchstones.ai/api/email/unsubscribe?token=' || t::text;
      hdrs := jsonb_build_object(
        'List-Unsubscribe', '<mailto:help@touchstones.ai?subject=unsubscribe>, <' || unsub_url || '>',
        'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');
    else
      hdrs := jsonb_build_object('List-Unsubscribe', '<mailto:help@touchstones.ai?subject=unsubscribe>');
    end if;

    if coalesce(new.kind, 'waitlist') = 'demo' then
      subj := 'Thanks for reaching out to Touchstones';
      html := replace($html$<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:0;background-color:#F1EADD;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;"><tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:34px 36px;"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">Thanks for reaching out</h1><p style="margin:0 0 14px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">Hi %%FIRST_NAME%%, we got your message. A real person will get back to you, usually within a day.</p><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">If it's urgent, just reply to this email.</p><hr style="border:none;border-top:1px solid #E7DDCF;margin:24px 0 16px;"><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Touchstones &middot; 2058 Rutherford Lane, Fremont, CA 94539 &middot; <a href="mailto:help@touchstones.ai" style="color:#897B67;text-decoration:underline;">help@touchstones.ai</a></p></td></tr></table></td></tr></table></body></html>$html$, '%%FIRST_NAME%%', fname);
    else
      subj := 'You''re on the Touchstones waitlist';
      html := replace(replace($html$<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:0;background-color:#F1EADD;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;"><tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:34px 36px;"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">You're on the waitlist</h1><p style="margin:0 0 14px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">Hi %%FIRST_NAME%%, thanks for joining. We're onboarding teams gradually. We'll reach out as we open up early access to design partners.</p><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">In the meantime, just reply if you have any questions. A real person reads these.</p><hr style="border:none;border-top:1px solid #E7DDCF;margin:24px 0 16px;"><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Touchstones &middot; 2058 Rutherford Lane, Fremont, CA 94539 &middot; <a href="mailto:help@touchstones.ai" style="color:#897B67;text-decoration:underline;">help@touchstones.ai</a><br>You're receiving this because you joined the Touchstones waitlist. %%UNSUB_LINK%%</p></td></tr></table></td></tr></table></body></html>$html$, '%%FIRST_NAME%%', fname),
        '%%UNSUB_LINK%%',
        case when unsub_url is not null
          then '<a href="' || unsub_url || '" style="color:#897B67;text-decoration:underline;">Unsubscribe</a>'
          else '<a href="mailto:help@touchstones.ai?subject=unsubscribe" style="color:#897B67;text-decoration:underline;">Unsubscribe</a>'
        end);
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', 'Touchstones <noreply@touchstones.ai>', 'reply_to', 'help@touchstones.ai', 'to', jsonb_build_array(new.email), 'subject', subj, 'html', html, 'headers', hdrs)
    );

    -- 3) founder notification (2026-07-02): the message/signup itself, to the owner's inbox,
    --    with reply_to = the requester so a reply goes straight to them. HTML-escaped values.
    esc_name    := replace(replace(replace(coalesce(new.name, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    esc_email   := replace(replace(replace(coalesce(new.email, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    esc_company := replace(replace(replace(coalesce(new.company, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    esc_msg     := replace(replace(replace(coalesce(new.message, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

    if coalesce(new.kind, 'waitlist') = 'demo' then
      founder_subj := 'New message: ' || coalesce(nullif(new.company, ''), new.email);
    else
      founder_subj := 'New waitlist signup: ' || coalesce(nullif(new.company, ''), new.email);
    end if;

    founder_html :=
      '<!DOCTYPE html><html lang="en"><body style="margin:0;padding:0;background-color:#F1EADD;">'
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;">'
      '<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;">'
      '<tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr>'
      '<tr><td style="padding:34px 36px;">'
      '<p style="margin:0 0 20px;font-family:Georgia,''Times New Roman'',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p>'
      '<h1 style="margin:0 0 14px;font-family:Georgia,''Times New Roman'',serif;font-size:22px;line-height:28px;font-weight:600;color:#221E18;">' ||
        (case when coalesce(new.kind, 'waitlist') = 'demo' then 'New message from the site' else 'New waitlist signup' end) ||
      '</h1>'
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #E7DDCF;border-bottom:1px solid #E7DDCF;margin:0 0 14px;">'
      '<tr><td style="padding:6px 12px 6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#897B67;white-space:nowrap;vertical-align:top;">Name</td><td style="padding:6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#221E18;">' || esc_name || '</td></tr>'
      '<tr><td style="padding:6px 12px 6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#897B67;white-space:nowrap;vertical-align:top;">Email</td><td style="padding:6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#221E18;">' || esc_email || '</td></tr>'
      '<tr><td style="padding:6px 12px 6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#897B67;white-space:nowrap;vertical-align:top;">Company</td><td style="padding:6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#221E18;">' || esc_company || '</td></tr>'
      || (case when esc_msg <> '' then
      '<tr><td style="padding:6px 12px 6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#897B67;white-space:nowrap;vertical-align:top;">Message</td><td style="padding:6px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#221E18;">' || esc_msg || '</td></tr>'
      else '' end) ||
      '</table>'
      '<p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Reply to this email to answer them directly.</p>'
      '</td></tr></table></td></tr></table></body></html>';

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'Touchstones <noreply@touchstones.ai>',
        'reply_to', new.email,
        'to', jsonb_build_array('ayush@touchstones.ai'),
        'subject', founder_subj,
        'html', founder_html
      )
    );

    update public.waitlist set welcomed_at = now() where email = new.email and welcomed_at is null;
  end if;

  return new;
exception when others then
  return new;
end;
$function$;
