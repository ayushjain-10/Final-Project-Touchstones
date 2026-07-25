// Backend — token-bucket rate limiter; rubric rewards correct refill math + float-safe boundary handling.
export default {
  slug: 'token-bucket',
  title: 'Token-Bucket Rate Limiter',
  role_family: 'backend',
  language: 'python',
  response_type: 'code',
  duration_minutes: 35,
  entry_file: 'solution.py',
  entry_fn: 'rate_limit',
  prompt_md: `# Token-Bucket Rate Limiter

Implement a classic **token-bucket** rate limiter.

The bucket starts **full** with \`capacity\` tokens. \`refill_rate\` is the number of tokens added per second, and the bucket is **capped** at \`capacity\` (tokens never exceed it). \`requests\` is a list of arrival times in seconds (non-decreasing ints/floats).

Process the requests **in order**. Track \`tokens\` (starting at \`capacity\`) and \`last_time\` (starting at the first request's time, i.e. no refill before the first request). For each request at time \`t\`:

1. Refill: \`tokens = min(capacity, tokens + (t - last_time) * refill_rate)\`.
2. If \`tokens >= 1\`, **consume** one token (\`tokens -= 1\`) and the request is **allowed** (\`True\`).
3. Otherwise the request is **denied** (\`False\`) and tokens are left unchanged.
4. Advance \`last_time = t\` (every request, allowed or not).

Use a small epsilon when comparing (\`tokens >= 1 - 1e-9\`) to avoid floating-point issues.

\`\`\`python
def rate_limit(capacity, refill_rate, requests):
    ...
\`\`\`

**Example:**

\`\`\`python
rate_limit(2, 1, [0, 0, 0, 1, 1])
# -> [True, True, False, True, False]
\`\`\`

Return the list of booleans, one per request.`,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct allow/deny boolean for every request', points_possible: 5, weight: 1 },
      { id: 'refill', requirement: 'Refills tokens by elapsed time, caps at capacity, and starts the bucket full', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Handles float boundaries (epsilon) and leaves tokens unchanged on denial', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def rate_limit(capacity, refill_rate, requests):
    # Return a list of booleans: True if the request is allowed, False if denied.
    pass
`,
  cases: [
    { name: 'basic example', visible: true, input: [2, 1, [0, 0, 0, 1, 1]], expected: [true, true, false, true, false] },
    { name: 'starts full', visible: true, input: [3, 1, [0, 0, 0, 0]], expected: [true, true, true, false] },
    { name: 'no requests', visible: true, input: [5, 2, []], expected: [] },
    { name: 'capacity one', visible: false, input: [1, 1, [0, 0, 1, 1, 2]], expected: [true, false, true, false, true] },
    { name: 'full refill over gap', visible: false, input: [2, 1, [0, 0, 10, 10, 10]], expected: [true, true, true, true, false] },
    { name: 'high refill rate', visible: false, input: [2, 5, [0, 0, 1, 1, 1]], expected: [true, true, true, true, false] },
    { name: 'exact boundary refill', visible: false, input: [1, 2, [0, 0.5, 1.0]], expected: [true, true, true] },
    { name: 'fractional times', visible: false, input: [1, 1, [0, 0.5, 0.5, 1.0]], expected: [true, false, false, true] },
    { name: 'cap prevents overflow', visible: false, input: [2, 1, [0, 100, 100, 100]], expected: [true, true, true, false] },
    { name: 'burst then drought', visible: false, input: [3, 1, [0, 0, 0, 0, 0, 1, 2]], expected: [true, true, true, false, false, true, true] },
  ],
  reference: `def rate_limit(capacity, refill_rate, requests):
    if not requests:
        return []
    tokens = float(capacity)
    last_time = requests[0]
    out = []
    for t in requests:
        tokens = min(float(capacity), tokens + (t - last_time) * refill_rate)
        last_time = t
        if tokens >= 1 - 1e-9:
            tokens -= 1
            out.append(True)
        else:
            out.append(False)
    return out
`,
  // Buggy: refills AFTER advancing last_time wrong — uses strict > 0 instead of >= 1, so a request is
  // allowed whenever any tokens remain (fractional), over-allowing on the capacity-one / drought cases.
  buggy: `def rate_limit(capacity, refill_rate, requests):
    if not requests:
        return []
    tokens = float(capacity)
    last_time = requests[0]
    out = []
    for t in requests:
        tokens = min(float(capacity), tokens + (t - last_time) * refill_rate)
        last_time = t
        if tokens > 0:
            tokens -= 1
            out.append(True)
        else:
            out.append(False)
    return out
`,
};
