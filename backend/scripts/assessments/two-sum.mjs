// Senior eng — classic, but the rubric rewards an O(n) hash-map approach + edge handling.
export default {
  slug: 'two-sum',
  title: 'Two Sum (index pair)',
  role_family: 'senior-engineer',
  language: 'python',
  response_type: 'code',
  duration_minutes: 25,
  entry_file: 'solution.py',
  entry_fn: 'two_sum',
  prompt_md: `# Two Sum

Given a list of integers \`nums\` and an integer \`target\`, return the **indices** of the two
numbers that add up to \`target\`, as a list \`[i, j]\` with \`i < j\`.

- Exactly one valid answer exists for every test input.
- You may not use the same element twice.
- Return the indices in ascending order.

\`\`\`python
def two_sum(nums, target):
    ...
\`\`\`

**Example:** \`two_sum([2, 7, 11, 15], 9)\` → \`[0, 1]\` (because \`nums[0] + nums[1] == 9\`).

A brute-force \`O(n²)\` solution works, but the rubric rewards an \`O(n)\` single-pass hash-map
solution and clean handling of duplicates and negatives.`,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct index pair for all inputs', points_possible: 5, weight: 1 },
      { id: 'efficiency', requirement: 'Uses an O(n) hash-map approach rather than nested loops', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Handles duplicates and negative numbers correctly', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def two_sum(nums, target):
    # Return [i, j] with i < j such that nums[i] + nums[j] == target.
    pass
`,
  cases: [
    { name: 'basic example', visible: true, input: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { name: 'answer at the end', visible: true, input: [[3, 2, 4], 6], expected: [1, 2] },
    { name: 'duplicate values', visible: true, input: [[3, 3], 6], expected: [0, 1] },
    { name: 'negatives', visible: false, input: [[-3, 4, 3, 90], 0], expected: [0, 2] },
    { name: 'first and last', visible: false, input: [[1, 5, 9], 10], expected: [0, 2] },
    { name: 'mixed signs', visible: false, input: [[-1, -2, -3, -4, -5], -8], expected: [2, 4] },
    { name: 'zeros', visible: false, input: [[0, 4, 0], 0], expected: [0, 2] },
    { name: 'large gap', visible: false, input: [[2, 1, 9, 4, 4, 56, 90, 3], 8], expected: [3, 4] },
    { name: 'two element', visible: false, input: [[5, 5], 10], expected: [0, 1] },
    { name: 'longer list', visible: false, input: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 19], expected: [8, 9] },
  ],
  reference: `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return [seen[need], i]
        seen[n] = i
    return []
`,
  // Buggy: returns the same index twice / off-by-one (uses <= so it can reuse an element).
  buggy: `def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(i, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return []
`,
};
