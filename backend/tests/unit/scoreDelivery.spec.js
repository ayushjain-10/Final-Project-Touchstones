/**
 * Unit tests for score delivery (Slack + ATS write-back). Env-independent → CI-safe.
 *
 * Two things matter and are asserted here:
 *   1. buildScoreBlocks produces the right Block Kit shape (pure, no I/O).
 *   2. Every channel is a GRACEFUL NO-OP when unconfigured, and NEVER throws — a
 *      Slack/ATS outage must not break or slow scoring. fetch is mocked so no real
 *      network call is made.
 */
const slackService = require('../../src/services/slackService');
const atsService = require('../../src/services/atsService');
const scoreDelivery = require('../../src/services/scoreDelivery');

describe('slackService.buildScoreBlocks (pure builder)', () => {
  test('builds header + section fields with candidate, score and outcome', () => {
    const { text, blocks } = slackService.buildScoreBlocks({
      candidate: 'Ada Lovelace',
      score: 87,
      outcome: 'advance',
      result_url: 'https://app.example.com/proof/results/abc',
    });
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('87/100');
    expect(text).toContain('Advance');

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0].type).toBe('header');
    expect(blocks[1].type).toBe('section');
    const fieldText = blocks[1].fields.map((f) => f.text).join(' ');
    expect(fieldText).toContain('Ada Lovelace');
    expect(fieldText).toContain('87/100');
    expect(fieldText).toContain('Advance');

    // result_url present → an actions block with a link button.
    const actions = blocks.find((b) => b.type === 'actions');
    expect(actions).toBeDefined();
    expect(actions.elements[0].url).toBe('https://app.example.com/proof/results/abc');
  });

  test('omits the direction field when direction_score is absent, includes it (even 0) when present', () => {
    const without = slackService.buildScoreBlocks({ candidate: 'X', score: 50, outcome: 'reject' });
    expect(without.blocks[1].fields.map((f) => f.text).join(' ')).not.toContain('Direct-the-AI');

    const withZero = slackService.buildScoreBlocks({ candidate: 'X', score: 50, outcome: 'reject', direction_score: 0 });
    expect(withZero.blocks[1].fields.map((f) => f.text).join(' ')).toContain('Direct-the-AI');
  });

  test('non-advance outcomes render as Review', () => {
    const { text } = slackService.buildScoreBlocks({ candidate: 'X', score: 30, outcome: 'reject' });
    expect(text).toContain('Review');
  });

  test('clamps an out-of-range score into [0,100]', () => {
    expect(slackService.buildScoreBlocks({ candidate: 'X', score: 250 }).text).toContain('100/100');
    expect(slackService.buildScoreBlocks({ candidate: 'X', score: -10 }).text).toContain('0/100');
  });
});

describe('graceful no-op when unconfigured (mocked fetch)', () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };

  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.reject(new Error('fetch should not be called when unconfigured')));
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.ASHBY_API_KEY;
    delete process.env.GREENHOUSE_API_KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  test('slackService.postScore no-ops (no fetch) with no webhook url', async () => {
    const r = await slackService.postScore(undefined, { candidate: 'X', score: 1 });
    expect(r.skipped).toBe(true);
    expect(r.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('pushScoreToAshby no-ops (no fetch) with no api key', async () => {
    const r = await atsService.pushScoreToAshby({ candidateId: 'c1', summary: { score: 1 } });
    expect(r.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('pushScoreToGreenhouse no-ops (no fetch) with no api key', async () => {
    const r = await atsService.pushScoreToGreenhouse({ applicationId: 'a1', summary: { score: 1 } });
    expect(r.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('scoreDelivery.deliver fans out and never throws when nothing is configured', async () => {
    const res = await scoreDelivery.deliver({ submission_id: 's1', candidate: 'X', score: 50, outcome: 'reject' });
    expect(res.delivered.slack.skipped).toBe(true);
    expect(res.delivered.ashby.skipped).toBe(true);
    expect(res.delivered.greenhouse.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('scoreDelivery.deliver honors an explicit channels subset', async () => {
    const res = await scoreDelivery.deliver(
      { submission_id: 's1', candidate: 'X', score: 50 },
      { channels: ['slack'] },
    );
    expect(res.delivered.slack).toBeDefined();
    expect(res.delivered.ashby).toBeUndefined();
    expect(res.delivered.greenhouse).toBeUndefined();
  });
});

describe('postScore sends Block Kit JSON when a webhook IS configured (mocked fetch)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('POSTs blocks to the webhook and reports success on 200', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok') }));
    const r = await slackService.postScore('https://hooks.slack.com/services/T/B/X', {
      candidate: 'Grace', score: 91, outcome: 'advance',
    });
    expect(r.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T/B/X');
    expect(opts.method).toBe('POST');
    const sent = JSON.parse(opts.body);
    expect(sent.blocks[0].type).toBe('header');
    expect(sent.text).toContain('Grace');
  });

  test('a non-2xx Slack response is returned as an error, not thrown', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('invalid_payload') }));
    const r = await slackService.postScore('https://hooks.slack.com/services/T/B/X', { candidate: 'X', score: 1 });
    expect(r.success).toBe(false);
    expect(r.error).toContain('invalid_payload');
  });
});
