/**
 * Calendar Integrations Routes - Supabase Version
 * Migrated from MongoDB/Mongoose to Supabase/PostgreSQL
 * Supports Google Calendar and Calendly with proper OAuth flows
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const googleCalendarService = require('../../services/googleCalendarService');

// --- Signed OAuth `state` ---------------------------------------------------------------------
// The callback writes provider tokens onto the profile named by `state.userId`. An UNSIGNED,
// client-controlled state therefore lets an attacker craft a callback that binds THEIR provider
// account to a VICTIM's profile (or vice-versa) — an account-linking CSRF. Sign the state with an
// HMAC over a server secret and verify it (constant-time, with a freshness window) before trusting
// any field. The service-role key is a high-entropy server secret that never leaves the backend.
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyOAuthState(state, maxAgeMs = 15 * 60 * 1000) {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!data || typeof data.iat !== 'number' || Date.now() - data.iat > maxAgeMs) return null;
  return data;
}

// ============================================
// INTEGRATION STATUS
// ============================================

/**
 * GET /api/integrations/status
 * Get all integration statuses
 */
router.get('/status', supabaseAuth, async (req, res) => {
    try {
        // Prevent caching
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const db = req.user.supabase;
        const userId = req.user.id;
        console.log('Fetching integration status for user:', userId, 'email:', req.user.email);

        const { data: user, error } = await db
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !user) {
            console.error('User not found:', userId);
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        console.log('User found:', user.email, 'Calendly connected:', user?.calendly?.connected, 'Google connected:', user?.google_calendar?.connected);

        res.json({
            success: true,
            userId: userId,
            userEmail: user.email,
            integrations: {
                calendly: {
                    connected: user?.calendly?.connected || false,
                    schedulingUrl: user?.calendly?.scheduling_url || null,
                    email: user?.calendly?.email || null,
                    name: user?.calendly?.name || null
                },
                googleCalendar: {
                    connected: user?.google_calendar?.connected || false,
                    calendarId: user?.google_calendar?.calendar_id || 'primary',
                    calendarName: user?.google_calendar?.calendar_name || null,
                    email: user?.google_calendar?.email || null,
                    hasTokens: !!(user?.google_calendar?.access_token && user?.google_calendar?.refresh_token)
                }
            }
        });
    } catch (error) {
        console.error('Integration status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// CALENDLY OAUTH ROUTES
// ============================================

/**
 * Revoke Calendly OAuth tokens
 */
async function revokeCalendlyToken(accessToken, refreshToken = null) {
    const clientId = process.env.CALENDLY_CLIENT_ID;
    const clientSecret = process.env.CALENDLY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.log('Calendly credentials not configured, skipping revocation');
        return { success: false, error: 'Not configured' };
    }

    const results = [];

    // Revoke access token
    if (accessToken) {
        try {
            await axios.post('https://auth.calendly.com/oauth/revoke', {
                client_id: clientId,
                client_secret: clientSecret,
                token: accessToken
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log('Calendly access token revoked successfully');
            results.push({ type: 'access_token', success: true });
        } catch (error) {
            console.log('Calendly access token revocation failed:', error.response?.data || error.message);
            results.push({ type: 'access_token', success: false, error: error.message });
        }
    }

    // Revoke refresh token
    if (refreshToken) {
        try {
            await axios.post('https://auth.calendly.com/oauth/revoke', {
                client_id: clientId,
                client_secret: clientSecret,
                token: refreshToken
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log('Calendly refresh token revoked successfully');
            results.push({ type: 'refresh_token', success: true });
        } catch (error) {
            console.log('Calendly refresh token revocation failed:', error.response?.data || error.message);
            results.push({ type: 'refresh_token', success: false, error: error.message });
        }
    }

    return { success: results.some(r => r.success), results };
}

/**
 * GET /api/integrations/calendly/auth
 * Start Calendly OAuth flow - returns auth URL
 */
router.get('/calendly/auth', supabaseAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const db = req.user.supabase;
        const clientId = process.env.CALENDLY_CLIENT_ID;
        const redirectUri = process.env.CALENDLY_REDIRECT_URI;

        if (!clientId || !redirectUri) {
            return res.status(500).json({
                success: false,
                error: 'Calendly OAuth not configured'
            });
        }

        const userId = req.user.id;
        console.log('Generating Calendly auth URL for user:', userId, 'email:', req.user.email);

        // Revoke existing tokens
        const { data: user } = await db
            .from('profiles')
            .select('calendly')
            .eq('id', userId)
            .single();

        if (user?.calendly?.access_token || user?.calendly?.refresh_token) {
            console.log('Revoking existing Calendly tokens for user:', userId);
            await revokeCalendlyToken(user.calendly.access_token, user.calendly.refresh_token);

            // Clear tokens from database
            const updatedCalendly = { ...user.calendly, access_token: null, refresh_token: null, connected: false };
            await db
                .from('profiles')
                .update({ calendly: updatedCalendly })
                .eq('id', userId);
        }

        // Store user ID in a SIGNED state so the callback can trust who initiated this flow.
        const state = signOAuthState({
            userId: userId,
            userEmail: req.user.email,
            returnUrl: req.query.returnUrl || '/integrations',
        });

        const oauthUrl = `https://auth.calendly.com/oauth/authorize?` +
            `client_id=${clientId}` +
            `&response_type=code` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&state=${state}`;

        console.log('Generated Calendly auth URL for user:', userId);
        res.json({ success: true, authUrl: oauthUrl, userId: userId });
    } catch (error) {
        console.error('Calendly auth URL error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/calendly/callback
 * Handle Calendly OAuth callback
 */
router.get('/calendly/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        if (error) {
            console.error('Calendly OAuth error:', error);
            return res.redirect(`${frontendUrl}/integrations?error=calendly_auth_failed`);
        }

        if (!code || !state) {
            return res.redirect(`${frontendUrl}/integrations?error=missing_params`);
        }

        // Verify the signed state before trusting any field (prevents account-linking CSRF).
        const stateData = verifyOAuthState(state);
        if (!stateData) {
            return res.redirect(`${frontendUrl}/integrations?error=invalid_state`);
        }

        const { userId, userEmail, returnUrl } = stateData;
        console.log('Calendly callback for user:', userId, 'email:', userEmail);

        // Exchange code for tokens
        const tokenResponse = await axios.post('https://auth.calendly.com/oauth/token', {
            grant_type: 'authorization_code',
            client_id: process.env.CALENDLY_CLIENT_ID,
            client_secret: process.env.CALENDLY_CLIENT_SECRET,
            code: code,
            redirect_uri: process.env.CALENDLY_REDIRECT_URI
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        // Get user info from Calendly
        const userResponse = await axios.get('https://api.calendly.com/users/me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const calendlyUser = userResponse.data.resource;
        console.log('Calendly account:', calendlyUser.email, 'for user:', userEmail);

        // Save to database
        const calendlyData = {
            access_token: access_token,
            refresh_token: refresh_token,
            token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
            user_uri: calendlyUser.uri,
            scheduling_url: calendlyUser.scheduling_url,
            email: calendlyUser.email,
            name: calendlyUser.name,
            organization_uri: calendlyUser.current_organization,
            connected: true
        };

        await supabaseAdmin
            .from('profiles')
            .update({ calendly: calendlyData })
            .eq('id', userId);

        console.log('Calendly connected for user:', userId, '- Calendly account:', calendlyUser.email);
        res.redirect(`${frontendUrl}${returnUrl || '/integrations'}?success=calendly_connected`);
    } catch (error) {
        console.error('Calendly callback error:', error.response?.data || error.message);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/integrations?error=calendly_callback_failed`);
    }
});

/**
 * POST /api/integrations/calendly/disconnect
 */
router.post('/calendly/disconnect', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;

        // Get user's current tokens before clearing
        const { data: user } = await db
            .from('profiles')
            .select('calendly')
            .eq('id', userId)
            .single();

        // Revoke tokens with Calendly
        if (user?.calendly?.access_token || user?.calendly?.refresh_token) {
            console.log('Revoking Calendly tokens on disconnect for user:', userId);
            await revokeCalendlyToken(user.calendly.access_token, user.calendly.refresh_token);
        }

        // Clear Calendly data
        await db
            .from('profiles')
            .update({ calendly: null })
            .eq('id', userId);

        console.log('Calendly disconnected for user:', userId);
        res.json({ success: true, message: 'Calendly disconnected' });
    } catch (error) {
        console.error('Calendly disconnect error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/calendly/status
 */
router.get('/calendly/status', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('calendly')
            .eq('id', req.user.id)
            .single();

        res.json({
            success: true,
            connected: user?.calendly?.connected || false,
            schedulingUrl: user?.calendly?.scheduling_url || null,
            email: user?.calendly?.email || null,
            name: user?.calendly?.name || null
        });
    } catch (error) {
        console.error('Calendly status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/calendly/event-types
 */
router.get('/calendly/event-types', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('calendly')
            .eq('id', req.user.id)
            .single();

        if (!user?.calendly?.connected || !user?.calendly?.access_token) {
            return res.status(401).json({ success: false, error: 'Calendly not connected' });
        }

        const response = await axios.get('https://api.calendly.com/event_types', {
            headers: { Authorization: `Bearer ${user.calendly.access_token}` },
            params: { user: user.calendly.user_uri }
        });

        res.json({
            success: true,
            eventTypes: response.data.collection.map(et => ({
                uri: et.uri,
                name: et.name,
                slug: et.slug,
                duration: et.duration,
                schedulingUrl: et.scheduling_url,
                active: et.active
            }))
        });
    } catch (error) {
        console.error('Calendly event types error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/integrations/calendly/create-meeting
 */
router.post('/calendly/create-meeting', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;
        const { data: user } = await db
            .from('profiles')
            .select('calendly')
            .eq('id', userId)
            .single();

        if (!user?.calendly?.connected || !user?.calendly?.access_token) {
            return res.status(401).json({ success: false, error: 'Calendly not connected' });
        }

        const { candidateName, candidateEmail, title, duration, startDate, endDate } = req.body;

        // Get event types
        const eventTypesResponse = await axios.get('https://api.calendly.com/event_types', {
            headers: { Authorization: `Bearer ${user.calendly.access_token}` },
            params: { user: user.calendly.user_uri, active: true }
        });

        const eventTypes = eventTypesResponse.data.collection;
        if (!eventTypes || eventTypes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No active event types found. Please create an event type in Calendly first.'
            });
        }

        // Find matching event type
        const requestedDuration = parseInt(duration) || 30;
        let eventType = eventTypes.find(et => et.duration === requestedDuration);
        if (!eventType) {
            eventType = eventTypes[0];
        }

        // Create scheduling link
        const schedulingLinkResponse = await axios.post(
            'https://api.calendly.com/scheduling_links',
            {
                max_event_count: 1,
                owner: eventType.uri,
                owner_type: 'EventType'
            },
            {
                headers: {
                    Authorization: `Bearer ${user.calendly.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const schedulingLink = schedulingLinkResponse.data.resource;

        console.log('Created Calendly one-off meeting link for:', candidateEmail || candidateName);

        res.json({
            success: true,
            meetingLink: schedulingLink.booking_url,
            eventType: {
                name: eventType.name,
                duration: eventType.duration
            },
            message: `Share this link with ${candidateName || 'the candidate'} to schedule the interview`
        });
    } catch (error) {
        console.error('Calendly create meeting error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.message || error.message
        });
    }
});

/**
 * GET /api/integrations/calendly/events
 */
router.get('/calendly/events', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('calendly')
            .eq('id', req.user.id)
            .single();

        if (!user?.calendly?.connected || !user?.calendly?.access_token) {
            return res.status(401).json({ success: false, error: 'Calendly not connected' });
        }

        const { status = 'active', count = 20 } = req.query;

        const response = await axios.get('https://api.calendly.com/scheduled_events', {
            headers: { Authorization: `Bearer ${user.calendly.access_token}` },
            params: {
                user: user.calendly.user_uri,
                status: status,
                count: parseInt(count),
                sort: 'start_time:asc'
            }
        });

        res.json({
            success: true,
            events: response.data.collection.map(event => ({
                uri: event.uri,
                name: event.name,
                status: event.status,
                startTime: event.start_time,
                endTime: event.end_time,
                location: event.location,
                createdAt: event.created_at
            }))
        });
    } catch (error) {
        console.error('Calendly events error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// GOOGLE CALENDAR OAUTH ROUTES
// ============================================

/**
 * GET /api/integrations/google/auth
 */
router.get('/google/auth', supabaseAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const userId = req.user.id;
        console.log('Generating Google auth URL for user:', userId, 'email:', req.user.email);

        const state = signOAuthState({
            userId: userId,
            userEmail: req.user.email,
            returnUrl: req.query.returnUrl || '/integrations',
        });

        const authUrl = googleCalendarService.getAuthorizationUrl(state);

        console.log('Generated Google auth URL with state for user:', userId);
        res.json({ success: true, authUrl, userId: userId });
    } catch (error) {
        console.error('Google auth URL error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/google/callback
 */
router.get('/google/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        if (error) {
            console.error('Google OAuth error:', error);
            return res.redirect(`${frontendUrl}/integrations?error=google_auth_failed`);
        }

        if (!code || !state) {
            return res.redirect(`${frontendUrl}/integrations?error=missing_params`);
        }

        // Verify the signed state before trusting userId (prevents account-linking CSRF).
        const stateData = verifyOAuthState(state);
        if (!stateData) {
            return res.redirect(`${frontendUrl}/integrations?error=invalid_state`);
        }

        const { userId, returnUrl } = stateData;

        // Exchange code for tokens
        const tokenResult = await googleCalendarService.exchangeCodeForToken(code);
        if (!tokenResult.success) {
            return res.redirect(`${frontendUrl}/integrations?error=token_exchange_failed`);
        }

        // Get user's calendar list
        const calendars = await googleCalendarService.listCalendars(
            tokenResult.accessToken,
            tokenResult.refreshToken
        );

        let email = null;
        let calendarName = null;
        if (calendars.success && calendars.calendars) {
            const primary = calendars.calendars.find(c => c.primary);
            if (primary) {
                email = primary.id;
                calendarName = primary.summary;
            }
        }

        // Save to database
        const googleCalendarData = {
            access_token: tokenResult.accessToken,
            refresh_token: tokenResult.refreshToken,
            token_expires_at: new Date(tokenResult.expiresAt).toISOString(),
            calendar_id: 'primary',
            calendar_name: calendarName,
            email: email,
            connected: true
        };

        await supabaseAdmin
            .from('profiles')
            .update({ google_calendar: googleCalendarData })
            .eq('id', userId);

        console.log('Google Calendar connected for user:', userId, email);
        res.redirect(`${frontendUrl}${returnUrl || '/integrations'}?success=google_connected`);
    } catch (error) {
        console.error('Google callback error:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/integrations?error=google_callback_failed`);
    }
});

/**
 * POST /api/integrations/google/disconnect
 */
router.post('/google/disconnect', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;

        await db
            .from('profiles')
            .update({ google_calendar: null })
            .eq('id', userId);

        console.log('Google Calendar disconnected for user:', userId);
        res.json({ success: true, message: 'Google Calendar disconnected' });
    } catch (error) {
        console.error('Google Calendar disconnect error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/google/status
 */
router.get('/google/status', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('google_calendar')
            .eq('id', req.user.id)
            .single();

        res.json({
            success: true,
            connected: user?.google_calendar?.connected || false,
            calendarId: user?.google_calendar?.calendar_id || 'primary',
            calendarName: user?.google_calendar?.calendar_name || null,
            email: user?.google_calendar?.email || null
        });
    } catch (error) {
        console.error('Google Calendar status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/google/calendars
 */
router.get('/google/calendars', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('google_calendar')
            .eq('id', req.user.id)
            .single();

        if (!user?.google_calendar?.connected || !user?.google_calendar?.access_token) {
            return res.status(401).json({ success: false, error: 'Google Calendar not connected' });
        }

        const result = await googleCalendarService.listCalendars(
            user.google_calendar.access_token,
            user.google_calendar.refresh_token
        );

        res.json(result);
    } catch (error) {
        console.error('Google calendars error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/integrations/google/calendar
 */
router.put('/google/calendar', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { calendarId, calendarName } = req.body;

        const { data: user } = await db
            .from('profiles')
            .select('google_calendar')
            .eq('id', req.user.id)
            .single();

        const updatedGoogleCalendar = {
            ...user?.google_calendar,
            calendar_id: calendarId || 'primary',
            calendar_name: calendarName
        };

        await db
            .from('profiles')
            .update({ google_calendar: updatedGoogleCalendar })
            .eq('id', req.user.id);

        res.json({ success: true, calendarId, calendarName });
    } catch (error) {
        console.error('Update calendar error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/google/events
 */
router.get('/google/events', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('google_calendar')
            .eq('id', req.user.id)
            .single();

        if (!user?.google_calendar?.connected || !user?.google_calendar?.access_token) {
            return res.status(401).json({ success: false, error: 'Google Calendar not connected' });
        }

        const result = await googleCalendarService.getUpcomingEvents(
            user.google_calendar.access_token,
            user.google_calendar.refresh_token,
            {
                maxResults: parseInt(req.query.limit) || 10,
                query: req.query.query
            }
        );

        res.json(result);
    } catch (error) {
        console.error('Google events error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/integrations/google/events
 */
router.post('/google/events', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const userId = req.user.id;
        console.log('Creating Google Calendar event for user:', userId);

        const { data: user } = await db
            .from('profiles')
            .select('google_calendar')
            .eq('id', userId)
            .single();

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        if (!user.google_calendar?.connected) {
            return res.status(400).json({ success: false, error: 'Google Calendar not connected. Please connect your Google Calendar first.' });
        }

        if (!user.google_calendar?.access_token || !user.google_calendar?.refresh_token) {
            console.error('Missing tokens for user:', userId);
            return res.status(400).json({ success: false, error: 'Google Calendar tokens missing. Please reconnect your Google Calendar.' });
        }

        console.log('Got valid token, creating event...');

        const eventDetails = {
            title: req.body.title || req.body.summary,
            description: req.body.description,
            startTime: req.body.startTime || req.body.start,
            endTime: req.body.endTime || req.body.end,
            timeZone: req.body.timeZone || 'America/Los_Angeles',
            attendees: req.body.attendees || [],
            calendarId: req.body.calendarId || user.google_calendar?.calendar_id || 'primary',
            addMeet: req.body.addMeet !== false,
            sendInvites: req.body.sendInvites !== false
        };

        const result = await googleCalendarService.createInterviewEvent(
            user.google_calendar.access_token,
            user.google_calendar.refresh_token,
            eventDetails
        );

        if (result.success) {
            console.log('Event created successfully:', result.event?.id);
        } else {
            console.error('Event creation failed:', result.error);
        }

        res.json(result);
    } catch (error) {
        console.error('Create event error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/integrations/google/events/:eventId
 */
router.delete('/google/events/:eventId', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data: user } = await db
            .from('profiles')
            .select('google_calendar')
            .eq('id', req.user.id)
            .single();

        if (!user?.google_calendar?.connected || !user?.google_calendar?.access_token) {
            return res.status(401).json({ success: false, error: 'Google Calendar not connected' });
        }

        const calendarId = req.query.calendarId || user.google_calendar?.calendar_id || 'primary';

        const result = await googleCalendarService.deleteEvent(
            user.google_calendar.access_token,
            user.google_calendar.refresh_token,
            req.params.eventId,
            calendarId
        );

        res.json(result);
    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ADDITIONAL INTEGRATION ENDPOINTS
// Gmail, LinkedIn, ATS, Calendar (generic)
// ============================================

// Root integrations list
router.get('/', supabaseAuth, async (req, res) => {
    // Same as /status
    res.redirect('/api/integrations/status');
});

// Gmail OAuth
router.get('/gmail/auth', supabaseAuth, (req, res) => {
    res.json({ url: 'https://accounts.google.com/o/oauth2/auth', message: 'Gmail OAuth not fully configured' });
});

router.post('/gmail/disconnect', supabaseAuth, async (req, res) => {
    res.json({ success: true, message: 'Gmail disconnected' });
});

// LinkedIn OAuth
router.get('/linkedin/auth', supabaseAuth, (req, res) => {
    res.json({ url: 'https://www.linkedin.com/oauth/v2/authorization', message: 'LinkedIn OAuth not fully configured' });
});

// Calendar (generic, redirects to Google Calendar)
router.get('/calendar/auth', supabaseAuth, (req, res) => {
    res.redirect('/api/integrations/google/auth');
});

router.get('/calendar/events', supabaseAuth, async (req, res) => {
    res.json({ events: [], message: 'Calendar not connected' });
});

// ATS integrations
router.get('/ats', supabaseAuth, (req, res) => {
    res.json({
        integrations: [
            { id: 'greenhouse', name: 'Greenhouse', status: 'available' },
            { id: 'lever', name: 'Lever', status: 'available' },
            { id: 'workday', name: 'Workday', status: 'coming_soon' }
        ]
    });
});

module.exports = router;
