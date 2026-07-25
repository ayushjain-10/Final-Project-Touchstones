jest.mock('../../src/services/aiService', () => ({ getLLM: jest.fn() }));
jest.mock('../../src/services/codeExecutionService', () => ({ runCases: jest.fn() }));

const aiService = require('../../src/services/aiService');
const codeExec = require('../../src/services/codeExecutionService');
const { generateValidatedTests, normalizeLang } = require('../../src/services/testGenerationService');

function mockModel(output) {
  const create = jest.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(output) }] }));
  aiService.getLLM.mockReturnValue({ anthropic: { messages: { create } }, model: 'test-model' });
  return create;
}

beforeEach(() => {
  jest.clearAllMocks();
  codeExec.runCases.mockResolvedValue({
    available: true,
    ran: true,
    cases: [{ passed: true }, { passed: false }, { passed: true }],
  });
});

describe('testGenerationService', () => {
  test('normalizes only supported harness languages', () => {
    expect(normalizeLang('python3')).toBe('python');
    expect(normalizeLang('typescript')).toBe('javascript');
    expect(normalizeLang('rust')).toBeNull();
  });

  test('preserves compare_mode for reference-validated surviving cases', async () => {
    const create = mockModel({
      entry_fn: 'solve',
      reference_solution: 'def solve(nums):\n    return sorted(nums)\n',
      cases: [
        { name: 'order-free ints', input: [[3, 1, 2]], expected: [1, 2, 3], compare_mode: 'multiset' },
        { name: 'bad generated case', input: [[1]], expected: [99], compare_mode: 'exact' },
        { name: 'rounding', input: [[1, 2]], expected: 1.5, compare_mode: 'float-eps' },
      ],
    });

    const result = await generateValidatedTests({
      language: 'python',
      prompt_md: 'Return a sorted copy of nums.',
      rubric: { criteria: [{ id: 'correctness', requirement: 'Works' }] },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].messages[0].content).toContain('"compare_mode"');
    expect(codeExec.runCases).toHaveBeenCalledWith(expect.objectContaining({
      tests: expect.objectContaining({
        cases: [
          expect.objectContaining({ name: 'order-free ints', compare_mode: 'multiset' }),
          expect.objectContaining({ name: 'bad generated case', compare_mode: 'exact' }),
          expect.objectContaining({ name: 'rounding', compare_mode: 'float-eps' }),
        ],
      }),
    }));
    expect(result.tests).toMatchObject({
      kind: 'cases',
      language: 'python',
      entry_file: 'solution.py',
      entry_fn: 'solve',
      validated: true,
    });
    expect(result.tests.cases).toEqual([
      expect.objectContaining({ name: 'order-free ints', compare_mode: 'multiset', visible: true }),
      expect.objectContaining({ name: 'rounding', compare_mode: 'float-eps', visible: true }),
    ]);
    expect(result.stats).toMatchObject({ generated: 3, kept: 2, pruned: 1 });
  });
});
