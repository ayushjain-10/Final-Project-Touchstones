/**
 * Webhooks Routes - Supabase Version
 * Handle incoming webhooks from Calendly and other services
 * Note: This file is database-agnostic, uses external services only
 */

const express = require('express');
const router = express.Router();
const calendlyService = require('../../services/calendlyService');
const { supabaseAuth } = require('../../middleware/supabaseAuth');

// In-memory webhook storage (for mock/dev mode)
const webhookStore = [];

// ============================================
// USER WEBHOOK MANAGEMENT (CRUD)
// ============================================

// GET /api/webhooks - List user's webhooks
router.get('/', supabaseAuth, (req, res) => {
    res.json({ webhooks: [] });
});

// POST /api/webhooks - Create a webhook
router.post('/', supabaseAuth, (req, res) => {
    const { url, events, secret } = req.body;

    if (!url || !url.startsWith('https://')) {
        return res.status(400).json({ error: 'Valid HTTPS URL is required' });
    }
    if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'At least one event type is required' });
    }

    const webhook = {
        id: 'wh-' + Date.now(),
        userId: req.user.id,
        url,
        events,
        secret: secret || null,
        active: true,
        created_at: new Date().toISOString()
    };

    webhookStore.push(webhook);
    res.status(201).json(webhook);
});

// DELETE /api/webhooks/:id - Delete a webhook
router.delete('/:id', supabaseAuth, (req, res) => {
    const idx = webhookStore.findIndex(w => w.id === req.params.id && w.userId === req.user.id);
    if (idx === -1) {
        return res.status(404).json({ error: 'Webhook not found' });
    }
    webhookStore.splice(idx, 1);
    res.json({ message: 'Webhook deleted' });
});

// POST /api/webhooks/test - Test a webhook
router.post('/test', supabaseAuth, async (req, res) => {
    const { webhookId } = req.body;
    if (!webhookId) {
        return res.status(400).json({ error: 'webhookId is required' });
    }
    const webhook = webhookStore.find(w => w.id === webhookId && w.userId === req.user.id);
    if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
    }
    res.json({ success: true, message: 'Test payload sent', webhookId });
});

// ============================================
// EXTERNAL WEBHOOK HANDLERS
// ============================================

/**
 * @route   POST /api/webhooks/calendly
 * @desc    Handle Calendly webhook events
 * @access  Public (webhook endpoint)
 */
