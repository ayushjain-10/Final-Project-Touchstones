/**
 * SSRF regression for the Slack delivery webhook. A (possibly user-supplied) webhook
 * URL must be a real hooks.slack.com/services/ webhook — never an internal/metadata host.
 */
const slack = require('../../src/services/slackService');

describe('Slack webhook SSRF guard', () => {
  test('accepts real Slack webhooks (case-insensitive, trailing dot tolerated)', () => {
    expect(slack.isValidSlackWebhook('https://hooks.slack.com/services/T000/B000/abcDEF')).toBe(true);
    expect(slack.isValidSlackWebhook('https://Hooks.Slack.com./services/T/B/X')).toBe(true);
  });

  test('rejects non-Slack, scheme, suffix-trick, and internal targets', () => {
    const bad = [
      'http://hooks.slack.com/services/x',            // not https
      'https://evil.com/services/x',                  // wrong host
      'https://hooks.slack.com.evil.com/services/x',  // suffix trick
      'https://hooks.slack.com/not-services',         // wrong path
      'http://169.254.169.254/latest/meta-data/',     // cloud metadata
      'http://localhost/x', 'http://127.0.0.1/x', 'http://[::1]/x',
      'https://10.0.0.1/services/x', 'https://192.168.1.1/services/x',
      'file:///etc/passwd', 'not a url', '',
    ];
    for (const u of bad) expect(slack.isValidSlackWebhook(u)).toBe(false);
  });

  test('postScore refuses an invalid webhook WITHOUT making a request', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const r = await slack.postScore('http://169.254.169.254/latest/meta-data', { score: 50 });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('not_a_slack_webhook');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
