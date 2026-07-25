/**
 * Score delivery fan-out — the single seam the scoring path calls so a finished score
 * "lands where you hire". Fans out to Slack + (when configured) Ashby/Greenhouse.
 *
 * NON-NEGOTIABLE: this is best-effort and NON-BLOCKING. A Slack/ATS outage must never
 * break or slow scoring, so deliver() catches everything and logs via the observability
 * logger — it never throws into the scoring path. The scoring code fires it
 * fire-and-forget (no await on the response path).
 *
 * Each channel is itself a graceful no-op when unconfigured (see slackService /
 * atsService), so with nothing configured deliver() simply records "skipped" channels.
 */
const { logger, captureException } = require('../config/observability');
const slackService = require('./slackService');
const atsService = require('./atsService');

/**
 * @param {Object} summary
 * @param {string} summary.submission_id
 * @param {string} [summary.candidate]        - display name / email
 * @param {number} summary.score              - 0–100
 * @param {string} [summary.outcome]          - 'advance' | 'reject' | ...
 * @param {number} [summary.direction_score]  - optional
 * @param {string} [summary.result_url]       - link to the full result
 * @param {string} [summary.work_sample]      - optional title
 * @param {Object} [opts] - per-call overrides (e.g. a recruiter's stored config)
 * @param {string[]} [opts.channels]          - subset of ['slack','ashby','greenhouse']
 * @param {string}  [opts.slackWebhookUrl]
 * @param {string}  [opts.ashbyApiKey]
 * @param {string}  [opts.ashbyCandidateId]
 * @param {string}  [opts.greenhouseApiKey]
 * @param {string}  [opts.greenhouseApplicationId]
 * @param {string}  [opts.greenhouseOnBehalfOf]
 * @returns {Promise<Object>} { delivered: { slack?, ashby?, greenhouse? } } — never rejects
 */
async function deliver(summary = {}, opts = {}) {
  const delivered = {};
  // Default to all channels; each is a no-op when its own config is missing, so this is
  // safe — an unconfigured channel just reports { skipped: true }.
  const channels = Array.isArray(opts.channels) && opts.channels.length
    ? opts.channels
    : ['slack', 'ashby', 'greenhouse'];

  const tasks = [];

  if (channels.includes('slack')) {
    tasks.push(
      slackService.postScore(opts.slackWebhookUrl, summary)
        .then((r) => { delivered.slack = r; })
        .catch((err) => { delivered.slack = { success: false, error: err.message }; }),
    );
  }

  if (channels.includes('ashby')) {
    tasks.push(
      atsService.pushScoreToAshby({
        apiKey: opts.ashbyApiKey,
        candidateId: opts.ashbyCandidateId,
        applicationId: opts.ashbyApplicationId,
        summary,
      })
        .then((r) => { delivered.ashby = r; })
        .catch((err) => { delivered.ashby = { success: false, error: err.message }; }),
    );
  }

  if (channels.includes('greenhouse')) {
    tasks.push(
      atsService.pushScoreToGreenhouse({
        apiKey: opts.greenhouseApiKey,
        applicationId: opts.greenhouseApplicationId,
        onBehalfOf: opts.greenhouseOnBehalfOf,
        summary,
      })
        .then((r) => { delivered.greenhouse = r; })
        .catch((err) => { delivered.greenhouse = { success: false, error: err.message }; }),
    );
  }

  try {
    await Promise.allSettled(tasks);
    // Log a single best-effort line; failures here are informational, not fatal.
    const failures = Object.entries(delivered)
      .filter(([, r]) => r && r.success === false && !r.skipped)
      .map(([ch, r]) => `${ch}: ${r.error || r.status}`);
    if (failures.length) {
      logger.warn({ submission_id: summary.submission_id, failures }, 'score delivery: some channels failed');
    } else {
      logger.info({ submission_id: summary.submission_id, delivered }, 'score delivery complete');
    }
  } catch (err) {
    // Defensive: Promise.allSettled never rejects, but guarantee we never propagate.
    logger.error({ err, submission_id: summary.submission_id }, 'score delivery error');
    captureException(err, { submission_id: summary.submission_id });
  }

  return { delivered };
}

module.exports = { deliver };
