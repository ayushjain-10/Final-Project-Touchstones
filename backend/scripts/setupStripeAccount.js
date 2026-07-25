#!/usr/bin/env node
/**
 * One-time, idempotent Stripe ACCOUNT wiring for a (new) Stripe account: the two
 * pieces setupStripeProducts.js cannot do because they are account-level config,
 * not catalog: the signed webhook endpoint and the Billing Portal configuration.
 *
 * What it ensures (find-or-create, safe to re-run):
 *   1. A webhook endpoint at <base-url>/api/webhooks/stripe subscribed to exactly
 *      the events routes/supabase/webhooks.js handles. On CREATE it prints the
 *      signing secret (Stripe only reveals it once) so it can be set as
 *      STRIPE_WEBHOOK_SECRET on the backend host. If an endpoint for that URL
 *      already exists it syncs the event list and reminds where the secret lives.
 *   2. A Billing Portal configuration (invoice history, payment-method update,
 *      cancel at period end), so POST /api/payments/portal stops 400ing on a
 *      fresh account that has never saved portal settings in the dashboard.
 *
 * Secrets: STRIPE_SECRET_KEY is read from backend/.env via dotenv (same as
 * setupStripeProducts.js). Nothing is committed, nothing is printed except the
 * one-time webhook secret on first create.
 *
 *   node scripts/setupStripeAccount.js https://touchstone-api-dev.onrender.com
 *   node scripts/setupStripeAccount.js https://api.touchstones.ai
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('Need STRIPE_SECRET_KEY in backend/.env (sk_test_... for TEST mode, sk_live_... for LIVE).');
  process.exit(1);
}
const stripe = require('stripe')(KEY);

// Must match the events routes/supabase/webhooks.js actually handles.
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
];

async function ensureWebhookEndpoint(baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/webhooks/stripe`;
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = existing.data.find((e) => e.url === url);

  if (match) {
    // Keep the event list in sync; the signing secret is only shown at create time.
    await stripe.webhookEndpoints.update(match.id, { enabled_events: WEBHOOK_EVENTS });
    console.log(`✓ webhook endpoint exists: ${match.id} → ${url} (events synced)`);
    console.log('  (signing secret was shown when it was created; rotate via dashboard if lost)');
    return match;
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: 'Touchstones subscription lifecycle (see routes/supabase/webhooks.js)',
  });
  console.log(`+ created webhook endpoint ${created.id} → ${url}`);
  console.log('\n=== ONE-TIME signing secret (set on the backend host now) ===');
  console.log(`STRIPE_WEBHOOK_SECRET=${created.secret}`);
  return created;
}

async function ensurePortalConfiguration() {
  const existing = await stripe.billingPortal.configurations.list({ limit: 10 });
  if (existing.data.length > 0) {
    console.log(`✓ billing portal configuration exists: ${existing.data[0].id}`);
    return existing.data[0];
  }

  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: 'Touchstones subscription',
      privacy_policy_url: 'https://touchstones.ai/privacy',
      terms_of_service_url: 'https://touchstones.ai/terms',
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
  });
  console.log(`+ created billing portal configuration ${created.id}`);
  return created;
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
    console.error('Usage: node scripts/setupStripeAccount.js <https backend base url>');
    process.exit(1);
  }
  const mode = KEY.startsWith('sk_test') ? 'TEST' : KEY.startsWith('sk_live') ? 'LIVE' : 'UNKNOWN';
  console.log(`Wiring Stripe account config in ${mode} mode against ${baseUrl}...\n`);

  await ensureWebhookEndpoint(baseUrl);
  await ensurePortalConfiguration();

  console.log('\nDone. Remaining manual steps: activate the account (business details) for LIVE');
  console.log('checkout, and set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET on the backend host.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('STRIPE ACCOUNT SETUP FAILED:', e.message); process.exit(1); });
