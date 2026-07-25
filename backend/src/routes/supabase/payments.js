/**
 * Payments Routes - Supabase Version
 * Migrated from MongoDB/Mongoose to Supabase/PostgreSQL
 * Stripe payment processing and subscription management
 */

const express = require('express');
const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { getPlan, resolvePlanPriceFromEnv } = require('../../config/stripePlans');
const planLimits = require('../../services/planLimits');

// Helper to validate UUID format
const isValidUUID = (id) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

/**
 * Resolve a self-serve plan name ('startup' | 'growth') to a concrete Stripe Price id.
 *
 * Prefers an env-pinned id (STRIPE_PRICE_STARTUP/STRIPE_PRICE_GROWTH, or legacy
 * STRIPE_GROWTH_PRICE_ID) — resolved purely, no network. Falls back to looking the
 * Price up by its stable `lookup_key` via the Stripe API (the same lookup_key the
 * setup script writes). Returns null if the plan isn't checkout-able or no Price exists.
 */
async function resolvePlanPriceId(plan) {
    const def = getPlan(plan);
    if (!def) return null;

    const pinned = resolvePlanPriceFromEnv(plan);
    if (pinned) return pinned;

    // No env pin — ask Stripe for the active Price carrying this plan's lookup_key.
    const list = await stripe.prices.list({ lookup_keys: [def.lookupKey], active: true, limit: 1 });
    return list.data.length > 0 ? list.data[0].id : null;
}

/**
 * @route   POST /api/payments/create-checkout-session
 * @desc    Create a Stripe checkout session
 * @access  Public
 */
// DEPRECATED (410 Gone) — S-2 plan-escalation fix. This PUBLIC endpoint accepted a client-supplied
// priceId + plan + userId and stamped metadata.plan with no auth and no plan↔price binding, letting a
// caller pay the cheapest price yet self-grant 'growth'. It has ZERO frontend callers (the app uses
// the authenticated POST /api/payments/checkout, which resolves the Price server-side from the plan
// and binds client_reference_id to the signed-in user). 410'd like /register and /login.
router.post('/create-checkout-session', (req, res) => res.status(410).json({
    error: 'Gone',
    message: 'Deprecated. Use POST /api/payments/checkout (authenticated) — the plan is resolved server-side.',
}));

/**
 * @route   POST /api/payments/checkout
 * @desc    Create a Stripe Checkout Session for a signed-in user subscribing to a tier.
 *          Plan-based (not raw priceId): the frontend sends only { plan }, and the
 *          Price is resolved server-side by env-pin or lookup_key. client_reference_id
 *          + customer_email come from the verified Supabase user, so the completed
 *          session can be attributed to a real account via the webhook.
 * @access  Private (supabaseAuth)
 */
