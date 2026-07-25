#!/usr/bin/env node
/**
 * One-time, idempotent Stripe setup for the self-serve subscription tiers.
 *
 * Creates (or finds — by a stable Price `lookup_key`) the recurring monthly Stripe
 * Products + Prices for Startup ($99/mo) and Growth ($399/mo), then prints the Price
 * ids so they can be pinned via env (STRIPE_PRICE_STARTUP / STRIPE_PRICE_GROWTH).
 *
 * Idempotent: re-running finds the existing Price by lookup_key instead of creating a
 * duplicate. The plan catalog (amounts, lookup_keys, names) is the single source of
 * truth in src/config/stripePlans.js — this script never hardcodes those.
 *
 * Secrets: STRIPE_SECRET_KEY is read from backend/.env via dotenv (same as seedDemo.js).
 * Nothing is committed.
 *
 *   node scripts/setupStripeProducts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PLANS, PLAN_KEYS } = require('../src/config/stripePlans');

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('Need STRIPE_SECRET_KEY in backend/.env (a sk_test_… key for TEST mode).');
  process.exit(1);
}
const stripe = require('stripe')(KEY);

/**
 * Find an active Price by its lookup_key, or create it (plus its Product) if absent.
 * Returns the resolved Stripe Price object.
 */
async function ensurePlanPrice(def) {
  // 1. Look the Price up by its stable lookup_key — this is what makes the script idempotent.
  const existing = await stripe.prices.list({ lookup_keys: [def.lookupKey], active: true, limit: 1 });
  if (existing.data.length > 0) {
    const price = existing.data[0];
    console.log(`✓ ${def.name}: found existing price ${price.id} (lookup_key=${def.lookupKey})`);
    return price;
  }

  // 2. No price yet — create a Product, then the recurring monthly Price bound to that
  //    lookup_key. (A lookup_key is unique per active price, so the create is safe.)
  const product = await stripe.products.create({
    name: def.name,
    description: def.description,
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: def.amount,
    currency: def.currency,
    recurring: { interval: def.interval },
    lookup_key: def.lookupKey,
    nickname: `${def.name} (monthly)`,
  });

  console.log(`+ ${def.name}: created product ${product.id} + price ${price.id} (lookup_key=${def.lookupKey})`);
  return price;
}

async function main() {
  const mode = KEY.startsWith('sk_test') ? 'TEST' : KEY.startsWith('sk_live') ? 'LIVE' : 'UNKNOWN';
  console.log(`Setting up Stripe products/prices in ${mode} mode...\n`);

  const results = {};
  for (const key of PLAN_KEYS) {
    const price = await ensurePlanPrice(PLANS[key]);
    results[key] = price.id;
  }

  console.log('\n=== Price IDs (pin these in backend/.env) ===');
  console.log(`STRIPE_PRICE_STARTUP=${results.startup}`);
  console.log(`STRIPE_PRICE_GROWTH=${results.growth}`);
  console.log('\nResolution also works without env pins (by lookup_key), but pinning avoids a Stripe API round-trip per checkout.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('STRIPE SETUP FAILED:', e.message); process.exit(1); });
