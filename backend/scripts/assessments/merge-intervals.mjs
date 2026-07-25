// Senior eng — classic interval-merge; rubric rewards the sort-then-sweep O(n log n) approach + touching-endpoint edge handling.
export default {
  slug: 'merge-intervals',
  title: 'Merge Intervals',
  role_family: 'senior-engineer',
  language: 'python',
  response_type: 'code',
  duration_minutes: 30,
  entry_file: 'solution.py',
  entry_fn: 'merge_intervals',
  prompt_md: `# Merge Intervals\n\nGiven a list of \`[start, end]\` integer intervals in any order, merge all overlapping or **touching** intervals and return the merged list **sorted ascending by start**.\n\nTouching counts as overlapping: \`[1, 4]\` and \`[4, 5]\` merge into \`[1, 5]\`.\n\n\`\`\`python\ndef merge_intervals(intervals):\n    ...\n\`\`\`\n\n**Example:**\n\n\`\`\`python\nmerge_intervals([[1, 3], [2, 6], [8, 10], [15, 18]])\n# -> [[1, 6], [8, 10], [15, 18]]\n\`\`\`\n\nReturn each merged interval as a two-element list \`[start, end]\`.`,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct merged, start-sorted interval list for all inputs', points_possible: 5, weight: 1 },
      { id: 'touching', requirement: 'Treats touching endpoints (e.g. [1,4] and [4,5]) as overlapping', points_possible: 3, weight: 1 },
      { id: 'approach', requirement: 'Sorts by start then sweeps in O(n log n) rather than comparing all pairs', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def merge_intervals(intervals):\n    # Merge overlapping/touching intervals; return list sorted by start.\n    pass\n`,
  cases: [
    { name: 'basic example', visible: true, input: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
    { name: 'touching endpoints', visible: true, input: [[[1, 4], [4, 5]]], expected: [[1, 5]] },
    { name: 'no overlaps', visible: true, input: [[[1, 2], [3, 4], [5, 6]]], expected: [[1, 2], [3, 4], [5, 6]] },
    { name: 'unsorted input', visible: false, input: [[[8, 10], [1, 3], [2, 6], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
    { name: 'fully nested interval', visible: false, input: [[[1, 10], [2, 5], [3, 4]]], expected: [[1, 10]] },
    { name: 'single interval', visible: false, input: [[[5, 7]]], expected: [[5, 7]] },
    { name: 'all overlap into one', visible: false, input: [[[1, 4], [2, 5], [3, 6], [5, 8]]], expected: [[1, 8]] },
    { name: 'negative coordinates', visible: false, input: [[[-5, -1], [-3, 2], [4, 6]]], expected: [[-5, 2], [4, 6]] },
    { name: 'empty input', visible: false, input: [[]], expected: [] },
    { name: 'duplicate intervals', visible: false, input: [[[1, 3], [1, 3], [2, 4]]], expected: [[1, 4]] },
  ],
  reference: `def merge_intervals(intervals):\n    if not intervals:\n        return []\n    ordered = sorted(intervals, key=lambda iv: (iv[0], iv[1]))\n    merged = [list(ordered[0])]\n    for start, end in ordered[1:]:\n        last = merged[-1]\n        if start <= last[1]:\n            last[1] = max(last[1], end)\n        else:\n            merged.append([start, end])\n    return merged\n`,
  buggy: `def merge_intervals(intervals):\n    if not intervals:\n        return []\n    ordered = sorted(intervals, key=lambda iv: (iv[0], iv[1]))\n    merged = [list(ordered[0])]\n    for start, end in ordered[1:]:\n        last = merged[-1]\n        # Bug: uses strict '<' so touching endpoints are NOT merged.\n        if start < last[1]:\n            last[1] = max(last[1], end)\n        else:\n            merged.append([start, end])\n    return merged\n`,
};