router.post('/checkout', supabaseAuth, async (req, res) => {
    try {
        // Graceful 503 when Stripe isn't configured (no secret key) — the frontend
        // surfaces this as "billing unavailable" rather than a hard 500.
        if (!stripe) {
            return res.status(503).json({ error: 'Billing is not available in this deployment.' });
        }

        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
            console.error('[Payment] CRITICAL: FRONTEND_URL is not set');
            return res.status(503).json({ error: 'Billing is not available in this deployment.' });
        }

        const { plan } = req.body || {};
        const def = getPlan(plan);
        if (!def) {
            return res.status(400).json({ error: 'A valid plan is required (startup or growth).' });
        }

        const priceId = await resolvePlanPriceId(plan);
        if (!priceId) {
            console.error(`[Payment] No Stripe Price configured for plan "${plan}" (run scripts/setupStripeProducts.js or set STRIPE_PRICE_${plan.toUpperCase()}).`);
            return res.status(503).json({ error: 'Billing is not available in this deployment.' });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            customer_email: req.user.email,
            client_reference_id: req.user.id,
            success_url: `${frontendUrl}/app?checkout=success`,
            cancel_url: `${frontendUrl}/pricing?checkout=cancel`,
            // Mirror identity into metadata so the webhook can attribute the session even
            // if client_reference_id is ever dropped from a payload.
            metadata: { plan, userId: req.user.id },
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route   POST /api/payments/portal
 * @desc    Create a Stripe Billing Portal session for the signed-in account so they can manage /
 *          cancel their subscription from the workspace. Returns { url } to redirect to.
 * @access  Private (supabaseAuth)
 */
router.post('/portal', supabaseAuth, async (req, res) => {
    try {
        if (!stripe) {
            return res.status(503).json({ error: 'Billing is not available in this deployment.' });
        }
        const { data: user } = await supabaseAdmin
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', req.user.id)
            .single();
        if (!user || !user.stripe_customer_id) {
            // No Stripe customer yet (never subscribed) → 400 with a clear message; the frontend
            // shows "Subscribe first to manage billing" rather than a generic error.
            return res.status(400).json({ error: 'No billing account yet — subscribe to a plan first.' });
        }
        const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: frontendUrl ? `${frontendUrl}/app` : undefined,
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating billing portal session:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route   POST /api/payments/cancel-subscription
 * @desc    Cancel user's subscription
 * @access  Private
 */
router.post('/cancel-subscription', supabaseAuth, async (req, res) => {
    try {
        // Same guard as /checkout and /portal — without it stripe.* calls below throw a 500
        // when billing isn't configured in this deployment.
        if (!stripe) {
            return res.status(503).json({ error: 'Billing is not available in this deployment.' });
        }
        const { data: user, error: fetchError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (fetchError || !user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.stripe_subscription_id) {
            return res.status(400).json({ message: 'No active subscription found' });
        }

        const subscriptionId = user.stripe_subscription_id;

        // Cancel at period end
        const subscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
        });

        // Safe date handling
        let currentPeriodEnd;
        if (subscription.current_period_end) {
            currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        } else {
            // Fallback: 30 days from now
            const date = new Date();
            date.setDate(date.getDate() + 30);
            currentPeriodEnd = date.toISOString();
        }

        // Update the flat subscription columns (the schema's source of truth).
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({
                subscription_status: 'canceled',
                subscription_plan: 'free',
                current_period_end: currentPeriodEnd,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.user.id);

        if (updateError) throw updateError;

        res.json({
            message: 'Subscription will be canceled at the end of the billing period.',
            currentPeriodEnd: currentPeriodEnd
        });

    } catch (error) {
        console.error('Error canceling subscription:', error);
        res.status(500).json({ message: 'Server error during cancellation' });
    }
});

/**
 * @route   POST /api/payments/verify-session
 * @desc    Verify Stripe checkout session and update user subscription
 * @access  Public
 */
// DEPRECATED (410 Gone) — S-2/S-6 plan-escalation fix. This PUBLIC endpoint set subscription_plan
// from client-controlled session.metadata.plan (default 'growth') on any paid session, with no
// ownership binding — a self-grant / replay hole. Zero frontend callers; the signed Stripe webhook
// (webhooks.js) is the authoritative plan-setter, attributing via client_reference_id. 410'd.
router.post('/verify-session', (req, res) => res.status(410).json({
    error: 'Gone',
    message: 'Deprecated. Subscription state is applied server-side by the signed Stripe webhook.',
}));

/**
 * @route   GET /api/payments/subscription-status
 * @desc    Get current user's subscription status
 * @access  Private
 */
router.get('/subscription-status', supabaseAuth, async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('profiles')
            .select('subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end')
            .eq('id', req.user.id)
            .single();

        if (error || !user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Assemble the subscription object from the flat columns (frontend contract).
        const subscription = {
            plan: user.subscription_plan || 'free',
            status: user.subscription_status || 'inactive',
            stripe_customer_id: user.stripe_customer_id || null,
            stripe_subscription_id: user.stripe_subscription_id || null,
            current_period_end: user.current_period_end || null,
        };

        res.json({
            success: true,
            subscription: subscription
        });
    } catch (error) {
        console.error('Error fetching subscription status:', error);
        res.status(500).json({ message: 'Server error fetching subscription status' });
    }
});

/**
 * @route   GET /api/payments/usage
 * @desc    Current verified-screen usage for the signed-in recruiter this calendar
 *          month: { plan, limit, used, remaining }. Drives the in-app usage meter
 *          and the "upgrade" nudge. limit/remaining are null for the unlimited
 *          (growth) tier since JSON can't represent Infinity.
 * @access  Private (supabaseAuth)
 */
router.get('/usage', supabaseAuth, async (req, res) => {
    try {
        const { plan, limit, used, remaining } = await planLimits.getScreenUsage({ ownerId: req.user.id });
        res.json({
            plan,
            limit: limit === Infinity ? null : limit,
            used,
            remaining: remaining === Infinity ? null : remaining,
        });
    } catch (error) {
        console.error('Error fetching usage:', error);
        res.status(500).json({ error: 'Server error fetching usage' });
    }
});

module.exports = router;
