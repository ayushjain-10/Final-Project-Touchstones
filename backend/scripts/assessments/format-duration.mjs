// Frontend — string formatting / unit decomposition. Rewards clean "include only non-zero units" logic.
export default {
  slug: 'format-duration',
  title: 'Format Duration',
  role_family: 'frontend',
  language: 'javascript',
  response_type: 'code',
  duration_minutes: 20,
  entry_file: 'solution.js',
  entry_fn: 'formatDuration',
  prompt_md: `# Format Duration

Given a non-negative integer \`seconds\`, return a compact human-readable duration string of the
form \`"Xh Ym Zs"\`, **including only the units whose value is greater than zero**, joined by single
spaces, in the order hours, minutes, seconds.

- \`1 hour = 3600s\`, \`1 minute = 60s\`.
- If the total is \`0\`, return \`"0s"\`.
- There is **no day unit** — hours may exceed 23 (e.g. \`90061\` → \`"25h 1m 1s"\`).

\`\`\`js
function formatDuration(seconds) {
  ...
}
\`\`\`

**Examples:**
- \`formatDuration(0)\` → \`"0s"\`
- \`formatDuration(65)\` → \`"1m 5s"\`
- \`formatDuration(3600)\` → \`"1h"\`
- \`formatDuration(3661)\` → \`"1h 1m 1s"\`
- \`formatDuration(3601)\` → \`"1h 1s"\``,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct formatted string for all inputs', points_possible: 5, weight: 1 },
      { id: 'readability', requirement: 'Clear unit decomposition without repetitive branching', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Handles 0, skipped zero units, and hours > 23', points_possible: 2, weight: 1 },
    ],
  },
  starter: `function formatDuration(seconds) {
  // Return "Xh Ym Zs", including only units > 0. Total of 0 returns "0s".
}

module.exports = formatDuration;
`,
  cases: [
    { name: 'minutes and seconds', visible: true, input: [65], expected: '1m 5s' },
    { name: 'exactly one hour', visible: true, input: [3600], expected: '1h' },
    { name: 'all three units', visible: true, input: [3661], expected: '1h 1m 1s' },
    { name: 'zero', visible: false, input: [0], expected: '0s' },
    { name: 'seconds only', visible: false, input: [59], expected: '59s' },
    { name: 'exactly one minute', visible: false, input: [60], expected: '1m' },
    { name: 'two hours exact', visible: false, input: [7200], expected: '2h' },
    { name: 'hour and seconds, no minutes', visible: false, input: [3601], expected: '1h 1s' },
    { name: 'minutes only', visible: false, input: [120], expected: '2m' },
    { name: 'hours exceed 23', visible: false, input: [90061], expected: '25h 1m 1s' },
  ],
  reference: `function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(h + 'h');
  if (m > 0) parts.push(m + 'm');
  if (s > 0) parts.push(s + 's');
  return parts.length ? parts.join(' ') : '0s';
}

module.exports = formatDuration;
`,
  // Buggy: forgets the "0s" fallback, so 0 returns "" instead of "0s".
  buggy: `function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(h + 'h');
  if (m > 0) parts.push(m + 'm');
  if (s > 0) parts.push(s + 's');
  return parts.join(' ');
}

module.exports = formatDuration;
`,
};
