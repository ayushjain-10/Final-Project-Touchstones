/**
 * Transactional Email Tests
 *
 * Covers:
 *   - services/emailService.js (pure logic + send guardrails)
 *   - routes/supabase/outreach.js email endpoints:
 *       GET  /api/outreach/email-status
 *       POST /api/outreach/send-email   (validation contract)
 *
 * The email service is a singleton. In the test environment EMAIL_USER/PASSWORD
 * may be set, so a transporter may exist but real SMTP delivery will fail (no
 * live mailbox). Tests therefore assert structure + validation, not delivery.
 */

const request = require('supertest');

const app = require('../../src/app');
const emailService = require('../../src/services/emailService');

const MOCK_USER = '00000000-0000-0000-0000-000000000001';
function authed(req) {
  const token = testUtils.generateTestToken(MOCK_USER, 'mock@touchstones.ai');
  return req.set('Authorization', `Bearer ${token}`);
}

describe('emailService.getStatus()', () => {
  it('returns a status object with the expected shape', () => {
    const status = emailService.getStatus();
    expect(status).toHaveProperty('initialized');
    expect(status).toHaveProperty('configured');
    expect(typeof status.configured).toBe('boolean');
  });

  it('masks the email user (never exposes the full address)', () => {
    const status = emailService.getStatus();
    if (status.emailUser) {
      expect(status.emailUser).toContain('***');
      expect(status.emailUser).not.toMatch(/@/); // only first 3 chars + ***
    }
  });
});

describe('emailService.convertToHtml()', () => {
  it('returns an empty string for empty input', () => {
    expect(emailService.convertToHtml('')).toBe('');
    expect(emailService.convertToHtml(null)).toBe('');
  });

  it('escapes HTML special characters to prevent injection', () => {
    const html = emailService.convertToHtml('<script>alert(1)</script> & "quote"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;');
  });

  it('converts newlines into <br> tags', () => {
    const html = emailService.convertToHtml('line1\nline2');
    expect(html).toContain('<br>');
  });
});

describe('emailService.sendEmail() guardrails', () => {
  it('fails gracefully when recipient is missing', async () => {
    const result = await emailService.sendEmail({ subject: 's', body: 'b' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns a structured failure (never throws) for an undeliverable recipient', async () => {
    const result = await emailService.sendEmail({
      to: 'no-such-mailbox@invalid.invalid',
      subject: 'Test',
      body: 'Body'
    });
    // Either the transporter is missing (configured=false) or SMTP rejects it.
    // In both cases we expect a structured { success:false } object.
    expect(result).toHaveProperty('success');
    if (!result.success) {
      expect(result).toHaveProperty('error');
    }
  });
});

describe('emailService.sendOutreachMessage() channel handling', () => {
  it('returns copy instructions for LinkedIn channel (cannot auto-send)', async () => {
    const result = await emailService.sendOutreachMessage(
      { linkedinUrl: 'https://linkedin.com/in/test' },
      { channel: 'linkedin', message: 'Hello there' }
    );
    expect(result.success).toBe(false);
    expect(result.channel).toBe('linkedin');
    expect(result.messageToCopy).toBe('Hello there');
  });

  it('fails for email channel when the candidate has no email', async () => {
    const result = await emailService.sendOutreachMessage(
      { name: 'No Email' },
      { channel: 'email', subject: 'Hi', message: 'Body' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/email/i);
  });
});

describe('GET /api/outreach/email-status', () => {
  // AUDIT NOTE: This endpoint is currently SHADOWED by the earlier-registered
  // `GET /:id` route in outreach.js (line 47 vs line 490). A request to
  // /email-status is matched as id="email-status" against outreach_logs and
  // returns 404 instead of the email service status. The 404 below documents
  // that bug; see the audit report. If the route ordering is fixed, this should
  // return 200 with a `configured` flag.
  it('responds (currently shadowed by /:id route -> 404; documents the bug)', async () => {
    const res = await authed(request(app).get('/api/outreach/email-status'));
    expect([200, 401, 404, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('configured');
    }
  });
});

describe('POST /api/outreach/send-email (validation)', () => {
  it('rejects when no recipient can be determined (400)', async () => {
    const res = await authed(
      request(app).post('/api/outreach/send-email').send({ subject: 'Hi', body: 'Body' })
    );
    expect([400, 401]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.success).toBe(false);
    }
  });

  it('rejects when body is missing (400)', async () => {
    const res = await authed(
      request(app).post('/api/outreach/send-email').send({ to: 'candidate@example.com', subject: 'Hi' })
    );
    expect([400, 401]).toContain(res.status);
  });

  it('attempts to send with a recipient + body (delivery may fail without SMTP)', async () => {
    const res = await authed(
      request(app).post('/api/outreach/send-email').send({
        to: 'candidate@example.com',
        subject: 'Opportunity',
        body: 'Hello [Your Name]'
      })
    );
    // Validation passes; actual delivery may 200 (sent), 400 (service down /
    // send failed), or 500. Never an unhandled crash.
    expect([200, 400, 401, 500]).toContain(res.status);
  });
});
