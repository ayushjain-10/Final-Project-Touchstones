/**
 * webhookService — OUTBOUND signed webhook delivery for the Verify API (Phase 3).
 * ------------------------------------------------------------------------------
 * When a /v1 verification reaches a terminal state the ingest path calls dispatch(), which
 * fans the event out to every ACTIVE endpoint the account registered for that event type.
 * Each delivery is recorded in webhook_deliveries (migration 042) and POSTed with a signed
 * body. Failures are retried with exponential backoff by an in-process drain worker.
 *
 * SIGNATURE (Stripe scheme, so receivers can reuse familiar verification code):
 *   header `Touchstones-Signature: t=<unixSeconds>,v1=<hmacSha256Hex>`
 *   where the HMAC is over the exact bytes `${t}.${rawBody}` keyed by the endpoint's
 *   signing_secret. The receiver recomputes it over the raw request body and compares
 *   constant-time, optionally rejecting stale timestamps.
 *
 * SECURITY: only registered, account-owned HTTPS endpoints are ever called (no caller-
 * supplied URL is honored without being persisted to webhook_endpoints first, under RLS).
 * Reads/writes here use the service-role client because this runs OUTSIDE any request's
 * Supabase session (the ingest path and the background worker), and every query is keyed by
 * account_id / endpoint_id we already resolved — never by caller input.
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { base62Encode } = require('./apiKeyService');
const { assertPublicHttpsUrl, SsrfError } = require('./ssrfGuard');
const { logger } = require('../config/observability');

const DELIVERY_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 10000);
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS || 5);
// Backoff schedule in milliseconds, indexed by attempts-already-made (0-based). After the
// Nth failure we schedule next_attempt_at = now + BACKOFF_MS[min(N-1, last)].
const BACKOFF_MS = [
  60 * 1000,        // ~1 min
  5 * 60 * 1000,    // 5 min
  30 * 60 * 1000,   // 30 min
  2 * 60 * 60 * 1000, // 2 h
  6 * 60 * 60 * 1000, // 6 h
];

/** Generate a per-endpoint signing secret: `whsec_<base62 of 32 CSPRNG bytes>`. */
function generateSigningSecret() {
  return `whsec_${base62Encode(crypto.randomBytes(32))}`;
}

/**
 * sign(secret, timestampSeconds, rawBody) → hex HMAC-SHA256 over `${t}.${rawBody}`.
 * Exposed for tests + receiver-side documentation parity.
 */
function sign(secret, timestampSeconds, rawBody) {
  return crypto.createHmac('sha256', String(secret))
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
}

/** Build the `Touchstones-Signature` header value for a raw body. */
function signatureHeader(secret, rawBody, timestampSeconds) {
  const t = timestampSeconds || Math.floor(Date.now() / 1000);
  return `t=${t},v1=${sign(secret, t, rawBody)}`;
}

/**
 * dispatch(accountId, eventType, verificationId, verification) — fan an event out to the
 * account's active, subscribed endpoints. NEVER throws (fire-and-forget from the request
 * path); failures are logged and recorded in webhook_deliveries. Returns the number of
 * endpoints the event was queued to (0 when none subscribed) — useful for tests.
 */
