/**
 * partnerBasicKeyAuth - shared inbound auth for ATS partner-hosted endpoints (Ashby, Greenhouse).
 *
 * Both partners authenticate to us with HTTP Basic carrying the TOUCHSTONES API key the customer
 * configured on their side: key in the Basic-auth USERNAME with a blank password (Greenhouse sends
 * exactly `Basic base64(key + ":")`; Ashby is the same shape). We accept the key in EITHER the
 * username or password field, normalize it into X-API-Key, and delegate to the EXISTING /v1
 * apiKeyAuth (sha256 -> api_keys lookup -> req.apiAccount). No forked auth scheme.
 *
 * Extracted verbatim from routes/integrations/ashby.js (ashbyInboundAuth) so both integrations
 * share one implementation; behavior is identical.
 */
const { apiKeyAuth } = require('./apiKeyAuth');
const { modeFromKey } = require('../services/apiKeyService');

// Parse the Touchstones key out of `Authorization: Basic base64(user:pass)` (either field) and hand
// it to apiKeyAuth as X-API-Key, so the identical hash+lookup+tenant pipeline runs.
function partnerBasicKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (/^Basic /i.test(header)) {
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8'); } catch { decoded = ''; }
    const idx = decoded.indexOf(':');
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    const key = [user, pass].map((s) => (s || '').trim()).find((s) => modeFromKey(s));
    if (key) req.headers['x-api-key'] = key;
  }
  return apiKeyAuth(req, res, next);
}

module.exports = { partnerBasicKeyAuth };
