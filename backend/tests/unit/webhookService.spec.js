/**
 * Unit tests for webhookService signing primitives (pure, no I/O).
 * The HMAC signature is the trust boundary for receivers — these lock its exact shape.
 */
const crypto = require('crypto');
const webhookService = require('../../src/services/webhookService');

describe('webhookService signing', () => {
  test('generateSigningSecret has the whsec_ prefix and high entropy', () => {
    const s = webhookService.generateSigningSecret();
    expect(s).toMatch(/^whsec_[0-9A-Za-z]+$/);
    // 32 bytes base62 ≈ 43 chars; with prefix, comfortably > 40.
    expect(s.length).toBeGreaterThan(40);
    // Two calls never collide.
    expect(webhookService.generateSigningSecret()).not.toEqual(s);
  });

  test('sign is deterministic and equals an independent HMAC-SHA256 over `${t}.${body}`', () => {
    const secret = 'whsec_test_secret';
    const t = 1700000000;
    const body = JSON.stringify({ type: 'verification.completed', created: t, data: { ok: true } });
    const sig = webhookService.sign(secret, t, body);
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(sig).toBe(expected);
    // Deterministic across calls.
    expect(webhookService.sign(secret, t, body)).toBe(sig);
  });

  test('signatureHeader is parseable as t=<seconds>,v1=<hex> and verifies', () => {
    const secret = webhookService.generateSigningSecret();
    const t = 1700000123;
    const body = '{"hello":"world"}';
    const header = webhookService.signatureHeader(secret, body, t);
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(t);
    // Receiver-side verification: recompute over the same raw body + timestamp.
    const recomputed = webhookService.sign(secret, t, body);
    expect(recomputed).toBe(m[2]);
  });

  test('a tampered body fails verification', () => {
    const secret = webhookService.generateSigningSecret();
    const t = 1700000123;
    const header = webhookService.signatureHeader(secret, '{"amount":1}', t);
    const v1 = /v1=([0-9a-f]{64})/.exec(header)[1];
    const forged = webhookService.sign(secret, t, '{"amount":1000000}');
    expect(forged).not.toBe(v1);
  });
});