async function dispatch(accountId, eventType, verificationId, verification) {
  try {
    const { data: endpoints, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .select('id, url, signing_secret, enabled_events')
      .eq('account_id', accountId)
      .eq('status', 'active');
    if (error) {
      logger.warn({ err: error.message }, 'webhook dispatch lookup failed');
      return 0;
    }
    const targets = (endpoints || []).filter(
      (e) => Array.isArray(e.enabled_events) && e.enabled_events.includes(eventType),
    );
    if (!targets.length) return 0;

    const created = Math.floor(Date.now() / 1000);
    let queued = 0;
    for (const endpoint of targets) {
      // The signed body is identical to what we persist as the delivery payload.
      const envelope = {
        type: eventType,
        created,
        data: { verification },
      };
      // Create the delivery row FIRST (so its id is the stable event id in the envelope),
      // then attempt the POST. The row is the source of truth for retries.
      const { data: del, error: insErr } = await supabaseAdmin
        .from('webhook_deliveries')
        .insert({
          account_id: accountId,
          endpoint_id: endpoint.id,
          verification_id: verificationId || null,
          event_type: eventType,
          payload: envelope,
          status: 'pending',
        })
        .select('id')
        .single();
      if (insErr) {
        logger.warn({ err: insErr.message }, 'webhook delivery row insert failed');
        continue;
      }
      queued += 1;
      // Attempt without awaiting — never add latency to the caller. attemptDelivery is
      // fully self-contained (records its own outcome, never throws).
      attemptDelivery({ deliveryId: del.id, endpoint, envelope }).catch((e) =>
        logger.warn({ err: e && e.message }, 'webhook attemptDelivery threw'));
    }
    return queued;
  } catch (e) {
    logger.warn({ err: e && e.message }, 'webhook dispatch error');
    return 0;
  }
}

/**
 * attemptDelivery({ deliveryId, endpoint, envelope }) — POST the signed body once and record
 * the outcome on the webhook_deliveries row. On a non-2xx / transport error, either schedule
 * a retry (status 'failed' + next_attempt_at) or give up after MAX_ATTEMPTS. Never throws.
 */
async function attemptDelivery({ deliveryId, endpoint, envelope }) {
  // Read the current attempt count so a retry computes the right backoff.
  const { data: cur } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('attempts')
    .eq('id', deliveryId)
    .maybeSingle();
  const priorAttempts = (cur && cur.attempts) || 0;
  const attemptNo = priorAttempts + 1;

  const rawBody = JSON.stringify(envelope);
  const tsSeconds = Math.floor(Date.now() / 1000);
  const sig = signatureHeader(endpoint.signing_secret, rawBody, tsSeconds);

  let responseStatus = null;
  // SSRF: we NEVER store the receiver's response body. Even with the destination guard below,
  // storing the body would be an exfiltration channel if any guard gap (e.g. DNS rebinding) let a
  // request reach an internal address. We keep only the status code + a short error category.
  const responseBody = null;
  let errorMsg = null;
  let ok = false;

  // SSRF guard (authoritative): re-resolve + validate the destination at delivery time, so a URL
  // that was public at registration but now resolves to a private/metadata address is blocked.
  // This runs on EVERY attempt (first + retries + test). A blocked destination is a hard failure
  // with NO retry (re-resolving won't help). Mirrors how Stripe/GitHub defend webhook delivery.
  try {
    await assertPublicHttpsUrl(endpoint.url);
  } catch (e) {
    const reason = e instanceof SsrfError ? e.message : 'blocked destination';
    await supabaseAdmin.from('webhook_deliveries').update({
      status: 'failed',
      attempts: attemptNo,
      response_status: null,
      response_body: null,
      error: `blocked_destination: ${reason}`.slice(0, 300),
      next_attempt_at: null,   // do not retry a blocked destination
    }).eq('id', deliveryId);
    return { ok: false, attempts: attemptNo, blocked: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Touchstones-Signature': sig,
        'Touchstones-Event': envelope.type,
        'User-Agent': 'Touchstones-Webhooks/1.0',
      },
      body: rawBody,
      signal: controller.signal,
      // Do NOT follow redirects: a 3xx to an internal/metadata IP would bypass the destination
      // guard above. A redirect is treated as a (non-2xx) delivery failure instead.
      redirect: 'manual',
    });
    responseStatus = resp.status;
    // Intentionally do NOT read resp.text() — see the responseBody note above.
    ok = resp.status >= 200 && resp.status < 300;
    if (!ok) errorMsg = `non-2xx response: ${resp.status}`;
  } catch (e) {
    errorMsg = (e && e.name === 'AbortError') ? `timeout after ${DELIVERY_TIMEOUT_MS}ms` : String(e && e.message || e).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }

  if (ok) {
    await supabaseAdmin.from('webhook_deliveries').update({
      status: 'success',
      attempts: attemptNo,
      response_status: responseStatus,
      response_body: responseBody,
      error: null,
      next_attempt_at: null,
      delivered_at: new Date().toISOString(),
    }).eq('id', deliveryId);
    // Best-effort: bump the endpoint's last_delivery_at.
    supabaseAdmin.from('webhook_endpoints')
      .update({ last_delivery_at: new Date().toISOString() })
      .eq('id', endpoint.id)
      .then(() => {}).catch(() => {});
    return { ok: true, attempts: attemptNo };
  }

  // Failure: schedule a retry (until exhausted).
  const exhausted = attemptNo >= MAX_ATTEMPTS;
  const backoff = BACKOFF_MS[Math.min(attemptNo - 1, BACKOFF_MS.length - 1)];
  const nextAttemptAt = exhausted ? null : new Date(Date.now() + backoff).toISOString();
  await supabaseAdmin.from('webhook_deliveries').update({
    status: 'failed',
    attempts: attemptNo,
    response_status: responseStatus,
    response_body: responseBody,
    error: errorMsg,
    next_attempt_at: nextAttemptAt,
  }).eq('id', deliveryId);
  return { ok: false, attempts: attemptNo, exhausted };
}

