-- 089 — founder notification on waitlist/demo inserts, INSIDE the DB trigger where the
-- requester auto-reply already lives (notify_resend_on_waitlist, added 2026-06-27).
--
-- WHY HERE: the contact/demo form inserts into public.waitlist via the anon client (no backend
-- hop), and this trigger function stamps welcomed_at in the same transaction — which permanently
-- loses the backend webhook's once-only claim, so hooks.js notifyFounder can never fire. The
-- legacy `signup` trigger also posts to the PROD backend with a placeholder secret ("random"),
-- so no founder notification existed on ANY path. This puts it at the source: fires for both
-- production-site and dev-site signups (shared DB), no env/secret dependency, reply_to = the
-- requester so the founder replies straight from the inbox.
--
-- Recipient: ayush@touchstones.ai (owner-specified; domain has Google MX — deliverable).
--
-- DOWN: re-apply the previous version of notify_resend_on_waitlist() (this file's function body
-- minus the "3) founder notification" block — the prior definition is preserved in git history
-- and in the Supabase migration log for 2026-06-27).

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
    if coalesce(new.kind, 'waitlist') = 'demo' then
      subj := 'Thanks for reaching out to Touchstones';
      html := replace($html$<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:0;background-color:#F1EADD;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;"><tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:34px 36px;"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">Thanks for reaching out</h1><p style="margin:0 0 14px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">Hi %%FIRST_NAME%%, we got your message — a real person will get back to you, usually within a day.</p><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">If it's urgent, just reply to this email.</p><hr style="border:none;border-top:1px solid #E7DDCF;margin:24px 0 16px;"><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Touchstones · 2058 Rutherford Lane, Fremont, CA 94539</p></td></tr></table></td></tr></table></body></html>$html$, '%%FIRST_NAME%%', fname);
    else
      subj := 'You''re on the Touchstones waitlist';
      html := replace($html$<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin:0;padding:0;background-color:#F1EADD;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1EADD;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;"><tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:34px 36px;"><p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">You're on the waitlist</h1><p style="margin:0 0 14px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">Hi %%FIRST_NAME%%, thanks for joining. We're onboarding teams gradually — we'll reach out as we open up early access to design partners.</p><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4D4437;">In the meantime, just reply if you have any questions — a real person reads these.</p><hr style="border:none;border-top:1px solid #E7DDCF;margin:24px 0 16px;"><p style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#897B67;">Touchstones · 2058 Rutherford Lane, Fremont, CA 94539<br>You're receiving this because you joined the Touchstones waitlist.</p></td></tr></table></td></tr></table></body></html>$html$, '%%FIRST_NAME%%', fname);
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', 'Touchstones <ayush@touchstones.ai>', 'reply_to', 'support@touchstones.ai', 'to', jsonb_build_array(new.email), 'subject', subj, 'html', html)
    );

    -- 3) founder notification (2026-07-02): the message/signup itself, to the owner's inbox,
    --    with reply_to = the requester so a reply goes straight to them. HTML-escaped values.
    esc_name    := replace(replace(replace(coalesce(new.name, '—'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    esc_email   := replace(replace(replace(coalesce(new.email, '—'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    esc_company := replace(replace(replace(coalesce(new.company, '—'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    esc_msg     := replace(replace(replace(coalesce(new.message, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

    if coalesce(new.kind, 'waitlist') = 'demo' then
      founder_subj := 'New message — ' || coalesce(nullif(new.company, ''), new.email);
    else
      founder_subj := 'New waitlist signup — ' || coalesce(nullif(new.company, ''), new.email);
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
        'from', 'Touchstones <ayush@touchstones.ai>',
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
