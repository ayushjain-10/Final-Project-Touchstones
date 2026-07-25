/**
 * Google Calendar Integration Service
 * Handles OAuth flow and calendar event management
 */

const { google } = require('googleapis');

class GoogleCalendarService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  }

  /**
   * Create OAuth2 client
   */
  createOAuth2Client() {
    return new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state = '') {
    const oauth2Client = this.createOAuth2Client();

    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'select_account consent' // Force account selection AND consent every time
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(code) {
    try {
      const oauth2Client = this.createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      return {
        success: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date
      };
    } catch (error) {
      console.error('Google token exchange error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const { credentials } = await oauth2Client.refreshAccessToken();

      return {
        success: true,
        accessToken: credentials.access_token,
        expiresAt: credentials.expiry_date
      };
    } catch (error) {
      console.error('Google token refresh error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get authenticated calendar client
   */
  getCalendarClient(accessToken, refreshToken) {
    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * List user's calendars
   */
  async listCalendars(accessToken, refreshToken) {
    try {
      const calendar = this.getCalendarClient(accessToken, refreshToken);
      const response = await calendar.calendarList.list();

      return {
        success: true,
        calendars: response.data.items.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          description: cal.description,
          primary: cal.primary || false,
          backgroundColor: cal.backgroundColor,
          accessRole: cal.accessRole
        }))
      };
    } catch (error) {
      console.error('Google list calendars error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a calendar event (interview)
   */
  async createInterviewEvent(accessToken, refreshToken, eventDetails) {
    try {
      const calendar = this.getCalendarClient(accessToken, refreshToken);

      const event = {
        summary: eventDetails.title || 'Interview',
        description: eventDetails.description || '',
        start: {
          dateTime: eventDetails.startTime,
          timeZone: eventDetails.timeZone || 'America/New_York'
        },
        end: {
          dateTime: eventDetails.endTime,
          timeZone: eventDetails.timeZone || 'America/New_York'
        },
        attendees: eventDetails.attendees?.map(email => ({ email })) || [],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'popup', minutes: 30 } // 30 minutes before
          ]
        }
      };

      // Add video conferencing if requested
      if (eventDetails.addMeet) {
        event.conferenceData = {
          createRequest: {
            requestId: `interview-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        };
      }

      const response = await calendar.events.insert({
        calendarId: eventDetails.calendarId || 'primary',
        resource: event,
        conferenceDataVersion: eventDetails.addMeet ? 1 : 0,
        sendUpdates: eventDetails.sendInvites ? 'all' : 'none'
      });

      return {
        success: true,
        event: {
          id: response.data.id,
          htmlLink: response.data.htmlLink,
          hangoutLink: response.data.hangoutLink,
          start: response.data.start,
          end: response.data.end,
          summary: response.data.summary,
          attendees: response.data.attendees
        }
      };
    } catch (error) {
      console.error('Google create event error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update a calendar event
   */
  async updateEvent(accessToken, refreshToken, eventId, updates) {
    try {
      const calendar = this.getCalendarClient(accessToken, refreshToken);

      const event = {};
      if (updates.title) event.summary = updates.title;
      if (updates.description) event.description = updates.description;
      if (updates.startTime) {
        event.start = {
          dateTime: updates.startTime,
          timeZone: updates.timeZone || 'America/New_York'
        };
      }
      if (updates.endTime) {
        event.end = {
          dateTime: updates.endTime,
          timeZone: updates.timeZone || 'America/New_York'
        };
      }

      const response = await calendar.events.patch({
        calendarId: updates.calendarId || 'primary',
        eventId: eventId,
        resource: event,
        sendUpdates: updates.sendInvites ? 'all' : 'none'
      });

      return {
        success: true,
        event: response.data
      };
    } catch (error) {
      console.error('Google update event error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(accessToken, refreshToken, eventId, calendarId = 'primary') {
    try {
      const calendar = this.getCalendarClient(accessToken, refreshToken);

      await calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId,
        sendUpdates: 'all'
      });

      return { success: true };
    } catch (error) {
      console.error('Google delete event error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get upcoming events
   */
  async getUpcomingEvents(accessToken, refreshToken, options = {}) {
    try {
      const calendar = this.getCalendarClient(accessToken, refreshToken);

      const response = await calendar.events.list({
        calendarId: options.calendarId || 'primary',
        timeMin: options.timeMin || new Date().toISOString(),
        maxResults: options.maxResults || 10,
        singleEvents: true,
        orderBy: 'startTime',
        q: options.query || undefined
      });

      return {
        success: true,
        events: response.data.items.map(event => ({
          id: event.id,
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          htmlLink: event.htmlLink,
          hangoutLink: event.hangoutLink,
          attendees: event.attendees,
          status: event.status
        }))
      };
    } catch (error) {
      console.error('Google get events error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save Google Calendar connection to user
   */
  async saveUserConnection(userId, tokenData, calendarId = 'primary') {
    // Mongo-only path (legacy ./routes/integrations.js). In Supabase mode the
    // route persists tokens directly via the Supabase client, so this method is
    // never called. Neutralized to remove the Mongoose model dependency.
    return { success: false, error: 'saveUserConnection not supported in Supabase mode' };
  }

  /**
   * Disconnect Google Calendar from user
   */
  async disconnectUser(userId) {
    // Mongo-only path (legacy ./routes/integrations.js). In Supabase mode the
    // route clears tokens via `.update({ google_calendar: null })`, so this
    // method is never called. Neutralized to remove the Mongoose model dependency.
    return { success: false, error: 'disconnectUser not supported in Supabase mode' };
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken(userId) {
    // Mongo-only path (legacy ./routes/integrations.js). In Supabase mode the
    // route reads tokens straight from the `google_calendar` column and passes
    // them into the stateless service methods, so this method is never called.
    // Neutralized to remove the Mongoose model dependency.
    return { success: false, error: 'getValidToken not supported in Supabase mode' };
  }

  /**
   * Schedule an interview with a candidate
   */
  async scheduleInterview(userId, candidateData, interviewDetails) {
    // Mongo-only path. Depended on getValidToken (now Supabase-unsupported),
    // User.findById, and CandidateSubmission.findByIdAndUpdate. No route requires
    // this method in Supabase mode (the Supabase route builds the event itself
    // and calls createInterviewEvent directly). Neutralized to remove the
    // Mongoose model dependencies.
    return { success: false, error: 'scheduleInterview not supported in Supabase mode' };
  }
}

module.exports = new GoogleCalendarService();
