/**
 * Auth Routes - Supabase Version
 *
 * Note: With Supabase, most auth (signUp, signIn, signInWithOAuth) is handled
 * client-side via the Supabase JS client. This route handles:
 * - Profile management (get/update)
 * - Stripe subscription verification
 * - Session verification
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { supabase, supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const emailService = require('../../services/emailService');
const emailTemplates = require('../../services/emailTemplates');
const { ensureAuthUser } = require('../../services/userProvisioning');
// Guarded: constructing Stripe with an undefined key throws at module load,
// which would crash the whole app boot / every test suite when STRIPE_SECRET_KEY
// is unset (CI, or prod before payments are configured).
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const bcrypt = require('bcryptjs');

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ensureAuthUser(email, metadata, password?) is now shared via services/userProvisioning.js
// (imported above) so non-route callers can reuse it without a route→service import cycle.

/**
 * Helper: Get Supabase session tokens for a user.
 * Syncs the password to auth.users, then signs in to get real session tokens.
 * For Google OAuth users (no password), sets a random password.
 */
async function getSupabaseSession(userId, email, password) {
    try {
        // Sync password to auth.users
        const pw = password || crypto.randomBytes(32).toString('hex');
        await supabaseAdmin.auth.admin.updateUserById(userId, { password: pw });

        // Sign in with Supabase to get real session tokens
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) {
            console.warn('Supabase signIn failed, falling back to custom JWT:', error.message);
            return null;
        }
        return data.session;
    } catch (err) {
        console.warn('getSupabaseSession error:', err.message);
        return null;
    }
}

// POST /api/auth/register, /api/auth/login — DEPRECATED (410 Gone).
// The app authenticates via Supabase Auth (client-side signInWithPassword / signUp); the
// backend trusts the Supabase session JWT (see middleware/supabaseAuth). This legacy custom-JWT
// path referenced profile columns that no longer exist (password_hash / subscription) and is
// unused — kept as a 410 so any stray caller fails loudly with guidance, not a 500 schema error.
// (The OAuth/session/me/refresh routes below are unaffected.)
const authGone = (req, res) => res.status(410).json({
    error: 'Gone',
    message: 'This endpoint is deprecated. Authenticate with Supabase Auth (the app handles sign in / sign up).',
});
router.post('/register', authGone);
router.post('/login', authGone);

