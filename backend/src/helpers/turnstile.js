/**
 * Cloudflare Turnstile server-side verification.
 *
 * Guarded by design: if TURNSTILE_SECRET_KEY is unset we SKIP verification and
 * return success, so local/dev flows keep working without configuring CAPTCHA.
 * Once the secret is set, a missing or invalid token is rejected.
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @param {string} token  - the cf-turnstile-response token from the client widget
 * @param {string} [remoteip] - optional client IP for additional validation
 * @returns {Promise<{ success: boolean, skipped?: boolean, error?: string }>}
 */
async function verifyTurnstile(token, remoteip) {
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();

  // No secret configured → CAPTCHA is effectively disabled (dev-friendly).
  if (!secret) {
    return { success: true, skipped: true };
  }

  if (!token) {
    return { success: false, error: 'CAPTCHA token missing' };
  }

  try {
    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', token);
    if (remoteip) form.append('remoteip', remoteip);

    const resp = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });

    const data = await resp.json().catch(() => ({}));
    if (data && data.success) {
      return { success: true };
    }
    return {
      success: false,
      error: 'CAPTCHA verification failed',
      codes: data['error-codes'] || []
    };
  } catch (err) {
    // Network/timeout: fail closed (reject) since a secret IS configured.
    console.error('Turnstile verification error:', err.message);
    return { success: false, error: 'CAPTCHA verification error' };
  }
}

module.exports = { verifyTurnstile };
