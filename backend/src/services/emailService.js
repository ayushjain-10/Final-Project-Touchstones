const nodemailer = require('nodemailer');

// Recipient domains that are never real mailboxes (smoke/e2e fixtures and RFC 2606 reserved
// names). Sends to these bounce at the ESP, so sendEmail short-circuits them. Real delivery
// assertions use @inbox.testmail.app, which is not in this list.
const FAKE_TEST_DOMAINS = new Set([
  'touchstones-test.com',
  'example.com', 'example.org', 'example.net',
  'invalid.invalid', 'test.invalid', 'localhost',
]);

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    // Resend is the preferred transactional provider (better deliverability than
    // Gmail SMTP). When RESEND_API_KEY is set we send via the Resend HTTP API and
    // skip Nodemailer entirely; otherwise we fall back to the SMTP path below.
    this.resendApiKey = (process.env.RESEND_API_KEY || '').trim();
    this.resendFrom = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || null;
    // Consistent reply-to so replies reach a monitored inbox (not the no-reply send address).
    this.replyTo = process.env.RESEND_REPLY_TO || 'help@touchstones.ai';
    this.useResend = !!this.resendApiKey;
    if (this.useResend) {
      this.initialized = true;
      console.log('Email service initialized via Resend HTTP API');
    }
    this.initTransporter();
  }

  /**
   * Send via the Resend HTTP API (https://api.resend.com/emails).
   * Uses global fetch (Node 18+); no SDK dependency required.
   * @returns {Promise<Object>} - { success, messageId, error }
   */
  async sendViaResend({ to, subject, body, html, fromName, headers }) {
    // Resend requires a verified-domain From address. RESEND_FROM_EMAIL may be a
    // bare address ("help@touchstones.ai") or a full "Name <addr>" string.
    const fromAddr = this.resendFrom;
    if (!fromAddr) {
      return {
        success: false,
        error: 'RESEND_FROM_EMAIL is required when RESEND_API_KEY is set (e.g. "Touchstones <noreply@yourdomain.com>")'
      };
    }
    const senderName = fromName || process.env.EMAIL_FROM_NAME || 'Touchstones Recruiting';
    const from = fromAddr.includes('<') ? fromAddr : `${senderName} <${fromAddr}>`;

    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: Array.isArray(to) ? to : [to],
          subject: subject || 'Job Opportunity',
          html: html || this.convertToHtml(body),
          text: body || undefined,
          reply_to: this.replyTo,
          // Custom headers (e.g. List-Unsubscribe / List-Unsubscribe-Post on marketing mail).
          ...(headers && Object.keys(headers).length ? { headers } : {})
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const errMsg = data?.message || data?.error || `Resend API error (${resp.status})`;
        console.error('Resend send failed:', errMsg);
        return { success: false, error: errMsg };
      }

      console.log('Email sent via Resend:', data.id);
      return { success: true, messageId: data.id, provider: 'resend' };
    } catch (error) {
      console.error('Resend request failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Initialize the email transporter
   */
  initTransporter() {
    try {
      const emailService = process.env.EMAIL_SERVICE || 'gmail';
      const emailUser = process.env.EMAIL_USER;
      const emailPassword = process.env.EMAIL_PASSWORD;

      if (!emailUser || !emailPassword) {
        if (!this.useResend) {
          console.warn('Email credentials not configured. Email sending will be disabled.');
        }
        return;
      }

      // Configure transporter based on service
      if (emailService === 'gmail') {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: emailUser,
            pass: emailPassword
          }
        });
      } else {
        // Generic SMTP configuration
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: emailUser,
            pass: emailPassword
          }
        });
      }

      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('Email transporter verification failed:', error.message);
          this.initialized = false;
        } else {
          console.log('Email service initialized successfully');
          this.initialized = true;
        }
      });

    } catch (error) {
      console.error('Failed to initialize email service:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Send an outreach email to a candidate
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email address
   * @param {string} options.subject - Email subject
   * @param {string} options.body - Email body (plain text)
   * @param {string} options.html - Email body (HTML) - optional
   * @param {string} options.fromName - Sender name override
   * @param {Object} options.headers - Extra message headers (e.g. List-Unsubscribe) - optional
   * @returns {Promise<Object>} - { success, messageId, error }
   */
  async sendEmail({ to, subject, body, html, fromName, headers }) {
    if (!to) {
      return {
        success: false,
        error: 'Recipient email address is required'
      };
    }

    // Never hand known-fake test recipients to the ESP: they bounce (touchstones-test.com is
    // not a real domain), which burns send quota AND drags down the touchstones.ai sender
    // reputation. Smoke/e2e runs that must assert real delivery use @inbox.testmail.app
    // addresses, which are real mailboxes and pass through untouched.
    const recipientDomain = String(to).split('@')[1]?.toLowerCase() || '';
    if (FAKE_TEST_DOMAINS.has(recipientDomain)) {
      console.log(`email skipped (fake test recipient domain): ${recipientDomain}`);
      return { success: true, skipped: 'test_recipient', messageId: null };
    }

    // Prefer Resend HTTP API when configured (better deliverability, domain auth).
    if (this.useResend) {
      return this.sendViaResend({ to, subject, body, html, fromName, headers });
    }

    if (!this.transporter) {
      return {
        success: false,
        error: 'Email service not configured. Please add RESEND_API_KEY (recommended) or EMAIL_USER and EMAIL_PASSWORD to environment variables.'
      };
    }

    try {
      const senderName = fromName || process.env.EMAIL_FROM_NAME || 'Touchstones Recruiting';
      const senderEmail = process.env.EMAIL_USER;

      const mailOptions = {
        from: `"${senderName}" <${senderEmail}>`,
        to: to,
        replyTo: this.replyTo,
        subject: subject || 'Job Opportunity',
        text: body,
        html: html || this.convertToHtml(body),
        ...(headers && Object.keys(headers).length ? { headers } : {})
      };

      console.log(`Sending email to: ${to}`);
      console.log(`Subject: ${subject}`);

      const result = await this.transporter.sendMail(mailOptions);

      console.log('Email sent successfully:', result.messageId);

      return {
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        response: result.response
      };

    } catch (error) {
      console.error('Failed to send email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send outreach message (email or LinkedIn)
   * @param {Object} candidate - Candidate object with email, linkedinUrl
   * @param {Object} message - Message object with subject, message, channel
   * @param {Object} user - Current user (sender)
   * @returns {Promise<Object>} - Result object
   */
  async sendOutreachMessage(candidate, message, user = {}) {
    const channel = message.channel || 'email';

    if (channel === 'linkedin') {
      // LinkedIn message - return instructions since we can't auto-send
      return {
        success: false,
        channel: 'linkedin',
        error: 'LinkedIn messages cannot be sent automatically. Please copy the message and send it via LinkedIn.',
        linkedinUrl: candidate.linkedinUrl || candidate.linkedin,
        messageToCopy: message.message
      };
    }

    // Email channel
    if (!candidate.email) {
      return {
        success: false,
        channel: 'email',
        error: 'Candidate does not have an email address'
      };
    }

    // Extract subject from message object or generate one
    const subject = message.subject ||
      (message.message && message.message.includes('Subject:')
        ? message.message.split('\n')[0].replace('Subject:', '').trim()
        : 'Exciting Job Opportunity');

    // Extract body (remove subject line if present)
    let body = message.message;
    if (body && body.startsWith('Subject:')) {
      body = body.split('\n').slice(1).join('\n').trim();
    }

    // Replace placeholder with user name if available
    if (user.name || user.fullName) {
      body = body.replace('[Your Name]', user.name || user.fullName);
      body = body.replace('[Company Recruiter]', user.company || 'Recruiting Team');
    }

    const result = await this.sendEmail({
      to: candidate.email,
      subject: subject,
      body: body,
      fromName: user.name || user.fullName || process.env.EMAIL_FROM_NAME
    });

    return {
      ...result,
      channel: 'email',
      recipient: candidate.email
    };
  }

  /**
   * Convert plain text to simple HTML
   * @param {string} text - Plain text content
   * @returns {string} - HTML content
   */
  convertToHtml(text) {
    if (!text) return '';

    // Escape HTML special characters
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');

    // Wrap in basic HTML structure
    return `
      <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">
        ${html}
      </div>
    `;
  }

  /**
   * Check if email service is properly configured and working
   * @returns {Object} - Status object
   */
  getStatus() {
    return {
      initialized: this.initialized,
      configured: this.useResend || !!this.transporter,
      provider: this.useResend ? 'resend' : (this.transporter ? 'smtp' : null),
      from: this.useResend
        ? (this.resendFrom || null)
        : (process.env.EMAIL_USER ? `${process.env.EMAIL_USER.substring(0, 3)}***` : null)
    };
  }
}

module.exports = new EmailService();
