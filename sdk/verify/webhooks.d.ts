// Type definitions for @touchstones/verify/webhooks

export interface WebhookVerifyOptions {
  /** Reject signatures whose timestamp is older than this many seconds. Default 300; 0 disables. */
  toleranceSeconds?: number;
}

export interface WebhookEvent {
  type: 'verification.completed' | 'verification.needs_review' | 'verification.failed' | 'webhook.test';
  created: number;
  data: { verification?: unknown; [k: string]: unknown };
}

/** Verify the `Touchstones-Signature` header against the raw request body. */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
  opts?: WebhookVerifyOptions,
): boolean;

/** Verify + parse the event in one step. Throws if the signature is invalid. */
export function constructEvent(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
  opts?: WebhookVerifyOptions,
): WebhookEvent;

declare const _default: {
  verifyWebhookSignature: typeof verifyWebhookSignature;
  constructEvent: typeof constructEvent;
};
export default _default;
