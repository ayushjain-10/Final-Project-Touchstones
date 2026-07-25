/**
 * Calendly Integration Service
 * Handles OAuth flow, API calls, and webhook processing
 */

const axios = require('axios');

const CALENDLY_AUTH_BASE = 'https://auth.calendly.com';
const CALENDLY_API_BASE = 'https://api.calendly.com';

class CalendlyService {
  constructor() {
    this.clientId = process.env.CALENDLY_CLIENT_ID;
    this.clientSecret = process.env.CALENDLY_CLIENT_SECRET;
    this.redirectUri = process.env.CALENDLY_REDIRECT_URI;
    this.webhookSigningKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state = '') {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state: state
    });
    return `${CALENDLY_AUTH_BASE}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(`${CALENDLY_AUTH_BASE}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.redirectUri
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type,
        createdAt: response.data.created_at
      };
    } catch (error) {
      console.error('Calendly token exchange error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error_description || error.message
      };
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(`${CALENDLY_AUTH_BASE}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      console.error('Calendly token refresh error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error_description || error.message
      };
    }
  }

  /**
   * Get current user info from Calendly
   */
  async getCurrentUser(accessToken) {
    try {
      const response = await axios.get(`${CALENDLY_API_BASE}/users/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const user = response.data.resource;
      return {
        success: true,
        user: {
          uri: user.uri,
          name: user.name,
          email: user.email,
          schedulingUrl: user.scheduling_url,
          timezone: user.timezone,
          avatarUrl: user.avatar_url,
          currentOrganization: user.current_organization
        }
      };
    } catch (error) {
      console.error('Calendly get user error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Get user's event types (scheduling links)
   */
  async getEventTypes(accessToken, userUri) {
    try {
      const response = await axios.get(`${CALENDLY_API_BASE}/event_types`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          user: userUri,
          active: true
        }
      });

      return {
        success: true,
        eventTypes: response.data.collection.map(et => ({
          uri: et.uri,
          name: et.name,
          slug: et.slug,
          schedulingUrl: et.scheduling_url,
          duration: et.duration,
          kind: et.kind,
          active: et.active
        }))
      };
    } catch (error) {
      console.error('Calendly get event types error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Get scheduled events
   */
  async getScheduledEvents(accessToken, userUri, options = {}) {
    try {
      const params = {
        user: userUri,
        status: options.status || 'active',
        count: options.count || 20
      };

      if (options.minStartTime) {
        params.min_start_time = options.minStartTime;
      }
      if (options.maxStartTime) {
        params.max_start_time = options.maxStartTime;
      }

      const response = await axios.get(`${CALENDLY_API_BASE}/scheduled_events`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params
      });

      return {
        success: true,
        events: response.data.collection.map(event => ({
          uri: event.uri,
          name: event.name,
          status: event.status,
          startTime: event.start_time,
          endTime: event.end_time,
          eventType: event.event_type,
          location: event.location,
          inviteesCounter: event.invitees_counter,
          createdAt: event.created_at,
          updatedAt: event.updated_at
        })),
        pagination: response.data.pagination
      };
    } catch (error) {
      console.error('Calendly get events error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Create a webhook subscription
   */
  async createWebhookSubscription(accessToken, organizationUri, webhookUrl, events = ['invitee.created', 'invitee.canceled']) {
    try {
      const response = await axios.post(`${CALENDLY_API_BASE}/webhook_subscriptions`, {
        url: webhookUrl,
        events: events,
        organization: organizationUri,
        scope: 'organization'
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        webhook: {
          uri: response.data.resource.uri,
          callbackUrl: response.data.resource.callback_url,
          state: response.data.resource.state,
          events: response.data.resource.events
        }
      };
    } catch (error) {
      console.error('Calendly create webhook error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload, signature, timestamp) {
    if (!this.webhookSigningKey) {
      console.warn('Calendly webhook signing key not configured');
      return true; // Skip verification if no key configured
    }

    const crypto = require('crypto');
    const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSigningKey)
      .update(signedPayload)
      .digest('hex');

    // Calendly sends signature in format: v1=<signature>
    const providedSig = signature.replace('v1=', '');
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedSig)
    );
  }

  /**
   * Process webhook event
   */
  async processWebhookEvent(event, payload) {
    console.log(`Processing Calendly webhook: ${event}`);

    const eventData = payload.payload;

    switch (event) {
      case 'invitee.created':
        return this.handleInviteeCreated(eventData);
      case 'invitee.canceled':
        return this.handleInviteeCanceled(eventData);
      default:
        console.log(`Unhandled Calendly event: ${event}`);
        return { handled: false };
    }
  }

  /**
   * Handle new booking
   */
  async handleInviteeCreated(eventData) {
    try {
      const inviteeEmail = eventData.email;
      const eventName = eventData.scheduled_event?.name;
      const startTime = eventData.scheduled_event?.start_time;
      const endTime = eventData.scheduled_event?.end_time;

      console.log(`New booking: ${inviteeEmail} for ${eventName} at ${startTime}`);

      // DEFERRED in Supabase-only mode: the candidate-status update on invitee.created
      // was only ever implemented against the Mongoose CandidateSubmission model, which
      // has been removed. The webhook still ACKs successfully. To restore, update the
      // `candidate_submissions` row by email (interview_scheduled_at, status, workflow_logs).
      const candidate = null;

      return {
        handled: true,
        action: 'invitee_created',
        inviteeEmail,
        eventName,
        startTime,
        candidateUpdated: !!candidate
      };
    } catch (error) {
      console.error('Error handling invitee.created:', error);
      return { handled: false, error: error.message };
    }
  }

  /**
   * Handle booking cancellation
   */
  async handleInviteeCanceled(eventData) {
    try {
      const inviteeEmail = eventData.email;
      const cancelReason = eventData.cancel_reason;

      console.log(`Booking canceled: ${inviteeEmail}, reason: ${cancelReason}`);

      // DEFERRED in Supabase-only mode: the candidate-status update on invitee.canceled
      // was Mongo-only (CandidateSubmission model removed). The webhook still ACKs. To
      // restore, update `candidate_submissions` by email (interview_scheduled_at=null,
      // status='interview_canceled', workflow_logs).
      const candidate = null;

      return {
        handled: true,
        action: 'invitee_canceled',
        inviteeEmail,
        cancelReason,
        candidateUpdated: !!candidate
      };
    } catch (error) {
      console.error('Error handling invitee.canceled:', error);
      return { handled: false, error: error.message };
    }
  }

  /**
   * Save Calendly connection to user
   */
  async saveUserConnection(userId, tokenData, userData) {
    // Mongo-only path. In Supabase mode the integrations route persists the
    // `calendly` column inline via the Supabase client, so this is never called.
    // Neutralized to remove the Mongoose model dependency.
    console.warn('CalendlyService.saveUserConnection is not implemented in Supabase mode; use the integrations route OAuth callback.');
    return { success: false, error: 'Not implemented in Supabase mode' };
  }

  /**
   * Disconnect Calendly from user
   */
  async disconnectUser(userId) {
    // Mongo-only path. In Supabase mode the integrations route clears the
    // `calendly` column inline, so this is never called. Neutralized to remove
    // the Mongoose model dependency.
    console.warn('CalendlyService.disconnectUser is not implemented in Supabase mode; use the integrations route.');
    return { success: false, error: 'Not implemented in Supabase mode' };
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken(userId) {
    // Mongo-only path. Token lookup/refresh persistence relied on the Mongoose
    // `User` model, which has been removed. No Supabase-mode caller invokes this.
    // Neutralized to remove the Mongoose model dependency.
    console.warn('CalendlyService.getValidToken is not implemented in Supabase mode.');
    return { success: false, error: 'Not implemented in Supabase mode' };
  }
}

module.exports = new CalendlyService();
