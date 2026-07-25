'use strict';

/**
 * Email compliance helpers (CAN-SPAM): postal footer, unsubscribe tokens/links, suppression.
 *
 * Marketing/nurture sends (waitlist welcome, demo nurture) must: carry the postal address (the
 * shared shell footer handles HTML; textFooter() covers plain-text bodies), embed a working
 * unsubscribe link, send List-Unsubscribe headers, and skip suppressed recipients. Transactional
 * sends (invites, score notifications, OTP) only need the postal footer, which the shell adds.
 *
 * Tokens/suppression live in public.email_unsubscribes (migration 102); the opt-out endpoint is
 * routes/emailUnsubscribe.js. Everything here is best-effort and non-throwing so a compliance
 * lookup failure can never break a send path.
 *
 * Env:
 *   EMAIL_POSTAL_ADDRESS  physical postal address for footers (owner must confirm before launch;
 *                         fallback = the address already shipping in the DB-trigger emails)
 *   API_PUBLIC_URL        base for the unsubscribe endpoint (fallback https://api.touchstones.ai)
 */

const { supabaseAdmin } = require('../config/supabase');

const CONTACT_EMAIL = 'help@touchstones.ai';

function postalAddress() {
  return (process.env.EMAIL_POSTAL_ADDRESS || 'TouchstonesAI, Inc. · 2058 Rutherford Lane, Fremont, CA 94539').trim();
}

function apiBase() {
  return (process.env.API_PUBLIC_URL || 'https://api.touchstones.ai').replace(/\/+$/, '');
}

/** Mint (or fetch) the recipient's unsubscribe URL. Returns null on any failure. */
async function getUnsubscribeUrl(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return null;
  try {
    const { data, error } = await supabaseAdmin.rpc('get_or_create_unsubscribe_token', { p_email: addr });
    if (error || !data) return null;
    return `${apiBase()}/api/email/unsubscribe?token=${data}`;
  } catch (e) {
    console.warn('emailCompliance: token mint failed (non-blocking):', e.message);
    return null;
  }
}

/** True when the address opted out of marketing email. Fails open (false) on lookup errors. */
async function isSuppressed(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from('email_unsubscribes')
      .select('unsubscribed_at')
      .eq('email', addr)
      .maybeSingle();
    if (error) {
      console.warn('emailCompliance: suppression lookup failed (non-blocking):', error.message);
      return false;
    }
    return !!(data && data.unsubscribed_at);
  } catch (e) {
    console.warn('emailCompliance: suppression lookup failed (non-blocking):', e.message);
    return false;
  }
}

/**
 * List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058 one-click). The mailto always ships;
 * the https URL and the one-click header only when a token URL is available.
 */
function listUnsubscribeHeaders(unsubscribeUrl) {
  if (!unsubscribeUrl) {
    return { 'List-Unsubscribe': `<mailto:${CONTACT_EMAIL}?subject=unsubscribe>` };
  }
  return {
    'List-Unsubscribe': `<mailto:${CONTACT_EMAIL}?subject=unsubscribe>, <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Footer link for the shell's [[footer_extra]] slot. Empty string when no URL. */
function unsubscribeFooterHtml(unsubscribeUrl) {
  if (!unsubscribeUrl) return '';
  return `<a href="${unsubscribeUrl}" style="color:#897B67; text-decoration:underline;">Unsubscribe</a><br>`;
}

/** CAN-SPAM footer for plain-text bodies: postal address, contact, and (optionally) unsubscribe. */
function textFooter(unsubscribeUrl) {
  const lines = [`${postalAddress()} · ${CONTACT_EMAIL}`];
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return `\n\n${lines.join('\n')}`;
}

module.exports = {
  CONTACT_EMAIL,
  postalAddress,
  getUnsubscribeUrl,
  isSuppressed,
  listUnsubscribeHeaders,
  unsubscribeFooterHtml,
  textFooter,
};
