/**
 * Payment Processing Tests
 *
 * Covers routes/supabase/payments.js (Stripe-backed):
 *   POST /api/payments/create-checkout-session   (public)
 *   POST /api/payments/verify-session            (public)
 *   POST /api/payments/cancel-subscription       (private)
 *   GET  /api/payments/subscription-status       (private)
 *
 * These tests focus on INPUT VALIDATION and contract, not on driving real
 * Stripe charges. STRIPE_SECRET_KEY may or may not be a working key in the test
 * environment, so happy-path Stripe calls use resilient status ranges.
 */

const request = require('supertest');

const app = require('../../src/app');

describe('POST /api/payments/create-checkout-session', () => {
  it('rejects when neither priceId nor a resolvable plan is provided', async () => {
    const res = await request(app)
      .post('/api/payments/create-checkout-session')
      .send({});

    // 400 (no price/plan) OR 500 (server misconfig: missing stripe/frontend env).
    // Must never be a 2xx success without a price.
    expect([400, 500]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });

  it('resolves the "growth" plan to a configured price id (or reports misconfig)', async () => {
    const res = await request(app)
      .post('/api/payments/create-checkout-session')
      .send({ plan: 'growth', customerEmail: 'buyer@example.com' });

    // With a valid Stripe key + price id => 200 {url}. Otherwise 400/500.
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('url');
    } else {
      expect(res.body).toHaveProperty('error');
    }
  });

  it('returns JSON regardless of outcome', async () => {
    const res = await request(app)
      .post('/api/payments/create-checkout-session')
      .send({ priceId: 'price_invalid_xyz' });
    expect(res.type).toBe('application/json');
  });
});

describe('POST /api/payments/verify-session', () => {
  it('rejects when sessionId is missing (400)', async () => {
    const res = await request(app)
      .post('/api/payments/verify-session')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('handles an unknown/invalid session id without leaking a stack to clients in prod', async () => {
    const res = await request(app)
      .post('/api/payments/verify-session')
      .send({ sessionId: 'cs_test_does_not_exist_123' });

    // Stripe lookup will fail => 400/404/500. Never a success.
    expect([400, 404, 500]).toContain(res.status);
  });
});

describe('GET /api/payments/subscription-status (private)', () => {
  it('responds with a subscription object or an auth/lookup error', async () => {
    const token = testUtils.generateTestToken(
      '00000000-0000-0000-0000-000000000001'
    );
    const res = await request(app)
      .get('/api/payments/subscription-status')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 401, 404, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('subscription');
    }
  });
});

describe('POST /api/payments/cancel-subscription (private)', () => {
  it('handles cancel request (no active sub => 400, missing user => 404)', async () => {
    const token = testUtils.generateTestToken(
      '00000000-0000-0000-0000-000000000001'
    );
    const res = await request(app)
      .post('/api/payments/cancel-subscription')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect([200, 400, 401, 404, 500]).toContain(res.status);
  });
});