// POST /api/auth/logout - Logout
router.post('/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

// POST /api/auth/refresh - Refresh token
router.post('/refresh', supabaseAuth, async (req, res) => {
    try {
        const token = jwt.sign(
            { id: req.user.id, email: req.user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({ token });
    } catch (error) {
        res.status(401).json({ error: 'Token refresh failed' });
    }
});

const RESET_TOKEN_TTL = '1h';

/**
 * Fingerprint binding a reset token to the account's current password state.
 * The token embeds this value at issue time; reset-password recomputes it and
 * requires a match. As soon as the password changes (or any newer reset
 * completes), the stored hash differs and every previously-issued token stops
 * validating — giving us single-use semantics without a token store.
 */
function resetTokenFingerprint(passwordHash) {
    return crypto
        .createHash('sha256')
        .update(`${passwordHash || ''}|${process.env.JWT_SECRET}`)
        .digest('hex')
        .slice(0, 16);
}

/**
 * Look up the account for `email` and, if it's a password-based account, issue
 * a single-use reset token and email it. Runs out-of-band from the request so
 * the endpoint's response timing is identical for existing and non-existing
 * accounts (no timing oracle). Never throws — all errors are logged.
 */
async function sendPasswordResetEmail(email) {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, email, password_hash, first_name')
        .eq('email', email)
        .single();

    // Only password-based accounts can reset a password. Unknown emails and
    // Google-only accounts (no password_hash) get no email.
    if (!profile || !profile.password_hash) return;

    const token = jwt.sign(
        {
            sub: profile.id,
            email: profile.email,
            purpose: 'password_reset',
            fp: resetTokenFingerprint(profile.password_hash)
        },
        process.env.JWT_SECRET,
        { expiresIn: RESET_TOKEN_TTL }
    );

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${encodeURIComponent(token)}`;

    await emailService.sendEmail({
        to: profile.email,
        subject: 'Reset your Touchstones password',
        body:
            `Hi${profile.first_name ? ' ' + profile.first_name : ''},\n\n` +
            `We received a request to reset your Touchstones password. Use the link ` +
            `below to choose a new one. It expires in 1 hour and can only be used once.\n\n` +
            `${resetUrl}\n\n` +
            `If you didn't request this, you can safely ignore this email — your ` +
            `password won't change.`,
        html: emailTemplates.passwordReset({ firstName: profile.first_name, resetUrl }),
        fromName: 'Touchstones',
    });
}

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    // Respond immediately with a generic message in EVERY case. The lookup and
    // email send happen fire-and-forget below, so response timing is identical
    // whether or not the account exists — closing the timing side-channel as
    // well as the response-content one (anti-enumeration).
    res.json({ message: 'If an account exists, a reset email has been sent' });

    sendPasswordResetEmail(email).catch((err) => {
        console.error('forgot-password: async reset failed:', err.message);
    });
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // 1. Verify the signature and expiry. A forged or expired token fails here.
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    if (!payload || payload.purpose !== 'password_reset' || !payload.sub) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    try {
        // 2. Load the account the token was issued for.
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('id, email, password_hash')
            .eq('id', payload.sub)
            .single();

        if (error || !profile) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // 3. Enforce single-use: reject if the password has changed since the
        //    token was issued (a used or superseded token).
        if (resetTokenFingerprint(profile.password_hash) !== payload.fp) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // 4. Persist the new password to BOTH stores the app authenticates
        //    against: profiles.password_hash (bcrypt /login flow) and Supabase
        //    auth.users (native session flow).
        const newHash = await bcrypt.hash(password, 10);

        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({ password_hash: newHash })
            .eq('id', profile.id);

        if (updateError) throw updateError;

        // Keep Supabase Auth in sync. Best-effort: /login authenticates via the
        // bcrypt hash above, so a sync failure doesn't block the reset.
        try {
            await supabaseAdmin.auth.admin.updateUserById(profile.id, { password });
        } catch (syncErr) {
            console.error('reset-password: Supabase auth sync failed:', syncErr.message);
        }

        return res.json({ message: 'Password has been reset' });
    } catch (err) {
        console.error('reset-password error:', err.message);
        return res.status(500).json({ error: 'Failed to reset password' });
    }
});

// GET /api/auth/google - Google OAuth redirect
router.get('/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return res.json({ message: 'Google OAuth not configured', url: null });
    }
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/google/callback`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile`;
    res.json({ url });
});

