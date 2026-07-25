/**
 * Slack score delivery — "lands where you hire".
 * ----------------------------------------------
 * Posts a finished proof score to a recruiter's Slack channel via an incoming
 * webhook (https://api.slack.com/messaging/webhooks). Two halves:
 *
 *   buildScoreBlocks(summary)  — PURE: turns a score summary into Block Kit JSON.
 *                                No I/O, no env — unit-testable in isolation.
 *   postScore(webhookUrl, ...) — sends the blocks. Graceful: if no webhook URL is
 *                                configured (neither arg nor SLACK_WEBHOOK_URL),
 *                                it no-ops with { skipped: true } and NEVER throws.
 *
 * Same "skip if not configured" contract as emailService — a missing/broken Slack
 * integration must never break or slow the scoring path.
 */

// Clamp a 0–100-ish number into a safe integer for display.
function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// advance/review (we surface "review" for anything that isn't a clean advance, so a
// reject/needs_review both read as "needs a human look" rather than a hard no).
function outcomeLabel(outcome) {
  return outcome === 'advance' ? 'Advance' : 'Review';
}
function outcomeEmoji(outcome) {
  return outcome === 'advance' ? ':white_check_mark:' : ':eyes:';
}

/**
 * Build a Slack Block Kit message from a score summary.
 * @param {Object} summary
 * @param {string} [summary.candidate]        - candidate display name (or email)
 * @param {number} summary.score              - 0–100 normalized score
 * @param {string} [summary.outcome]          - 'advance' | 'reject' | 'review' | ...
 * @param {number} [summary.direction_score]  - 0–100 "Direct the AI" score (optional)
 * @param {string} [summary.result_url]       - link to the full result
 * @param {string} [summary.work_sample]      - work sample / role title (optional)
 * @returns {{ text: string, blocks: Array }}  - ready for the webhook body
 */
function buildScoreBlocks(summary = {}) {
  const candidate = String(summary.candidate || 'Candidate');
  const score = clampScore(summary.score);
  const outcome = summary.outcome || 'review';
  const label = outcomeLabel(outcome);
  const emoji = outcomeEmoji(outcome);

  // Fallback text shown in notifications / when blocks can't render.
  const text = `${candidate} scored ${score}/100 — ${label}`;

  const fields = [
    { type: 'mrkdwn', text: `*Candidate:*\n${candidate}` },
    { type: 'mrkdwn', text: `*Score:*\n${score}/100` },
    { type: 'mrkdwn', text: `*Outcome:*\n${emoji} ${label}` },
  ];

  // direction_score is optional — only show it when present (it can legitimately be 0).
  if (summary.direction_score !== undefined && summary.direction_score !== null) {
    fields.push({ type: 'mrkdwn', text: `*Direct-the-AI:*\n${clampScore(summary.direction_score)}/100` });
  }
  if (summary.work_sample) {
    fields.push({ type: 'mrkdwn', text: `*Work sample:*\n${String(summary.work_sample)}` });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Touchstones score ready', emoji: true },
    },
    { type: 'section', fields },
  ];

  // Link to the full, explainable result when we have one.
  if (summary.result_url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View result', emoji: true },
          url: String(summary.result_url),
        },
      ],
    });
  }

  return { text, blocks };
}

// SSRF guard: a (possibly user-supplied) webhook_url must be a REAL Slack incoming
// webhook — https + host exactly hooks.slack.com (case-insensitive, trailing dot
// stripped) + path under /services/. Without this an authenticated user could coerce
// the server into POSTing to internal services, cloud metadata (169.254.169.254),
// loopback, or RFC1918 hosts. Because the only permitted host is hooks.slack.com,
// the destination can never be an internal address.
function isValidSlackWebhook(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch (_) { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return host === 'hooks.slack.com' && u.pathname.startsWith('/services/');
}

/**
 * POST a score to a Slack incoming webhook.
 * Graceful: no webhook URL → no-op (NEVER throws). A non-2xx/transport error is
 * returned as { success: false, error }, also without throwing.
 *
 * @param {string} webhookUrl - the recruiter's incoming webhook (falls back to env)
 * @param {Object} summary    - see buildScoreBlocks
 * @returns {Promise<Object>} - { success, skipped?, status?, error? }
 */
async function postScore(webhookUrl, summary) {
  const url = (webhookUrl || process.env.SLACK_WEBHOOK_URL || '').trim();
  if (!url) {
    // Not configured → silently skip (same contract as emailService).
    return { success: false, skipped: true, reason: 'no_webhook_url' };
  }
  // SSRF guard — reject anything that isn't a hooks.slack.com/services/ webhook.
  if (!isValidSlackWebhook(url)) {
    return { success: false, error: 'invalid_webhook_url', reason: 'not_a_slack_webhook' };
  }

  const payload = buildScoreBlocks(summary || {});

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual', // never follow a redirect off the validated Slack host
    });
    // Treat any redirect as failure rather than following it to an unknown host.
    if (resp.status >= 300 && resp.status < 400) {
      return { success: false, status: resp.status, error: 'unexpected_redirect' };
    }
    if (!resp.ok) {
      // Slack returns a short text body ("invalid_payload", "no_service", ...).
      const body = await resp.text().catch(() => '');
      return { success: false, status: resp.status, error: body || `Slack webhook returned ${resp.status}` };
    }
    return { success: true, status: resp.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { postScore, buildScoreBlocks, isValidSlackWebhook };
