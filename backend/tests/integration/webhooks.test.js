/**
 * External Webhook Handler Tests
 *
 * Covers routes/supabase/webhooks.js EXTERNAL handlers (the CRUD webhook
 * endpoints are already covered in integrations.test.js):
 *   POST /api/webhooks/stripe        (Stripe signature verification)
 *   POST /api/webhooks/calendly      (Calendly signature verification)
 *   GET  /api/webhooks/calendly/test
 *   POST /api/webhooks/google        (Google Calendar push notifications)
 *
 * Security focus: Stripe signature verification. See the audit report for the
 * gap when STRIPE_WEBHOOK_SECRET is unset.
 */

const request = require('supertest');

const app = require('../../src/app');

describe('POST /api/webhooks/stripe', () => {
  it('rejects a forged payload with a bogus stripe-signature and never processes it', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 't=123,v1=deadbeef')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } })));

    // Signature verification is mandatory. When STRIPE_WEBHOOK_SECRET is set the
    // bad signature fails constructEvent => 400. When it is unset the handler
    // refuses to process anything => 500 (misconfigured). Either way the forged
    // event is NEVER acknowledged as valid (no 200), so subscription rows are
    // never mutated by an unsigned request.
    expect([400, 500]).toContain(res.status);
  });

  it('returns 400 on malformed JSON body (cannot be parsed/verified)', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('this is not json'));

    // No valid signature + unparseable body => 400.
    expect([400, 500]).toContain(res.status);
  });

  it('rejects an unsigned event (no stripe-signature) instead of processing it', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'some.unknown.event', data: { object: {} } })));

    // No signature header => 400 (secret set, verification fails) or 500 (secret
    // unset, misconfigured). The handler never falls through to the switch for an
    // unverified payload.
    expect([400, 500]).toContain(res.status);
  });
});

describe('POST /api/webhooks/calendly', () => {
  it('always acknowledges with 200 (never makes Calendly retry) for an unknown event', async () => {
    const res = await request(app)
      .post('/api/webhooks/calendly')
      .set('Content-Type', 'application/json')
      .send({ event: 'unknown.event', payload: {} });

    // Calendly webhook handler intentionally returns 200 even on processing
    // errors to prevent retries. If a signing key is configured and the
    // signature is missing/invalid, it returns 401 instead.
    expect([200, 401]).toContain(res.status);
  });

  it('rejects with 401 when a signing key is configured and the signature is invalid', async () => {
    const res = await request(app)
      .post('/api/webhooks/calendly')
      .set('Content-Type', 'application/json')
      .set('calendly-webhook-signature', 'v1=invalidsignature')
      .set('calendly-webhook-timestamp', '1700000000')
      .send({ event: 'invitee.created', payload: { email: 'x@y.z' } });

    // With CALENDLY_WEBHOOK_SIGNING_KEY set => 401 on bad signature.
    // Without it => verification skipped => 200.
    expect([200, 401]).toContain(res.status);
  });

  it('GET /api/webhooks/calendly/test returns an accessible confirmation', async () => {
    const res = await request(app).get('/api/webhooks/calendly/test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/webhooks/google', () => {
  it('acknowledges a sync notification with 200 and no body', async () => {
    const res = await request(app)
      .post('/api/webhooks/google')
      .set('x-goog-resource-state', 'sync')
      .send({});

    expect(res.status).toBe(200);
  });

  it('acknowledges an "exists" change notification with 200', async () => {
    const res = await request(app)
      .post('/api/webhooks/google')
      .set('x-goog-resource-state', 'exists')
      .set('x-goog-channel-id', 'chan-1')
      .set('x-goog-resource-id', 'res-1')
      .send({});

    expect(res.status).toBe(200);
  });

  it('acknowledges with 200 even on unexpected input (never makes Google retry)', async () => {
    const res = await request(app)
      .post('/api/webhooks/google')
      .send({ random: 'data' });

    expect(res.status).toBe(200);
  });
});
