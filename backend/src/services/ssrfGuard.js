/**
 * ssrfGuard — block Server-Side Request Forgery via user-supplied webhook URLs.
 * ----------------------------------------------------------------------------
 * Outbound webhook endpoints are caller-supplied URLs. Without validation a caller could point
 * one at an internal-only address (cloud metadata 169.254.169.254, localhost, RFC1918, ULA, …)
 * and use our server as a proxy to read internal services — a classic webhook SSRF. This module
 * is the authoritative check: it parses the URL, requires https, and resolves the hostname,
 * rejecting if ANY resolved address falls in a blocked range. It is called BOTH at registration
 * (fast feedback) and at delivery time in webhookService (authoritative — defends against a URL
 * that was public at registration but later resolves to a private address, i.e. DNS rebinding).
 */
const dns = require('node:dns').promises;
const net = require('node:net');

class SsrfError extends Error {
  constructor(message) { super(message); this.name = 'SsrfError'; }
}

// Hostnames we never resolve/contact regardless of DNS.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',     // GCP metadata
  'metadata',
]);

function v4Blocked(ip) {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → block
  if (o[0] === 0) return true;                                   // 0.0.0.0/8 "this host"
  if (o[0] === 10) return true;                                  // 10.0.0.0/8 private
  if (o[0] === 127) return true;                                 // 127.0.0.0/8 loopback
  if (o[0] === 169 && o[1] === 254) return true;                 // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;     // 172.16.0.0/12 private
  if (o[0] === 192 && o[1] === 168) return true;                 // 192.168.0.0/16 private
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;    // 100.64.0.0/10 CGNAT
  if (o[0] === 192 && o[1] === 0 && o[2] === 0) return true;     // 192.0.0.0/24 IETF
  if (o[0] >= 224) return true;                                  // 224.0.0.0/4 multicast + 240/4 reserved
  return false;
}

function v6Blocked(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;            // loopback / unspecified
  const mapped = /(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower); // IPv4-mapped
  if (mapped) return v4Blocked(mapped[1]);
  const head = parseInt(lower.split(':')[0] || '', 16);
  if (Number.isNaN(head)) return true;                          // compressed/odd form → block conservatively
  if (head >= 0xfe80 && head <= 0xfebf) return true;            // fe80::/10 link-local
  if (head >= 0xfc00 && head <= 0xfdff) return true;            // fc00::/7 unique-local
  return false;
}

/** True if an IP literal is in a blocked (private / loopback / link-local / reserved) range. */
function isBlockedIp(ip) {
  const t = net.isIP(ip);
  if (t === 4) return v4Blocked(ip);
  if (t === 6) return v6Blocked(ip);
  return true; // not a valid IP → block
}

/**
 * assertPublicHttpsUrl(urlString) → URL  (throws SsrfError when unsafe)
 * Requires https, a non-empty non-blocked hostname, and that the host resolves ONLY to public
 * addresses. Literal-IP hosts are checked directly; named hosts are resolved via dns.lookup(all).
 */
async function assertPublicHttpsUrl(urlString) {
  let parsed;
  try { parsed = new URL(urlString); } catch { throw new SsrfError('Invalid URL.'); }
  if (parsed.protocol !== 'https:') throw new SsrfError('Only https:// URLs are allowed.');

  const host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host) throw new SsrfError('URL has no host.');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new SsrfError('URL host is not allowed.');
  }

  // Literal IP host → check directly (no DNS).
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError('URL resolves to a private or reserved address.');
    return parsed;
  }

  // Named host → resolve and check EVERY address (an attacker can return multiple A/AAAA records).
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw new SsrfError('Could not resolve URL host.'); }
  if (!addrs || !addrs.length) throw new SsrfError('URL host has no DNS records.');
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfError('URL resolves to a private or reserved address.');
  }
  return parsed;
}

module.exports = { assertPublicHttpsUrl, isBlockedIp, SsrfError };
