// Senior eng — LRU simulation; rubric rewards O(1) ordered-dict recency tracking + correct eviction semantics.
export default {
  slug: 'lru-cache',
  title: 'LRU Cache (simulation)',
  role_family: 'senior-engineer',
  language: 'python',
  response_type: 'code',
  duration_minutes: 40,
  entry_file: 'solution.py',
  entry_fn: 'lru_cache_sim',
  prompt_md: `# LRU Cache (simulation)\n\nSimulate a **Least-Recently-Used** cache of a fixed \`capacity\`.\n\n\`operations\` is a list where each op is one of:\n- \`["put", key, value]\` — insert or update \`key\`.\n- \`["get", key]\` — read \`key\`.\n\nBoth \`get\` and \`put\` **use** a key, refreshing its recency. A \`get\` on a missing key returns \`-1\`. When a \`put\` of a *new* key would exceed \`capacity\`, evict the **least-recently-used** key first. Updating an existing key via \`put\` refreshes it and does not evict.\n\nReturn the list of results from each \`get\`, in order.\n\n\`\`\`python\ndef lru_cache_sim(capacity, operations):\n    ...\n\`\`\`\n\n**Example:**\n\n\`\`\`python\nlru_cache_sim(2, [["put",1,1],["put",2,2],["get",1],["put",3,3],["get",2],["get",3]])\n# -> [1, -1, 3]\n# putting 3 evicts key 2, because get(1) had just refreshed key 1\n\`\`\``,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct sequence of get results for all operation sequences', points_possible: 5, weight: 1 },
      { id: 'recency', requirement: 'Refreshes recency on both get and put, evicting the true least-recently-used key', points_possible: 3, weight: 1 },
      { id: 'approach', requirement: 'Uses an ordered map (e.g. OrderedDict) for O(1) updates rather than a linear scan', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def lru_cache_sim(capacity, operations):\n    # Simulate an LRU cache; return list of get results.\n    pass\n`,
  cases: [
    { name: 'basic example', visible: true, input: [2, [['put', 1, 1], ['put', 2, 2], ['get', 1], ['put', 3, 3], ['get', 2], ['get', 3]]], expected: [1, -1, 3] },
    { name: 'get on missing key', visible: true, input: [2, [['get', 5], ['put', 1, 10], ['get', 1]]], expected: [-1, 10] },
    { name: 'update existing key', visible: true, input: [2, [['put', 1, 1], ['put', 1, 9], ['get', 1]]], expected: [9] },
    { name: 'capacity 1 eviction', visible: false, input: [1, [['put', 1, 1], ['put', 2, 2], ['get', 1], ['get', 2]]], expected: [-1, 2] },
    { name: 'get refreshes recency', visible: false, input: [2, [['put', 1, 1], ['put', 2, 2], ['get', 1], ['put', 3, 3], ['get', 1], ['get', 2]]], expected: [1, 1, -1] },
    { name: 'update prevents eviction', visible: false, input: [2, [['put', 1, 1], ['put', 2, 2], ['put', 1, 100], ['put', 3, 3], ['get', 2], ['get', 1], ['get', 3]]], expected: [-1, 100, 3] },
    { name: 'no gets at all', visible: false, input: [2, [['put', 1, 1], ['put', 2, 2], ['put', 3, 3]]], expected: [] },
    { name: 'larger sequence', visible: false, input: [3, [['put', 1, 1], ['put', 2, 2], ['put', 3, 3], ['get', 1], ['put', 4, 4], ['get', 2], ['get', 3], ['get', 4], ['get', 1]]], expected: [1, -1, 3, 4, 1] },
    { name: 'repeated gets same key', visible: false, input: [2, [['put', 7, 7], ['get', 7], ['get', 7], ['put', 8, 8], ['put', 9, 9], ['get', 7], ['get', 8]]], expected: [7, 7, -1, 8] },
    { name: 'reinsert after eviction', visible: false, input: [2, [['put', 1, 1], ['put', 2, 2], ['put', 3, 3], ['get', 1], ['put', 1, 5], ['get', 1], ['get', 2]]], expected: [-1, 5, -1] },
  ],
  reference: `from collections import OrderedDict\n\n\ndef lru_cache_sim(capacity, operations):\n    cache = OrderedDict()\n    results = []\n    for op in operations:\n        if op[0] == 'put':\n            _, key, value = op\n            if key in cache:\n                cache.move_to_end(key)\n            cache[key] = value\n            if len(cache) > capacity:\n                cache.popitem(last=False)\n        else:\n            _, key = op\n            if key in cache:\n                cache.move_to_end(key)\n                results.append(cache[key])\n            else:\n                results.append(-1)\n    return results\n`,
  buggy: `from collections import OrderedDict\n\n\ndef lru_cache_sim(capacity, operations):\n    cache = OrderedDict()\n    results = []\n    for op in operations:\n        if op[0] == 'put':\n            _, key, value = op\n            if key in cache:\n                cache.move_to_end(key)\n            cache[key] = value\n            if len(cache) > capacity:\n                cache.popitem(last=False)\n        else:\n            _, key = op\n            if key in cache:\n                # Bug: get does not refresh recency.\n                results.append(cache[key])\n            else:\n                results.append(-1)\n    return results\n`,
};
