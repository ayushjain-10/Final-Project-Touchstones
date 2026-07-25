/**
 * @touchstones/verify — the official client for the Touchstones Verify API.
 * ------------------------------------------------------------------------
 * Zero dependencies. Uses the global `fetch` (Node >= 18, Deno, Bun, browsers).
 * The webhook-signature verifier lives in a separate entry (`@touchstones/verify/webhooks`)
 * so this client stays free of any Node-only crypto import and bundles cleanly for the browser.
 */

const DEFAULT_BASE_URL = 'https://api.touchstones.ai/v1';

/** Error thrown for any non-2xx API response. Carries the parsed error envelope. */
export class TouchstonesError extends Error {
  constructor(message, { status, type, param, body } = {}) {
    super(message);
    this.name = 'TouchstonesError';
    this.status = status;
    this.type = type;
    this.param = param;
    this.body = body;
  }
}

export class Touchstones {
  /**
   * @param {string} apiKey - a `tsk_live_…` or `tsk_test_…` key.
   * @param {{ baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} [opts]
   */
  constructor(apiKey, opts = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new TouchstonesError('An API key is required.', { status: 0, type: 'config_error' });
    }
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this._fetch = opts.fetch || globalThis.fetch;
    this.timeoutMs = opts.timeoutMs || 30000;
    if (typeof this._fetch !== 'function') {
      throw new TouchstonesError('No fetch implementation found. Pass { fetch } or run on Node >= 18.', {
        status: 0, type: 'config_error',
      });
    }

    // Namespaced resource methods.
    this.verifications = {
      /**
       * Create a verification.
       * @param {object} body - { candidate_ref, rubric, work, events?, ai_transcript?, ... }
       * @param {{ idempotencyKey?: string }} [options]
       */
      create: (body, options = {}) =>
        this._request('POST', '/verifications', { body, idempotencyKey: options.idempotencyKey }),
      /** Retrieve a verification by id. */
      retrieve: (id) => this._request('GET', `/verifications/${encodeURIComponent(id)}`),
      /** Get the portable report URL for a verification. */
      report: (id) => this._request('GET', `/verifications/${encodeURIComponent(id)}/report`),
      /** Download the immutable audit record for a verification. */
      audit: (id) => this._request('GET', `/verifications/${encodeURIComponent(id)}/audit`),
    };
  }

  async _request(method, path, { body, idempotencyKey } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this._fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err && err.name === 'AbortError';
      throw new TouchstonesError(
        aborted ? `Request timed out after ${this.timeoutMs}ms.` : `Network error: ${err && err.message}`,
        { status: 0, type: aborted ? 'timeout' : 'network_error' },
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }

    if (!res.ok) {
      const env = data && typeof data === 'object' ? data.error : null;
      throw new TouchstonesError(
        (env && env.message) || (typeof data === 'string' && data) || `Request failed (${res.status}).`,
        { status: res.status, type: env && env.type, param: env && env.param, body: data },
      );
    }
    return data;
  }
}

export default Touchstones;
