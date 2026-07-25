/**
 * Unit tests for the adaptive-variant seed handling (Feature 3). The seed logic is PURE
 * (deterministic-per-seed, env-independent) and is the anti-share guarantee: the same
 * (work_sample, seed) must always normalize to the same variant key, and an absent seed
 * must mint a fresh unique one. generateVariant's no-LLM graceful path is also covered —
 * with no ANTHROPIC_API_KEY (the CI/mock default) it returns the base prompt unchanged.
 */
const aiService = require('../../src/services/aiService');
const variantService = require('../../src/services/variantService');
const { normalizeSeed, variantSpecText, generateVariant } = variantService;

describe('normalizeSeed', () => {
  test('is deterministic — the same input always yields the same seed', () => {
    expect(normalizeSeed('candidate-42')).toBe(normalizeSeed('candidate-42'));
    expect(normalizeSeed(7)).toBe(normalizeSeed('7')); // coerced via String()
  });

  test('different inputs yield different seeds', () => {
    expect(normalizeSeed('a')).not.toBe(normalizeSeed('b'));
  });

  test('an absent seed mints a fresh, unique value each call', () => {
    const a = normalizeSeed();
    const b = normalizeSeed();
    const c = normalizeSeed('');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  test('produces a bounded fixed-width hex token (safe as a TEXT key)', () => {
    expect(normalizeSeed('any-arbitrary-input-of-any-length-1234567890')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('variantSpecText', () => {
  test('returns empty string when no spec is present', () => {
    expect(variantSpecText({})).toBe('');
    expect(variantSpecText({ variant_spec: null })).toBe('');
  });

  test('passes a string spec through (bounded)', () => {
    expect(variantSpecText({ variant_spec: 'swap the city names' })).toBe('swap the city names');
  });

  test('serializes an object spec with instructions + knobs', () => {
    const t = variantSpecText({ variant_spec: { instructions: 'vary the dataset', knobs: { rows: [100, 1000] } } });
    expect(t).toContain('vary the dataset');
    expect(t).toContain('rows');
  });
});

describe('generateVariant (no-LLM graceful path)', () => {
  // Force the no-LLM branch deterministically (independent of whether a real key is in
  // .env): when getLLM() reports no anthropic client, generateVariant must NOT call out
  // and must return the base prompt unchanged with the (still-unique) seed.
  let spy;
  beforeEach(() => { spy = jest.spyOn(aiService, 'getLLM').mockReturnValue({ anthropic: null, model: 'claude-haiku-4-5' }); });
  afterEach(() => { spy.mockRestore(); });

  test('with no LLM configured, returns the base prompt unchanged + a deterministic seed', async () => {
    const ws = { prompt_md: '# Build a rate limiter\nImplement a token-bucket limiter.' };
    const out = await generateVariant(ws, 'seed-1');
    expect(out.prompt_md).toBe(ws.prompt_md);
    expect(out.variant_seed).toBe(normalizeSeed('seed-1'));
    expect(out.params).toEqual({ base: true });
  });

  test('a missing prompt degrades to an empty base prompt, never throws', async () => {
    const out = await generateVariant({}, undefined);
    expect(out.prompt_md).toBe('');
    expect(out.variant_seed).toMatch(/^[0-9a-f]+$/);
  });
});
