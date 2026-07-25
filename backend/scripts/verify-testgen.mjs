/**
 * verify-testgen.mjs — prove testGenerationService end-to-end against the real E2B sandbox.
 * Generates a reference solution + validated cases for a sample screen, runs the reference
 * through codeExecutionService.runCases, and reports how many cases survived. No DB writes.
 *
 * Usage:  node backend/scripts/verify-testgen.mjs            # python two_sum sample
 *         node backend/scripts/verify-testgen.mjs js         # javascript sample
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { generateValidatedTests } = require('../src/services/testGenerationService');

const samples = {
  python: {
    language: 'python',
    prompt_md:
      'Implement two_sum(nums, target). Given a list of integers `nums` and an integer `target`, return the two indices `[i, j]` with i < j such that nums[i] + nums[j] == target. Assume exactly one solution exists. Example: two_sum([2, 7, 11, 15], 9) -> [0, 1].',
    rubric: { criteria: [{ id: 'correctness', requirement: 'Returns the two indices whose values sum to target', points_possible: 100, weight: 1 }] },
  },
  js: {
    language: 'javascript',
    prompt_md:
      'Implement isValidParentheses(s). Given a string `s` of the characters ()[]{}, return true if every bracket is closed by the same type in the correct order, else false. Example: isValidParentheses("()[]{}") -> true; isValidParentheses("(]") -> false.',
    rubric: { criteria: [{ id: 'correctness', requirement: 'Validates bracket matching correctly', points_possible: 100, weight: 1 }] },
  },
};

const which = process.argv[2] === 'js' ? 'js' : 'python';
const r = await generateValidatedTests(samples[which]);

console.log(`\n=== testGenerationService — ${which} sample ===`);
console.log('entry_fn:', r.reference_solution?.entry_fn);
console.log('stats:', JSON.stringify(r.stats));
console.log('tests.kind:', r.tests.kind, '| cases kept:', r.tests.cases?.length ?? 0, '| validated:', r.tests.validated ?? false);
for (const c of (r.tests.cases || []).slice(0, 5)) {
  console.log(`  ${c.visible ? 'sample ' : 'hidden '} ${JSON.stringify(c.input)} -> ${JSON.stringify(c.expected)}`);
}
console.log('\n--- reference_solution ---\n' + (r.reference_solution?.content || '(none)'));
console.log('\n' + (r.tests.kind === 'cases' && r.tests.cases.length >= 1 ? 'PASS: grounded tests produced' : 'FAIL: no grounded tests'));