// POST /api/auth/google - Google Sign-In
router.post('/google', async (req, res) => {
    const { credential, sessionId } = req.body;
    try {
        // Verify Google token
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        // Handle Stripe Subscription if sessionId is provided
        let subscriptionData = null;
        if (sessionId) {
            try {
                console.log('Verifying Stripe session for Google Auth:', sessionId);
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                if (session.payment_status === 'paid' && session.subscription) {
                    const subscription = await stripe.subscriptions.retrieve(session.subscription);

                    let periodEnd = new Date();
                    if (subscription.current_period_end) {
                        periodEnd = new Date(subscription.current_period_end * 1000);
                    } else {
                        periodEnd.setDate(periodEnd.getDate() + 30);
                    }

                    subscriptionData = {
                        plan: 'growth',
                        stripe_customer_id: session.customer,
                        stripe_subscription_id: session.subscription,
                        subscription_status: subscription.status,
                        subscription_period_end: periodEnd.toISOString()
                    };
                    console.log('Google Auth: Subscription verified:', subscriptionData);
                }
            } catch (err) {
                console.error('Error verifying Stripe session during Google Auth:', err);
            }
        }

        // Ensure auth.users entry exists (creates or repairs if needed)
        const authUserId = await ensureAuthUser(payload.email, {
            full_name: payload.name,
            avatar_url: payload.picture,
            provider: 'google'
        });

        // Check if profile exists for this auth user
        const { data: existingProfile, error: findError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', authUserId)
            .single();

        let user;
        if (findError && findError.code === 'PGRST116') {
            // No profile yet - create one with the correct auth user ID
            const nameParts = (payload.name || '').split(' ');
            const newProfile = {
                id: authUserId,
                email: payload.email,
                first_name: nameParts[0] || '',
                last_name: nameParts.slice(1).join(' ') || '',
                provider: 'google',
                profile_pic: payload.picture,
                subscription: subscriptionData ? {
                    plan: subscriptionData.plan,
                    status: subscriptionData.subscription_status
                } : { plan: 'free', status: 'active' },
                ...(subscriptionData && {
                    stripe_customer_id: subscriptionData.stripe_customer_id,
                    stripe_subscription_id: subscriptionData.stripe_subscription_id,
                    subscription_status: subscriptionData.subscription_status,
                    subscription_period_end: subscriptionData.subscription_period_end
                })
            };

            const { data: createdProfile, error: createError } = await supabaseAdmin
                .from('profiles')
                .insert(newProfile)
                .select()
                .single();

            if (createError) throw createError;
            user = createdProfile;
        } else if (findError) {
            throw findError;
        } else {
            // User exists with proper auth linkage
            user = existingProfile;

            // Update subscription if provided
            if (subscriptionData) {
                console.log('Upgrading existing Google user to Growth');
                const { data: updatedProfile, error: updateError } = await supabaseAdmin
                    .from('profiles')
                    .update({
                        stripe_customer_id: subscriptionData.stripe_customer_id,
                        stripe_subscription_id: subscriptionData.stripe_subscription_id,
                        subscription_status: subscriptionData.subscription_status,
                        subscription_period_end: subscriptionData.subscription_period_end,
                        subscription: { plan: 'growth', status: subscriptionData.subscription_status },
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', user.id)
                    .select()
                    .single();

                if (!updateError) user = updatedProfile;
            }
        }

        // Get Supabase session tokens (sets random password for Google users)
        const supabaseSession = await getSupabaseSession(user.id, user.email, null);

        // Generate custom JWT (backward compat)
        const token = jwt.sign(
            { id: user.id, email: user.email, name: `${user.first_name} ${user.last_name}`.trim() },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const response = {
            token: supabaseSession?.access_token || token,
            user: {
                id: user.id,
                name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || payload.name,
                email: user.email,
                company: user.company,
                provider: user.provider || 'google',
                profilePic: user.profile_pic || payload.picture,
                subscription: user.subscription
            },
        };

        // Include Supabase session tokens if available
        if (supabaseSession) {
            response.access_token = supabaseSession.access_token;
            response.refresh_token = supabaseSession.refresh_token;
            response.expires_in = supabaseSession.expires_in;
        }

        res.json(response);
    } catch (err) {
        console.error('Google auth error:', err);
        res.status(401).json({ message: 'Google authentication failed', error: err.message });
    }
});

// POST /api/auth/verify-session - Verify Supabase session and return user data
router.post('/verify-session', supabaseAuth, async (req, res) => {
    try {
        // Session already verified by middleware
        // Return user profile from profiles table
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        res.json({
            user: {
                id: req.user.id,
                email: req.user.email,
                ...profile
            }
        });
    } catch (error) {
        console.error('Session verification error:', error);
        res.status(500).json({ error: 'Failed to verify session' });
    }
});

// GET /api/auth/me - Get current user profile
router.get('/me', supabaseAuth, async (req, res) => {
    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Profile not found' });
            }
            throw error;
        }

        res.json({
            id: req.user.id,
            email: req.user.email,
            ...profile
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// PUT /api/auth/me - Update current user profile
router.put('/me', supabaseAuth, async (req, res) => {
    try {
        const updates = {};

        if (req.body.firstName !== undefined) updates.first_name = req.body.firstName;
        if (req.body.lastName !== undefined) updates.last_name = req.body.lastName;
        if (req.body.first_name !== undefined) updates.first_name = req.body.first_name;
        if (req.body.last_name !== undefined) updates.last_name = req.body.last_name;
        if (req.body.company !== undefined) updates.company = req.body.company;
        if (req.body.role !== undefined) updates.role = req.body.role;

        // Handle profile picture upload
        if (req.files && req.files.profilePic) {
            const file = req.files.profilePic;
            const fileExt = path.extname(file.name);
            const fileName = `${req.user.id}/profile${fileExt}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabaseAdmin.storage
                .from('avatars')
                .upload(fileName, file.data, {
                    contentType: file.mimetype,
                    upsert: true
                });

            if (!uploadError) {
                const { data: { publicUrl } } = supabaseAdmin.storage
                    .from('avatars')
                    .getPublicUrl(fileName);
                updates.avatar_url = publicUrl;
            }
        }

        updates.updated_at = new Date().toISOString();

        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            id: req.user.id,
            email: req.user.email,
            ...profile
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile', message: error.message });
    }
});

// DELETE /api/auth/account - permanent account deletion (our privacy policy promises this).
// Removes the profile row and the Supabase auth identity. Related rows with an ON DELETE CASCADE
// FK to auth.users are cleaned up by Postgres; this is the real, self-service "right to be forgotten".
router.delete('/account', supabaseAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        // Best-effort app-data cleanup (in addition to any FK cascade on the auth user delete).
        await supabaseAdmin.from('profiles').delete().eq('id', userId).then(() => {}, () => {});
        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (error) throw error;
        res.json({ ok: true });
    } catch (error) {
        console.error('Account deletion error:', error);
        res.status(500).json({ error: 'Failed to delete account', message: error.message });
    }
});

// DEPRECATED (410 Gone) — S-6 self-grant/hijack fix. This trusted any caller-supplied paid Stripe
// sessionId with NO ownership binding and hardcoded 'growth' onto the caller's profile (a replay +
// cross-account-corruption hole; also wrote the phantom subscription_period_end column). Zero frontend
// callers — the signed Stripe webhook is the authoritative plan-setter. 410'd like /register //login.
const subscriptionGone = (req, res) => res.status(410).json({
    error: 'Gone',
    message: 'Deprecated. Subscription state is applied server-side by the signed Stripe webhook.',
});
router.post('/verify-subscription', subscriptionGone);

// GET /api/auth/subscription - Get current subscription status
router.get('/subscription', supabaseAuth, async (req, res) => {
    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('subscription_plan, subscription_status, subscription_period_end, stripe_customer_id')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        res.json({
            plan: profile.subscription_plan || 'free',
            status: profile.subscription_status || 'inactive',
            currentPeriodEnd: profile.subscription_period_end,
            hasCustomerId: !!profile.stripe_customer_id
        });
    } catch (error) {
        console.error('Error fetching subscription:', error);
        res.status(500).json({ error: 'Failed to fetch subscription' });
    }
});

// DEPRECATED (410 Gone) — S-2 / R-1. This accepted a raw client priceId (no plan↔price binding) and
// duplicated billing logic that had already drifted. Zero frontend callers — the app uses the
// authenticated POST /api/payments/checkout, which resolves the Price server-side from the plan.
router.post('/create-checkout-session', (req, res) => res.status(410).json({
    error: 'Gone',
    message: 'Deprecated. Use POST /api/payments/checkout (authenticated) — the plan is resolved server-side.',
}));

// POST /api/auth/create-portal-session - Create Stripe billing portal session
router.post('/create-portal-session', supabaseAuth, async (req, res) => {
    try {
        const { returnUrl } = req.body;

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', req.user.id)
            .single();

        if (!profile?.stripe_customer_id) {
            return res.status(400).json({ error: 'No subscription found' });
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: returnUrl || `${process.env.FRONTEND_URL}/settings`
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating portal session:', error);
        res.status(500).json({ error: 'Failed to create portal session', message: error.message });
    }
});

// Extra limiter for the public provider precheck, on top of the mount-level authLimiter
// (20/15min/IP in app.js): 10/min/IP keeps scripted email enumeration slow.
const precheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});

// Find the Supabase auth user (with identities) for an email. profiles.email is indexed and
// profiles.id IS the auth user id, so resolve there first, then fetch the auth record. Fallback
// for an auth user with no profile row yet (mid-provisioning): paged listUsers, mirroring
// ensureAuthUser's recovery path in services/userProvisioning.js (supabase-js 2.89 has no
// admin getUserByEmail).
async function findAuthUserByEmail(email) {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();
    if (profile?.id) {
        const { data } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        if (data?.user) return data.user;
    }
    let page = 1;
    while (page <= 10) {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
        if (!listData?.users?.length) return null;
        const found = listData.users.find((u) => (u.email || '').toLowerCase() === email);
        if (found) return found;
        if (listData.users.length < 100) return null;
        page++;
    }
    return null;
}

// POST /api/auth/provider-precheck - which sign-in providers an email already has.
// The signup/sign-in UI asks BEFORE offering "continue with Google" vs password, so a
// password-account holder isn't silently auto-linked onto Google (see /unlink-mislinked below).
// DELIBERATE TRADEOFF: this reveals whether an email has an account (enumeration). Accepted for
// signup UX; mitigated by rate limiting (precheckLimiter above + the mount-level authLimiter),
// and the response carries nothing beyond { exists, providers }.
router.post('/provider-precheck', precheckLimiter, async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }
    try {
        const user = await findAuthUserByEmail(email);
        if (!user) return res.json({ exists: false, providers: [] });
        const providers = [...new Set((user.identities || []).map((i) => i.provider).filter(Boolean))];
        res.json({ exists: true, providers });
    } catch (err) {
        // PII-free: never log the address being checked.
        console.error('provider-precheck failed:', err.message);
        res.status(500).json({ error: 'Failed to check providers' });
    }
});

// POST /api/auth/unlink-mislinked - undo Supabase's automatic Google-onto-password linking.
// Supabase auto-links a Google sign-in onto an EXISTING same-email password account, silently
// adding an OAuth door the account owner never chose. Detection is deliberately narrow and acts
// ONLY on the caller: their auth user must hold BOTH an 'email' and a 'google' identity, the
// google identity must have been created within the last 15 minutes (the just-happened
// auto-link), and the account itself must be older than 15 minutes (a genuine pre-existing
// password account, not a fresh Google signup). Anything else is a no-op ({ unlinked: false }).
const MISLINK_WINDOW_MS = 15 * 60 * 1000;
router.post('/unlink-mislinked', supabaseAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
        if (error || !data?.user) return res.status(404).json({ error: 'User not found' });
        const user = data.user;
        const identities = user.identities || [];
        const emailIdentity = identities.find((i) => i.provider === 'email');
        const googleIdentity = identities.find((i) => i.provider === 'google');
        // Missing created_at fails closed (Infinity / 0 both make mislinked false below).
        const googleAgeMs = googleIdentity?.created_at
            ? Date.now() - new Date(googleIdentity.created_at).getTime() : Infinity;
        const accountAgeMs = user.created_at ? Date.now() - new Date(user.created_at).getTime() : 0;
        const mislinked = !!(emailIdentity && googleIdentity)
            && googleAgeMs <= MISLINK_WINDOW_MS
            && accountAgeMs > MISLINK_WINDOW_MS;
        if (!mislinked) return res.json({ unlinked: false });
        // supabase-js 2.89.0 exposes no admin deleteIdentity (only the user-scoped
        // GoTrueClient.unlinkIdentity, which requires manual linking to be enabled), so call the
        // GoTrue admin endpoint directly with the service key.
        const identityId = googleIdentity.identity_id || googleIdentity.id;
        const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!base || !serviceKey) return res.status(503).json({ error: 'Auth admin is not configured' });
        const resp = await fetch(`${base}/auth/v1/admin/users/${user.id}/identities/${identityId}`, {
            method: 'DELETE',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        if (!resp.ok) {
            // PII-free: caller id + status only.
            console.error('unlink-mislinked: identity delete failed:', resp.status, req.user.id);
            return res.status(502).json({ error: 'Failed to unlink identity' });
        }
        res.json({ unlinked: true });
    } catch (err) {
        console.error('unlink-mislinked failed:', err.message);
        res.status(500).json({ error: 'Failed to unlink identity' });
    }
});

module.exports = router;
