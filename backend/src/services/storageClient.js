/**
 * storageClient — thin Azure Blob Storage client (ADR-002).
 *
 * Uses the Blob REST API with SharedKey auth (Node crypto + global fetch) instead of
 * @azure/storage-blob: adding a dependency means touching package-lock.json, which has twice
 * broken Render's `npm ci` when regenerated on macOS (see changelog 2026-07-02), and we only
 * need four operations. This is also the thin storage seam ADR-001 reserved, so verified-session
 * media (Phase 3) can reuse it and the vendor can be swapped behind this interface.
 *
 * Config: AZURE_STORAGE_CONNECTION_STRING (standard "AccountName=...;AccountKey=..." form).
 * Unset → isConfigured() is false and every operation throws; callers gate on isConfigured().
 */
const crypto = require('crypto');

const API_VERSION = '2021-08-06';

function parseConnectionString() {
  const raw = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
  if (!raw.trim()) return null;
  const parts = {};
  for (const seg of raw.split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  const account = parts.AccountName;
  const key = parts.AccountKey;
  if (!account || !key) return null;
  const endpoint =
    parts.BlobEndpoint ||
    `${parts.DefaultEndpointsProtocol || 'https'}://${account}.blob.${parts.EndpointSuffix || 'core.windows.net'}`;
  return { account, key, endpoint: endpoint.replace(/\/$/, '') };
}

function isConfigured() {
  return parseConnectionString() !== null;
}

// SharedKey canonicalization (services version 2015-02-21+). Exported for tests.
function stringToSign({ method, account, path, query = {}, headers, contentLength }) {
  const msHeaders = Object.keys(headers)
    .filter((h) => h.toLowerCase().startsWith('x-ms-'))
    .map((h) => `${h.toLowerCase()}:${String(headers[h]).trim()}`)
    .sort()
    .join('\n');
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `\n${k.toLowerCase()}:${query[k]}`)
    .join('');
  const canonicalResource = `/${account}${path}${canonicalQuery}`;
  return [
    method,
    '', // Content-Encoding
    '', // Content-Language
    contentLength > 0 ? String(contentLength) : '', // Content-Length ('' when 0)
    '', // Content-MD5
    headers['Content-Type'] || '', // Content-Type
    '', // Date (x-ms-date is used instead)
    '', // If-Modified-Since
    '', // If-Match
    '', // If-None-Match
    '', // If-Unmodified-Since
    '', // Range
    msHeaders,
    canonicalResource,
  ].join('\n');
}

function sign(key, sts) {
  return crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(sts, 'utf8').digest('base64');
}

async function request(method, path, { query = {}, body = null, contentType = null } = {}) {
  const cfg = parseConnectionString();
  if (!cfg) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured');
  const buf = body === null ? null : Buffer.from(body, 'utf8');
  const headers = {
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': API_VERSION,
  };
  if (method === 'PUT' && !('restype' in query)) headers['x-ms-blob-type'] = 'BlockBlob';
  if (contentType) headers['Content-Type'] = contentType;
  const sts = stringToSign({
    method,
    account: cfg.account,
    path,
    query,
    headers,
    contentLength: buf ? buf.length : 0,
  });
  headers.Authorization = `SharedKey ${cfg.account}:${sign(cfg.key, sts)}`;
  const qs = Object.keys(query).length
    ? '?' + Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : '';
  // 30s hard timeout: fetch has none by default, and one stalled connection would otherwise
  // freeze the whole sweep loop silently (no catch fires on an await that never settles).
  const res = await fetch(cfg.endpoint + path + qs, {
    method,
    headers,
    body: buf ?? undefined,
    signal: AbortSignal.timeout(30000),
  });
  return res;
}

// Blob names can contain '/' (virtual folders) — encode each segment, keep the separators.
const blobPath = (container, name) =>
  `/${container}/${name.split('/').map(encodeURIComponent).join('/')}`;

// Create-if-missing; 409 AlreadyExists is success.
async function ensureContainer(container) {
  const res = await request('PUT', `/${container}`, { query: { restype: 'container' } });
  if (!res.ok && res.status !== 409) {
    throw new Error(`ensureContainer ${container} failed: ${res.status} ${await res.text()}`);
  }
}

async function putJson(container, name, value) {
  const res = await request('PUT', blobPath(container, name), {
    body: JSON.stringify(value, null, 1),
    contentType: 'application/json',
  });
  if (!res.ok) throw new Error(`putJson ${name} failed: ${res.status} ${await res.text()}`);
}

// Idempotent: deleting a blob that is already gone is success.
async function deleteBlob(container, name) {
  const res = await request('DELETE', blobPath(container, name));
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteBlob ${name} failed: ${res.status} ${await res.text()}`);
  }
}

module.exports = { isConfigured, ensureContainer, putJson, deleteBlob, stringToSign, sign, parseConnectionString };
