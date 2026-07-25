/**
 * ATS write-back — push a finished proof score back into the recruiter's ATS so the
 * decision "lands where they hire". Two providers today:
 *
 *   Ashby      — POST https://api.ashbyhq.com/candidate.note.create   (Basic auth: apiKey)
 *   Greenhouse — POST https://harvest.greenhouse.io/v1/applications/{id}/notes (Basic auth: harvestApiKey)
 *
 * Contract (matches emailService / slackService): graceful no-op when unconfigured —
 * if no API key is available (neither arg nor the provider's env var) we return
 * { success: false, skipped: true } and NEVER throw. A failed HTTP call returns
 * { success: false, error } — also without throwing — so an ATS outage can never break
 * or slow the scoring path.
 *
 * Secrets come from args first, then env (ASHBY_API_KEY / GREENHOUSE_API_KEY). Nothing
 * is hardcoded. All HTTP goes through one small fetch helper.
 */

// --- shared score → human-readable note text -------------------------------
function scoreNote(summary = {}) {
  const score = Math.max(0, Math.min(100, Math.round(Number(summary.score) || 0)));
  const outcome = summary.outcome === 'advance' ? 'Advance' : 'Review';
  const lines = [
    `Touchstones proof-of-skill score: ${score}/100 (${outcome})`,
  ];
  if (summary.direction_score !== undefined && summary.direction_score !== null) {
    const d = Math.max(0, Math.min(100, Math.round(Number(summary.direction_score) || 0)));
    lines.push(`Direct-the-AI score: ${d}/100`);
  }
  if (summary.work_sample) lines.push(`Work sample: ${summary.work_sample}`);
  if (summary.result_url) lines.push(`Full result: ${summary.result_url}`);
  return lines.join('\n');
}

/**
 * One JSON POST behind Basic auth. Returns { success, status?, error?, data? } and
 * never throws — callers stay best-effort.
 * @param {string} url
 * @param {string} apiKey  - the key used as the Basic-auth username (password empty)
 * @param {Object} body
 * @param {Object} [extraHeaders]
 */
async function postJsonBasic(url, apiKey, body, extraHeaders = {}) {
  // Greenhouse/Ashby both use HTTP Basic with the key as the username and an empty
  // password: base64("apiKey:").
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        // Explicit UA: api.ashbyhq.com is behind Cloudflare and a default/empty
        // User-Agent gets a 403 error 1010. Callers may override.
        'User-Agent': 'Touchstones-Integration/1.0',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.message || data?.errors || data?.error || `ATS API error (${resp.status})`;
      return { success: false, status: resp.status, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
    }
    return { success: true, status: resp.status, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Push a score to Ashby as a candidate note (candidate.note.create).
 * @param {Object} opts
 * @param {string} [opts.apiKey]        - falls back to ASHBY_API_KEY
 * @param {string} opts.candidateId     - Ashby candidate id (preferred)
 * @param {string} [opts.applicationId] - accepted alias if candidateId is absent
 * @param {Object} opts.summary
 * @returns {Promise<Object>} { success, skipped?, error? }
 */
async function pushScoreToAshby({ apiKey, candidateId, applicationId, summary } = {}) {
  const key = (apiKey || process.env.ASHBY_API_KEY || '').trim();
  if (!key) return { success: false, skipped: true, reason: 'ashby_not_configured' };

  const targetId = candidateId || applicationId;
  if (!targetId) return { success: false, error: 'Ashby requires candidateId' };

  return postJsonBasic(
    'https://api.ashbyhq.com/candidate.note.create',
    key,
    { candidateId: targetId, note: scoreNote(summary) },
  );
}

/**
 * Push a score to Greenhouse via the Harvest API as an application note.
 * POST /v1/applications/{id}/notes requires an On-Behalf-Of user id header.
 * @param {Object} opts
 * @param {string} [opts.apiKey]        - falls back to GREENHOUSE_API_KEY
 * @param {string} [opts.harvestApiKey] - alias for apiKey (the Harvest key)
 * @param {string} opts.applicationId   - Greenhouse application id
 * @param {string|number} [opts.onBehalfOf] - Greenhouse user id (On-Behalf-Of); falls
 *                                             back to GREENHOUSE_ON_BEHALF_OF
 * @param {Object} opts.summary
 * @returns {Promise<Object>} { success, skipped?, error? }
 */
async function pushScoreToGreenhouse({ apiKey, harvestApiKey, applicationId, onBehalfOf, summary } = {}) {
  const key = (harvestApiKey || apiKey || process.env.GREENHOUSE_API_KEY || '').trim();
  if (!key) return { success: false, skipped: true, reason: 'greenhouse_not_configured' };

  if (!applicationId) return { success: false, error: 'Greenhouse requires applicationId' };

  // Harvest requires the On-Behalf-Of header for note creation (the acting user).
  const obo = onBehalfOf || process.env.GREENHOUSE_ON_BEHALF_OF || '';
  if (!obo) return { success: false, error: 'Greenhouse requires onBehalfOf (set GREENHOUSE_ON_BEHALF_OF)' };

  return postJsonBasic(
    `https://harvest.greenhouse.io/v1/applications/${encodeURIComponent(applicationId)}/notes`,
    key,
    { user_id: Number(obo) || obo, body: scoreNote(summary), visibility: 'public' },
    { 'On-Behalf-Of': String(obo) },
  );
}

module.exports = { pushScoreToAshby, pushScoreToGreenhouse, scoreNote };
