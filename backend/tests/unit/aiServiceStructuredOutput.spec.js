/**
 * aiService.buildAzureLLM — strict structured-output emission (Azure services plan).
 * ---------------------------------------------------------------------------------
 * buildAzureLLM()/buildBody() are private closures (not exported), so we exercise the
 * REAL logic through the exported instance's Anthropic-shaped shim (getLLM().anthropic)
 * and mock ONLY the network boundary — the OpenAI SDK's chat.completions.create — so we
 * can inspect the request body it was handed. The code under test (buildBody) is NOT
 * faked; only the transport is stubbed, and no network call is made.
 *
 * Contract asserted: response_format `json_schema` (strict) is emitted ONLY when BOTH a
 * response schema is supplied AND AZURE_STRUCTURED_OUTPUTS=true. Missing either → it must
 * fall back to `json_object` (json mode) or omit response_format entirely.
 */

// Captures the body passed to the Azure SDK. Named `mock*` so jest allows it in the
// hoisted factory. Returns a minimal Azure chat-completion shape the shim can parse.
const mockAzCreate = jest.fn(async () => ({
  choices: [{ message: { content: '{}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
}));

jest.mock('openai', () => {
  // aiService only uses the static `require('openai')` result as `OpenAI.AzureOpenAI`
  // (buildAzureLLM). Every other OpenAI usage is a lazy dynamic import inside methods we
  // never call, so this minimal mock is sufficient and constructs nothing over the wire.
  class AzureOpenAI {
    constructor() {
      this.chat = { completions: { create: mockAzCreate } };
    }
  }
  return { AzureOpenAI };
});

const AZURE_KEYS = [
  'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_STRUCTURED_OUTPUTS', 'LLM_PROVIDER', 'SKIP_AZURE_OPENAI', 'ANTHROPIC_API_KEY',
];

/**
 * Freshly require aiService with Azure configured + `extraEnv` applied, and return the
 * Anthropic-shaped shim (getLLM().anthropic). buildAzureLLM reads env (incl.
 * AZURE_STRUCTURED_OUTPUTS) at module-load time, so each scenario needs an isolated load.
 */
function loadAzureShim(extraEnv) {
  const saved = {};
  AZURE_KEYS.forEach((k) => { saved[k] = process.env[k]; });

  let shim;
  jest.isolateModules(() => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://unit-test.openai.azure.com';
    process.env.AZURE_OPENAI_KEY = 'unit-test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-mini'; // non-reasoning → simple body
    process.env.LLM_PROVIDER = 'azure';                  // force Azure selection
    delete process.env.SKIP_AZURE_OPENAI;
    delete process.env.ANTHROPIC_API_KEY;                // don't let Claude win precedence
    delete process.env.AZURE_STRUCTURED_OUTPUTS;         // default OFF unless extraEnv sets it
    Object.assign(process.env, extraEnv);

    const svc = require('../../src/services/aiService');
    shim = svc.getLLM().anthropic;
  });

  // Restore env (buildAzureLLM already captured what it needed during the isolated load).
  AZURE_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  return shim;
}

describe('aiService buildAzureLLM structured-output response_format', () => {
  beforeEach(() => mockAzCreate.mockClear());

  it('sanity: Azure shim is selected when Azure is configured', () => {
    const shim = loadAzureShim({});
    expect(shim).toBeTruthy();
    expect(typeof shim.messages.create).toBe('function');
  });

  it('emits response_format json_schema (strict) when schema + AZURE_STRUCTURED_OUTPUTS=true', async () => {
    const shim = loadAzureShim({ AZURE_STRUCTURED_OUTPUTS: 'true' });
    await shim.messages.create({
      messages: [{ role: 'user', content: 'grade this submission' }],
      response_schema: { name: 'grade', schema: { type: 'object', properties: {} } },
    });
    expect(mockAzCreate).toHaveBeenCalledTimes(1);
    const body = mockAzCreate.mock.calls[0][0];
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toMatchObject({ name: 'grade', strict: true });
  });

  it('does NOT emit json_schema when a schema is present but AZURE_STRUCTURED_OUTPUTS is unset', async () => {
    const shim = loadAzureShim({}); // flag off
    await shim.messages.create({
      messages: [{ role: 'user', content: 'grade this submission' }], // no json-mode trigger words
      response_schema: { name: 'grade', schema: { type: 'object' } },
    });
    expect(mockAzCreate).toHaveBeenCalledTimes(1);
    const body = mockAzCreate.mock.calls[0][0];
    const type = body.response_format && body.response_format.type;
    expect(type).not.toBe('json_schema');
  });

  it('does NOT emit json_schema when the flag is on but NO schema is supplied (falls back to json_object)', async () => {
    const shim = loadAzureShim({ AZURE_STRUCTURED_OUTPUTS: 'true' });
    // Prompt trips the shim's json-mode heuristic ("json" + "respond with only") but there
    // is no response_schema, so it must use json_object, never json_schema.
    await shim.messages.create({
      messages: [{ role: 'user', content: 'respond with only a json object' }],
    });
    expect(mockAzCreate).toHaveBeenCalledTimes(1);
    const body = mockAzCreate.mock.calls[0][0];
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe('json_object');
    expect(body.response_format.type).not.toBe('json_schema');
  });
});