/**
 * drainPending() — find failed deliveries that are due for another attempt and re-POST them.
 * Driven by the in-process worker (startWebhookWorker). Returns the count attempted.
 */
async function drainPending({ limit = 20 } = {}) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('id, endpoint_id, payload, attempts')
    .eq('status', 'failed')
    .lt('attempts', MAX_ATTEMPTS)
    .not('next_attempt_at', 'is', null)
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  if (error || !due || !due.length) return 0;

  let attempted = 0;
  for (const d of due) {
    // Re-resolve the endpoint (it may have been disabled/rotated since the first attempt).
    const { data: endpoint } = await supabaseAdmin
      .from('webhook_endpoints')
      .select('id, url, signing_secret, status')
      .eq('id', d.endpoint_id)
      .maybeSingle();
    if (!endpoint || endpoint.status !== 'active') {
      // Endpoint gone/disabled → stop retrying this delivery.
      await supabaseAdmin.from('webhook_deliveries')
        .update({ next_attempt_at: null, error: 'endpoint disabled or removed' })
        .eq('id', d.id);
      continue;
    }
    await attemptDelivery({ deliveryId: d.id, endpoint, envelope: d.payload });
    attempted += 1;
  }
  return attempted;
}

/**
 * sendTest(accountId, endpoint) — deliver a one-off `webhook.test` event to a single endpoint
 * (used by the console "Send test" button). Awaited so the console gets an immediate outcome.
 * Records a webhook_deliveries row exactly like a real delivery.
 */
async function sendTest(accountId, endpoint) {
  const created = Math.floor(Date.now() / 1000);
  const envelope = {
    type: 'webhook.test',
    created,
    data: { message: 'This is a test event from Touchstones. Your endpoint is reachable and the signature verified.' },
  };
  const { data: del, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .insert({
      account_id: accountId,
      endpoint_id: endpoint.id,
      event_type: 'webhook.test',
      payload: envelope,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  const result = await attemptDelivery({ deliveryId: del.id, endpoint, envelope });
  return { delivery_id: del.id, ...result };
}

let running = false;
function startWebhookWorker({ intervalMs = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 30000) } = {}) {
  if (running) return;
  running = true;
  const tick = async () => {
    if (!running) return;
    try { await drainPending(); }
    catch (e) { logger.warn({ err: e && e.message }, 'webhook worker tick error'); }
    if (running) setTimeout(tick, intervalMs).unref();
  };
  setTimeout(tick, intervalMs).unref();
  logger.info('webhook delivery worker started');
}
function stopWebhookWorker() { running = false; }

module.exports = {
  generateSigningSecret,
  sign,
  signatureHeader,
  dispatch,
  attemptDelivery,
  drainPending,
  sendTest,
  startWebhookWorker,
  stopWebhookWorker,
  MAX_ATTEMPTS,
};
