/**
 * Request Demo Routes
 *
 * Public (no-auth) endpoint backing the marketing "Request a Demo" form.
 * - Verifies Cloudflare Turnstile (no-ops when TURNSTILE_SECRET_KEY is unset).
 * - Sends a best-effort notification email to the sales inbox via emailService
 *   (which itself prefers Resend, falls back to SMTP, or no-ops if unconfigured).
 */

const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const emailTemplates = require('../services/emailTemplates');
const { verifyTurnstile } = require('../helpers/turnstile');

// POST /api/request-demo
router.post('/', async (req, res) => {
    try {
        const {
            email,
            firstName,
            lastName,
            company,
            teamSize,
            message,
            turnstileToken
        } = req.body;

        if (!email || !firstName || !company) {
            return res.status(400).json({ error: 'Email, first name and company are required' });
        }

        // Basic email format check
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // CAPTCHA gate (skipped gracefully in dev when no secret is configured).
        const captcha = await verifyTurnstile(turnstileToken, req.ip);
        if (!captcha.success) {
            return res.status(400).json({ error: captcha.error || 'CAPTCHA verification failed' });
        }

        const fullName = `${firstName} ${lastName || ''}`.trim();
        const salesInbox = process.env.DEMO_REQUEST_INBOX || process.env.EMAIL_USER || process.env.RESEND_FROM_EMAIL;

        // Fire-and-forget notification; never block the response on email delivery.
        if (salesInbox) {
            const body =
                `New demo request from Touchstones:\n\n` +
                `Name: ${fullName}\n` +
                `Work email: ${email}\n` +
                `Company: ${company}\n` +
                `Team size: ${teamSize || 'n/a'}\n` +
                `Notes: ${message || '(none)'}\n`;

            const html = emailTemplates.founderNotice({
                heading: 'New demo request',
                intro: 'Someone asked for a demo from the marketing site.',
                rows: [
                    ['Name', fullName],
                    ['Work email', email],
                    ['Company', company],
                    ['Team size', teamSize || 'n/a'],
                    ['Notes', message || ''],
                ],
                footnote: 'Sent automatically from the request-demo form.',
                preheader: `Demo request — ${company}`,
            });
            emailService.sendEmail({
                to: salesInbox,
                subject: `Demo request — ${company}`,
                body,
                html
            }).catch((err) => {
                console.error('request-demo: notification email failed:', err.message);
            });
        } else {
            console.log('request-demo received (no sales inbox configured):', email, company);
        }

        res.json({ success: true, message: 'Demo request received' });
    } catch (error) {
        console.error('Request demo error:', error);
        res.status(500).json({ error: 'Failed to submit demo request' });
    }
});

module.exports = router;
