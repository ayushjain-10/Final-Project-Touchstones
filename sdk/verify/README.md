# @touchstones/verify

Official SDK for the [Touchstones Verify API](https://touchstones.ai/platforms) — embed
proof-of-human and defensible, audit-logged skill verification into your own assessment platform.

Zero dependencies. Works on Node ≥ 18, Deno, Bun, and modern browsers (via the global `fetch`).

```bash
npm install @touchstones/verify
```

## Quick start

```js
import { Touchstones } from '@touchstones/verify';

const ts = new Touchstones(process.env.TOUCHSTONES_API_KEY); // tsk_live_… or tsk_test_…

const verification = await ts.verifications.create({
  candidate_ref: 'cand-001',
  rubric: {
    criteria: [
      { id: 'correctness', requirement: 'Implements add(a, b) returning the sum', points_possible: 100 },
    ],
  },
  work: { response_code: 'module.exports = (a, b) => a + b;' },
  // Optional: integrity events + AI transcript strengthen the proof-of-human signal.
  events: [
    { type: 'session_submit', category: 'behavior', meta: { typed_chars: 200, paste_chars: 5, final_chars: 205 } },
  ],
});

console.log(verification.proof_of_human.state); // 'verified' | 'needs_review' | 'flagged'
console.log(verification.score?.score);         // 0–100
console.log(verification.report_url);           // shareable, publicly verifiable report
```

## Configuration

```js
const ts = new Touchstones('tsk_test_…', {
  baseUrl: 'https://api.touchstones.ai/v1', // default
  timeoutMs: 30000,                              // default
  // fetch: customFetch,                         // optional: inject a fetch implementation
});
```

Use a `tsk_test_…` key against the sandbox while you build (no live decisions), then switch to
`tsk_live_…`. Mint and rotate keys in your [developer console](https://touchstones.ai/app/developers).

## Methods

| Method | Description |
| --- | --- |
| `ts.verifications.create(body, { idempotencyKey? })` | Create a verification. |
| `ts.verifications.retrieve(id)` | Retrieve a verification by id. |
| `ts.verifications.report(id)` | Get the portable `report_url`. |
| `ts.verifications.audit(id)` | Download the immutable audit record. |

### Idempotency

Pass an `idempotencyKey` to make `create` safe to retry — replaying the same key returns the
original verification without re-scoring:

```js
await ts.verifications.create(body, { idempotencyKey: 'order-4821' });
```

### Errors

Non-2xx responses throw a `TouchstonesError` carrying the parsed error envelope:

```js
import { TouchstonesError } from '@touchstones/verify';

try {
  await ts.verifications.create(badBody);
} catch (err) {
  if (err instanceof TouchstonesError) {
    console.error(err.status, err.type, err.message, err.param);
  }
}
```

## Webhooks

Register an HTTPS endpoint in your console to receive `verification.completed`,
`verification.needs_review`, and `verification.failed` events. Every delivery is signed:

```
Touchstones-Signature: t=<unixSeconds>,v1=<hmacSha256Hex>
```

Always verify against the **raw request body** before parsing. Example (Express):

```js
import express from 'express';
import { constructEvent } from '@touchstones/verify/webhooks';

const app = express();

app.post('/webhooks/touchstones', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = constructEvent(
      req.body,                                 // raw Buffer
      req.get('Touchstones-Signature'),
      process.env.TOUCHSTONES_WEBHOOK_SECRET,   // whsec_…
    );
    if (event.type === 'verification.completed') {
      const v = event.data.verification;
      // … reconcile asynchronously …
    }
    res.json({ received: true });
  } catch (err) {
    res.status(400).send('Invalid signature');
  }
});
```

Or verify manually with `verifyWebhookSignature(rawBody, signatureHeader, secret, { toleranceSeconds })`.

## License

MIT
