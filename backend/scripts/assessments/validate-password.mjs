// Frontend — rule validation returning an ordered list of failing rule codes. Rewards clean, deterministic checks.
export default {
  slug: 'validate-password',
  title: 'Password Rule Validation',
  role_family: 'frontend',
  language: 'javascript',
  response_type: 'code',
  duration_minutes: 25,
  entry_file: 'solution.js',
  entry_fn: 'validatePassword',
  prompt_md: `# Password Rule Validation

Given a password string \`pw\`, return an array of the **rule codes the password FAILS**, in this
exact order (include only the failing ones):

1. \`'too_short'\` — length is less than 8
2. \`'no_upper'\` — contains no uppercase letter (A–Z)
3. \`'no_lower'\` — contains no lowercase letter (a–z)
4. \`'no_digit'\` — contains no digit (0–9)
5. \`'no_symbol'\` — contains no character outside A–Za–z0–9

Return \`[]\` (empty array) if the password passes every rule. The fixed order guarantees a
deterministic result.

\`\`\`js
function validatePassword(pw) {
  ...
}
\`\`\`

**Examples:**
- \`validatePassword("Abc123!@")\` → \`[]\`
- \`validatePassword("abc")\` → \`["too_short", "no_upper", "no_digit", "no_symbol"]\`
- \`validatePassword("ABCDEFGH")\` → \`["no_lower", "no_digit", "no_symbol"]\``,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct failing rule codes for all inputs', points_possible: 5, weight: 1 },
      { id: 'readability', requirement: 'Rules expressed clearly and checked in the required order', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Handles empty string, all-passing input, and symbol detection', points_possible: 2, weight: 1 },
    ],
  },
  starter: `function validatePassword(pw) {
  // Return an array of failing rule codes in order, or [] if all pass.
}

module.exports = validatePassword;
`,
  cases: [
    { name: 'all pass', visible: true, input: ['Abc123!@'], expected: [] },
    { name: 'too short, multiple fails', visible: true, input: ['abc'], expected: ['too_short', 'no_upper', 'no_digit', 'no_symbol'] },
    { name: 'all uppercase letters', visible: true, input: ['ABCDEFGH'], expected: ['no_lower', 'no_digit', 'no_symbol'] },
    { name: 'empty string', visible: false, input: [''], expected: ['too_short', 'no_upper', 'no_lower', 'no_digit', 'no_symbol'] },
    { name: 'all numeric', visible: false, input: ['12345678'], expected: ['no_upper', 'no_lower', 'no_symbol'] },
    { name: 'exactly 8 chars passing', visible: false, input: ['Abcd123!'], expected: [] },
    { name: 'missing only symbol', visible: false, input: ['Abcd1234'], expected: ['no_symbol'] },
    { name: 'missing only digit', visible: false, input: ['Abcdefg!'], expected: ['no_digit'] },
    { name: 'unicode symbol counts', visible: false, input: ['Abcd123é'], expected: [] },
    { name: 'lowercase plus digits, short', visible: false, input: ['ab1'], expected: ['too_short', 'no_upper', 'no_symbol'] },
  ],
  reference: `function validatePassword(pw) {
  const fails = [];
  if (pw.length < 8) fails.push('too_short');
  if (!/[A-Z]/.test(pw)) fails.push('no_upper');
  if (!/[a-z]/.test(pw)) fails.push('no_lower');
  if (!/[0-9]/.test(pw)) fails.push('no_digit');
  if (!/[^A-Za-z0-9]/.test(pw)) fails.push('no_symbol');
  return fails;
}

module.exports = validatePassword;
`,
  // Buggy: treats any non-letter (including digits) as a symbol, so 'no_symbol' is under-reported.
  buggy: `function validatePassword(pw) {
  const fails = [];
  if (pw.length < 8) fails.push('too_short');
  if (!/[A-Z]/.test(pw)) fails.push('no_upper');
  if (!/[a-z]/.test(pw)) fails.push('no_lower');
  if (!/[0-9]/.test(pw)) fails.push('no_digit');
  if (!/[^A-Za-z]/.test(pw)) fails.push('no_symbol');
  return fails;
}

module.exports = validatePassword;
`,
};
