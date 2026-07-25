const jwt = require('jsonwebtoken');
const { supabase, supabaseAdmin, createAuthenticatedClient } = require('../config/supabase');

/**
 * Supabase Authentication Middleware
 * -----------------------------------
 * SECURITY INVARIANT (SYSTEM_DESIGN.md roadmap #1): `req.user.supabase` is ALWAYS
 * a token-scoped client (RLS-enforced). We NEVER hand the service-role client
 * (`supabaseAdmin`) to a user-supplied token.
 *
 * The previous version verified a *custom* JWT (signed with our own JWT_SECRET) as a
 * fallback and, on success, attached `supabaseAdmin` — meaning anyone who could forge
 * a token (trivial when JWT_SECRET fell back to the static 'dev-secret-key') operated
 * as service-role against EVERY tenant. That branch is removed. Google/password login
 * already mint real Supabase sessions (see routes/supabase/auth.js getSupabaseSession);
 * the access_token they return verifies here as a normal Supabase token.
 */
const supabaseAuth = async (req, res, next) => {
    try {
        // Mock DB mode — development/testing only. Auth is bypassed and the mock user
        // is given the admin client because there is no real RLS layer in mock mode.
        // Guarded so it can NEVER engage in production.
        if (process.env.USE_MOCK_DB === 'true' && process.env.NODE_ENV !== 'production') {
            let email = 'mock@touchstones.ai';
            let name = 'Mock User';
            let id = '00000000-0000-0000-0000-000000000001';
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    // decode (NOT verify) only to surface the test user's identity.
                    const decoded = jwt.decode(authHeader.split(' ')[1]);
                    if (decoded) {
                        email = decoded.email || email;
                        name = decoded.name || decoded.user_metadata?.name || name;
                        const tokenId = decoded.sub || decoded.id;
                        if (tokenId && uuidRegex.test(tokenId)) id = tokenId;
                    }
                } catch (e) { /* ignore decode errors in mock mode */ }
            }
            req.user = { id, _id: id, email, name, subscription_plan: 'growth', account_type: 'recruiter', recruiter_status: 'verified', supabase: supabaseAdmin };
            return next();
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'No authorization token provided',
                message: 'Please provide a valid authorization token'
            });
        }

        const token = authHeader.substring(7);

        // The ONLY accepted credential is a valid Supabase session token. No custom-JWT
        // branch, no service-role escalation. Failure here is a hard 401.
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                message: 'Authentication failed'
            });
        }

        const userId = user.id;
        const userEmail = user.email;

        // Cross-user profile lookup is a documented service-role use (SYSTEM_DESIGN §3):
        // the tenant gate is the token verification above; this read is keyed by the
        // verified user id only.
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = no rows
            console.error('Profile fetch error:', profileError.message);
        }

        req.user = {
            id: userId,
            _id: userId, // backward-compat with legacy code paths
            email: userEmail,
            ...profile,
            // ALWAYS token-scoped — RLS is the tenant boundary.
            supabase: createAuthenticatedClient(token)
        };
        req.supabaseToken = token;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            error: 'Authentication error',
            message: 'An error occurred during authentication'
        });
    }
};

/**
 * Optional authentication - doesn't fail if no token provided.
 */
const optionalSupabaseAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }
    return supabaseAuth(req, res, next);
};

/**
 * Authorization: require a VERIFIED RECRUITER (the candidate/recruiter role boundary).
 *
 * The app-layer gate for authoring/sending/scoring routes — a candidate or an unverified recruiter
 * is rejected 403. This is defense-in-depth alongside the RLS `WITH CHECK (... is_verified_recruiter())`
 * on work_samples (077): RLS blocks direct-PostgREST writes; this gives backend routes a clean,
 * explicit 403 (and gates non-work_samples mutations like invite/score). `req.user` is the full
 * profile row (supabaseAuth selects '*'), so account_type/recruiter_status are present.
 */
const requireRecruiter = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const verified = req.user.account_type === 'recruiter' && req.user.recruiter_status === 'verified';
    if (!verified) {
        return res.status(403).json({
            error: 'Recruiter access required',
            message: 'This action requires a verified recruiter account.',
            recruiter_status: req.user.recruiter_status || 'none',
        });
    }
    next();
};

/**
 * Subscription check middleware.
 */
const requireSubscription = (requiredPlans = ['growth', 'enterprise']) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const userPlan = req.user.subscription_plan || 'free';
        if (!requiredPlans.includes(userPlan)) {
            return res.status(403).json({
                error: 'Subscription required',
                message: `This feature requires a ${requiredPlans.join(' or ')} subscription`,
                currentPlan: userPlan
            });
        }
        next();
    };
};

module.exports = {
    supabaseAuth,
    optionalSupabaseAuth,
    requireRecruiter,
    requireSubscription
};