router.post('/calendly', express.json(), async (req, res) => {
    try {
        const signature = req.headers['calendly-webhook-signature'];
        const timestamp = req.headers['calendly-webhook-timestamp'];

        // Log incoming webhook
        console.log('Received Calendly webhook:', {
            event: req.body.event,
            timestamp: timestamp,
            hasSignature: !!signature
        });

        // Verify signature if configured
        if (process.env.CALENDLY_WEBHOOK_SIGNING_KEY) {
            const isValid = calendlyService.verifyWebhookSignature(req.body, signature, timestamp);
            if (!isValid) {
                console.error('Invalid Calendly webhook signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        // Process the event
        const event = req.body.event;
        const result = await calendlyService.processWebhookEvent(event, req.body);

        console.log('Calendly webhook processed:', result);

        // Respond to Calendly
        res.status(200).json({ received: true, ...result });
    } catch (error) {
        console.error('Calendly webhook error:', error);
        // Still return 200 to prevent Calendly from retrying
        res.status(200).json({ received: true, error: error.message });
    }
});

/**
 * @route   GET /api/webhooks/calendly/test
 * @desc    Test endpoint to verify webhook URL is accessible
 * @access  Public
 */
router.get('/calendly/test', (req, res) => {
    res.json({
        success: true,
        message: 'Calendly webhook endpoint is accessible',
        timestamp: new Date().toISOString()
    });
});

/**
 * @route   POST /api/webhooks/google
 * @desc    Handle Google Calendar push notifications
 * @access  Public (webhook endpoint)
 */
router.post('/google', express.json(), async (req, res) => {
    try {
        console.log('Received Google Calendar webhook:', {
            resourceState: req.headers['x-goog-resource-state'],
            channelId: req.headers['x-goog-channel-id'],
            resourceId: req.headers['x-goog-resource-id']
        });

        const resourceState = req.headers['x-goog-resource-state'];

        if (resourceState === 'sync') {
            // Initial sync notification - acknowledge it
            return res.status(200).send();
        }

        // Handle actual changes
        if (resourceState === 'exists' || resourceState === 'update') {
            // Event was created or updated
            console.log('Google Calendar event change detected');
            // Note: To get event details, you'd need to make an API call
            // using the resource ID and channel info
        }

        res.status(200).send();
    } catch (error) {
        console.error('Google webhook error:', error);
        res.status(200).send();
    }
});

/**
 * @route   POST /api/webhooks/stripe
 * @desc    Handle Stripe webhook events (subscription updates, payment failures, etc.)
 * @access  Public (webhook endpoint)
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { supabaseAdmin } = require('../../config/supabase');

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Signature verification is mandatory. Without the webhook secret we cannot
    // prove an event originated from Stripe, so refuse to process anything rather
    // than trusting an unsigned (potentially forged) payload.
    if (!webhookSecret) {
        console.error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not configured');
        return res.status(500).send('Webhook Error: server misconfigured');
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Stripe webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('Received Stripe webhook:', event.type);

    // Replay guard (SYSTEM_DESIGN #4): Stripe delivers at-least-once, and
    // customer.subscription.updated mutates billing state from a signed event with no
    // natural idempotency. Claim this event id in the unified processed_events table
    // BEFORE mutating anything; a duplicate delivery hits the primary-key conflict and
    // is acknowledged without re-processing. The claim is released (deleted) if
    // processing throws, so Stripe's retry can legitimately reprocess.
    let eventClaimed = false;
    {
        const { error: claimError } = await supabaseAdmin
            .from('processed_events')
            .insert({ event_key: event.id, source: 'stripe', result: { type: event.type } });
        if (claimError) {
            if (claimError.code === '23505') { // unique_violation → already processed
                console.log('Stripe event already processed (replay ignored):', event.id);
                return res.json({ received: true, duplicate: true });
            }
            // Dedup store unavailable (e.g. table not yet migrated): degrade to
            // best-effort and still process, rather than dropping a real event.
            console.warn('processed_events claim failed, proceeding without replay guard:', claimError.message);
        } else {
            eventClaimed = true;
        }
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                console.log('Checkout session completed:', session.id);

                // Attribute the session to a real account. /api/payments/checkout sets
                // client_reference_id = user id (and mirrors it into metadata.userId).
                const userId = session.client_reference_id || session.metadata?.userId;
                const plan = session.metadata?.plan || 'growth';

                if (!userId || userId === 'guest') {
                    console.log('Checkout completed with no attributable user (guest):', session.id);
                    break;
                }

                // Subscription mode sessions carry the new subscription id; fetch it for
                // status + current_period_end (the session itself doesn't carry them).
                let status = 'active';
                let currentPeriodEnd = null;
                if (session.subscription) {
                    try {
                        const subscription = await stripe.subscriptions.retrieve(session.subscription);
                        status = subscription.status || status;
                        if (subscription.current_period_end) {
                            currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
                        }
                    } catch (subErr) {
                        console.warn('Could not retrieve subscription for completed session:', subErr.message);
                    }
                }

                // Persist to the FLAT subscription columns the schema actually has
                // (subscription_plan/status + stripe ids + current_period_end). The prior code
                // wrote a nested `subscription` JSONB column that does not exist, so a paid
                // upgrade silently failed and planLimits kept the recruiter on 'free'.
                const { error: updateError } = await supabaseAdmin
                    .from('profiles')
                    .update({
                        subscription_plan: plan,
                        subscription_status: status,
                        stripe_customer_id: session.customer || null,
                        stripe_subscription_id: session.subscription || null,
                        current_period_end: currentPeriodEnd,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', userId);

                if (updateError) {
                    // B-2 (codebase-scan): do NOT swallow. Rethrow so the outer catch releases the
                    // processed_events claim and returns 500 — Stripe's at-least-once retry then
                    // reprocesses (e.g. once the B-1 'startup' enum value exists). Swallowing this and
                    // returning 200 permanently loses the paid upgrade (the claim is never released).
                    throw new Error(`profile subscription update failed for ${userId}: ${updateError.message}`);
                }
                console.log(`User ${userId} subscribed to ${plan} (${status})`);
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                console.log('Subscription updated:', subscription.id);

                // Find the user by the flat stripe_subscription_id column.
                const { data: users, error: findError } = await supabaseAdmin
                    .from('profiles')
                    .select('id')
                    .eq('stripe_subscription_id', subscription.id);

                if (findError || !users || users.length === 0) {
                    console.log('No user found for subscription:', subscription.id);
                    break;
                }

                const user = users[0];

                await supabaseAdmin
                    .from('profiles')
                    .update({
                        subscription_status: subscription.status,
                        current_period_end: subscription.current_period_end
                            ? new Date(subscription.current_period_end * 1000).toISOString()
                            : null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', user.id);

                console.log('User subscription updated:', user.id);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                console.log('Subscription deleted:', subscription.id);

                // Find and downgrade the user by the flat stripe_subscription_id column.
                const { data: users } = await supabaseAdmin
                    .from('profiles')
                    .select('id')
                    .eq('stripe_subscription_id', subscription.id);

                if (users && users.length > 0) {
                    const user = users[0];

                    await supabaseAdmin
                        .from('profiles')
                        .update({
                            subscription_plan: 'free',
                            subscription_status: 'canceled',
                            stripe_subscription_id: null,
                            current_period_end: null,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', user.id);

                    console.log('User downgraded to free:', user.id);
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                console.log('Payment failed for invoice:', invoice.id);

                // Find user by the flat stripe_customer_id column.
                const { data: users } = await supabaseAdmin
                    .from('profiles')
                    .select('id, email')
                    .eq('stripe_customer_id', invoice.customer);

                if (users && users.length > 0) {
                    const user = users[0];
                    console.log('Payment failed for user:', user.email);
                    // Could trigger email notification here
                }
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                console.log('Payment succeeded for invoice:', invoice.id);
                break;
            }

            default:
                console.log('Unhandled Stripe event type:', event.type);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Error processing Stripe webhook:', error);
        // Release the idempotency claim so Stripe's at-least-once retry can reprocess
        // this event (otherwise a transient failure would permanently swallow it).
        if (eventClaimed) {
            try {
                await supabaseAdmin.from('processed_events').delete().eq('event_key', event.id);
            } catch (releaseErr) {
                console.warn('Failed to release processed_events claim:', releaseErr.message);
            }
        }
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
