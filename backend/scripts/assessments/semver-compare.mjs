// DevOps — version comparison; rubric rewards numeric (not lexical) compare, leading-zero handling, and correct precedence.
export default {
  slug: 'semver-compare',
  title: 'Semantic Version Compare',
  role_family: 'devops',
  language: 'python',
  response_type: 'code',
  duration_minutes: 30,
  entry_file: 'solution.py',
  entry_fn: 'compare_semver',
  prompt_md: `# Semantic Version Compare

Given two version strings \`a\` and \`b\`, each of the form \`"MAJOR.MINOR.PATCH"\` where every part
is a non-negative integer, compare them.

- Compare \`MAJOR\` first, then \`MINOR\`, then \`PATCH\`, **numerically**.
- Return \`-1\` if \`a < b\`, \`0\` if they are equal, and \`1\` if \`a > b\`.

Notes:
- Every input has **exactly three** numeric parts. \`"1.2"\` is not valid input.
- There is no prerelease or build metadata to consider.
- Leading zeros may appear and must be parsed numerically (e.g. \`"1.02.0"\` → minor \`2\`).

\`\`\`python
def compare_semver(a, b):
    ...
\`\`\`

**Example:**

\`\`\`python
compare_semver("1.2.10", "1.2.9")  # -> 1  (patch 10 > patch 9, compared numerically)
\`\`\``,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns -1/0/1 correctly for all version pairs', points_possible: 5, weight: 1 },
      { id: 'parsing', requirement: 'Compares parts numerically (not lexically) and parses leading zeros as integers', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Respects major > minor > patch precedence and handles equality and large numbers', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def compare_semver(a, b):
    # Return -1 if a < b, 0 if equal, 1 if a > b. Compare major, then minor, then patch numerically.
    pass
`,
  cases: [
    { name: 'patch greater', visible: true, input: ["1.2.10", "1.2.9"], expected: 1 },
    { name: 'equal versions', visible: true, input: ["2.0.0", "2.0.0"], expected: 0 },
    { name: 'a less than b', visible: true, input: ["1.0.0", "1.1.0"], expected: -1 },
    { name: 'differ only in patch (less)', visible: false, input: ["3.4.5", "3.4.6"], expected: -1 },
    { name: 'leading zeros equal', visible: false, input: ["1.02.0", "1.2.0"], expected: 0 },
    { name: 'leading zeros patch', visible: false, input: ["0.0.09", "0.0.7"], expected: 1 },
    { name: 'major dominates minor', visible: false, input: ["2.0.0", "1.9.9"], expected: 1 },
    { name: 'minor dominates patch', visible: false, input: ["1.3.0", "1.2.99"], expected: 1 },
    { name: 'large numbers', visible: false, input: ["10.20.30", "9.99.99"], expected: 1 },
    { name: 'all zeros equal', visible: false, input: ["0.0.0", "0.0.0"], expected: 0 },
  ],
  reference: `def compare_semver(a, b):
    pa = [int(x) for x in a.split(".")]
    pb = [int(x) for x in b.split(".")]
    for x, y in zip(pa, pb):
        if x < y:
            return -1
        if x > y:
            return 1
    return 0
`,
  // Buggy: compares the version strings lexically instead of numerically,
  // so "1.2.10" < "1.2.9" (because '1' < '9' char-wise) gives the wrong answer.
  buggy: `def compare_semver(a, b):
    if a < b:
        return -1
    if a > b:
        return 1
    return 0
`,
};
