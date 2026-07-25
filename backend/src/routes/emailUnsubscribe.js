'use strict';

/**
 * Public unsubscribe endpoint (CAN-SPAM + RFC 8058 one-click).
 *
 *   GET  /api/email/unsubscribe?token=<uuid>  human click from the email footer: records the
 *                                             opt-out and renders a plain confirmation page
 *   POST /api/email/unsubscribe?token=<uuid>  mail-client one-click (List-Unsubscribe-Post):
 *                                             records the opt-out, returns 200 with no body
 *
 * Tokens are opaque per-address uuids minted at send time (email_unsubscribes, migration 102), so
 * the endpoint needs no auth and never accepts a raw email address. Opt-outs are mirrored into the
 * Resend audience (best effort) so Broadcasts skip the contact too.
 */

const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const resendAudience = require('../services/resendAudience');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function optOut(token, source) {
  if (!UUID_RE.test(String(token || ''))) return { ok: false, status: 400 };
  const { data: row, error } = await supabaseAdmin
    .from('email_unsubscribes')
    .select('email, unsubscribed_at')
    .eq('token', token)
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!row) return { ok: false, status: 404 };
  if (!row.unsubscribed_at) {
    const { error: updErr } = await supabaseAdmin
      .from('email_unsubscribes')
      .update({ unsubscribed_at: new Date().toISOString(), source })
      .eq('token', token)
      .is('unsubscribed_at', null);
    if (updErr) return { ok: false, status: 500 };
  }
  resendAudience.setUnsubscribed(row.email).catch(() => {});
  return { ok: true, email: row.email };
}

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Minimal branded page (terracotta/ink, matches the email shell palette).
function page(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Touchstones</title></head>
<body style="margin:0;padding:0;background-color:#F1EADD;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:64px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;background-color:#FCF9F3;border:1px solid #E7DDCF;border-radius:16px;overflow:hidden;">
<tr><td style="height:4px;background-color:#BD5B3D;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:34px 36px;">
<p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#221E18;">Touchstones</p>
<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#221E18;">${esc(title)}</h1>
<p style="margin:0;font-size:15px;line-height:24px;color:#4D4437;">${message}</p>
</td></tr></table></td></tr></table></body></html>`;
}

router.get('/unsubscribe', async (req, res) => {
  const out = await optOut(req.query.token, 'link');
  res.set('Cache-Control', 'no-store');
  if (!out.ok) {
    return res.status(out.status).send(page(
      'This link is not valid',
      `We could not match this unsubscribe link. To opt out, email <a href="mailto:help@touchstones.ai" style="color:#A54A30;">help@touchstones.ai</a> and we will action it.`,
    ));
  }
  return res.send(page(
    "You're unsubscribed",
    `<strong style="color:#221E18;">${esc(out.email)}</strong> will no longer receive marketing email from Touchstones. ` +
      'You may still receive transactional messages about assessments or an account you take part in. ' +
      `Unsubscribed by mistake? Email <a href="mailto:help@touchstones.ai" style="color:#A54A30;">help@touchstones.ai</a>.`,
  ));
});

// RFC 8058 one-click: mail clients POST here with no user interaction; body must be ignored and
// the response must not require confirmation.
router.post('/unsubscribe', async (req, res) => {
  const out = await optOut(req.query.token, 'one_click');
  res.status(out.ok ? 200 : out.status).end();
});

module.exports = router;
