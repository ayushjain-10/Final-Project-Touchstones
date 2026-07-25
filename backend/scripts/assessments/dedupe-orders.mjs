// Backend — idempotent order processing; rubric rewards first-seen-wins dedupe by key (not by order_id).
export default {
  slug: 'dedupe-orders',
  title: 'Idempotent Order Processing',
  role_family: 'backend',
  language: 'python',
  response_type: 'code',
  duration_minutes: 30,
  entry_file: 'solution.py',
  entry_fn: 'process_orders',
  prompt_md: `# Idempotent Order Processing

A payments service receives order-creation events that may be **retried**. Each retry carries the same **idempotency key**, so the order must only be created **once**.

\`process_orders(events)\` takes a list of \`[idempotency_key, order_id]\` pairs and processes them **in order**:

- The **first** time an \`idempotency_key\` is seen, the order is **created** — append its \`order_id\` to the output.
- Any **later** event with an already-seen \`idempotency_key\` is a duplicate request and is **ignored**.

Dedupe is keyed on the **idempotency_key**, not the \`order_id\`. Two different keys that happen to carry the same \`order_id\` both create (the output may contain repeats); the same key seen twice creates only once.

\`\`\`python
def process_orders(events):
    ...
\`\`\`

**Example:**

\`\`\`python
process_orders([["k1", "A"], ["k2", "B"], ["k1", "A"], ["k3", "C"], ["k2", "B"]])
# -> ["A", "B", "C"]
\`\`\`

Return the list of created \`order_id\`s in creation order.`,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns created order_ids in creation order for all inputs', points_possible: 5, weight: 1 },
      { id: 'idempotent', requirement: 'Dedupes on idempotency_key (first-seen wins), ignoring later retries', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Handles empty input, all-duplicate keys, and same order_id under different keys', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def process_orders(events):
    # Return the list of created order_ids (one per first-seen idempotency_key), in creation order.
    pass
`,
  cases: [
    { name: 'basic example', visible: true, input: [[['k1', 'A'], ['k2', 'B'], ['k1', 'A'], ['k3', 'C'], ['k2', 'B']]], expected: ['A', 'B', 'C'] },
    { name: 'no duplicates', visible: true, input: [[['k1', 'A'], ['k2', 'B'], ['k3', 'C']]], expected: ['A', 'B', 'C'] },
    { name: 'empty input', visible: true, input: [[]], expected: [] },
    { name: 'all duplicates of one key', visible: false, input: [[['k1', 'A'], ['k1', 'A'], ['k1', 'A']]], expected: ['A'] },
    { name: 'interleaved duplicates', visible: false, input: [[['k1', 'A'], ['k2', 'B'], ['k1', 'A'], ['k2', 'B'], ['k3', 'C'], ['k1', 'A']]], expected: ['A', 'B', 'C'] },
    { name: 'same order_id different keys', visible: false, input: [[['k1', 'X'], ['k2', 'X'], ['k3', 'X']]], expected: ['X', 'X', 'X'] },
    { name: 'similar looking keys', visible: false, input: [[['order-1', 'A'], ['order_1', 'B'], ['order1', 'C'], ['order-1', 'A']]], expected: ['A', 'B', 'C'] },
    { name: 'single event', visible: false, input: [[['k9', 'Z']]], expected: ['Z'] },
    { name: 'duplicate then new', visible: false, input: [[['k1', 'A'], ['k1', 'A'], ['k2', 'B'], ['k2', 'B'], ['k3', 'C']]], expected: ['A', 'B', 'C'] },
    { name: 'key reused after others', visible: false, input: [[['a', 'P'], ['b', 'Q'], ['c', 'R'], ['a', 'P'], ['d', 'S'], ['b', 'Q']]], expected: ['P', 'Q', 'R', 'S'] },
  ],
  reference: `def process_orders(events):
    seen = set()
    out = []
    for key, order_id in events:
        if key not in seen:
            seen.add(key)
            out.append(order_id)
    return out
`,
  // Buggy: dedupes on order_id instead of idempotency_key, so two different keys carrying the same
  // order_id only create once — fails the "same order_id different keys" case.
  buggy: `def process_orders(events):
    seen = set()
    out = []
    for key, order_id in events:
        if order_id not in seen:
            seen.add(order_id)
            out.append(order_id)
    return out
`,
};
