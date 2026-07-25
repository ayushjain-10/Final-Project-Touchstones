// Temporal Cloud client (API-key auth over TLS). Returns null when unconfigured so
// callers degrade gracefully (Temporal is an optional durability layer, never a hard
// dependency of the request path). Reused by scripts/temporal-verify.mjs and, next, the
// durable scoring worker + workflow starters. See Linear AUT-6.
const { Client, Connection } = require('@temporalio/client');

let cached = null;

// Master flag: the durable-workflow layer stays OFF until the worker + pipeline land.
function temporalEnabled() {
  return process.env.TEMPORAL_ENABLED === 'true';
}

// Lazily connect once and cache. Null when any of endpoint/namespace/key is missing.
async function getTemporalClient() {
  if (cached) return cached;
  const { TEMPORAL_ENDPOINT, TEMPORAL_NAMESPACE, TEMPORAL_API_KEY } = process.env;
  if (!TEMPORAL_ENDPOINT || !TEMPORAL_NAMESPACE || !TEMPORAL_API_KEY) return null;
  const connection = await Connection.connect({
    address: TEMPORAL_ENDPOINT,
    tls: true,
    apiKey: TEMPORAL_API_KEY,
  });
  cached = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  return cached;
}

module.exports = { getTemporalClient, temporalEnabled };
