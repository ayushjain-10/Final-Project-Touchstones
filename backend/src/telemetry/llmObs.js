/**
 * Datadog LLM Observability for the scoring engine (the core IP).
 * -----------------------------------------------------------------
 * Traces every model call in the scoring path — the rubric grader (proofScoringService),
 * the candidate AI assistant (aiAssistService), and direction scoring (aiDirectionService) —
 * as an `llm` span carrying latency, token cost, model id, and (optionally) the prompt +
 * completion content for prompt-injection analysis. Each finished score also emits a `task`
 * span carrying the normalized score, self-consistency variance, and the injection flag, so
 * the engine's behavior is queryable + alertable in Datadog LLM Observability.
 *
 * Fail-safe + optional: a complete NO-OP unless DD_LLMOBS_ENABLED=1. dd-trace is lazily
 * required ONLY when enabled, so when it's off the app and tests run with zero overhead and no
 * native-addon dependency. Agentless mode (DD_LLMOBS_AGENTLESS_ENABLED=true + DD_API_KEY)
 * ships spans straight to Datadog with no Datadog Agent — ideal for the Render-hosted backend.
 */
let llmobs = null;
let enabled = false;
const CAPTURE_IO = (process.env.DD_LLMOBS_CAPTURE_IO || 'true') !== 'false';
const MAX_IO = 4000; // clamp captured prompt/completion text

(function init() {
  const on = process.env.DD_LLMOBS_ENABLED === '1' || process.env.DD_LLMOBS_ENABLED === 'true';
  if (!on) return;
  try {
    const tracer = require('dd-trace');
    tracer.init({
      llmobs: {
        mlApp: process.env.DD_LLMOBS_ML_APP || 'touchstones-scoring',
        agentlessEnabled: (process.env.DD_LLMOBS_AGENTLESS_ENABLED || 'true') !== 'false',
      },
    });
    llmobs = tracer.llmobs;
    enabled = true;
    console.log(`Datadog LLM Observability: ON (mlApp=${process.env.DD_LLMOBS_ML_APP || 'touchstones-scoring'})`);
  } catch (e) {
    console.warn('Datadog LLMObs init failed; continuing without it:', e.message);
    enabled = false;
  }
})();

function summarizeMessages(messages) {
  try {
    return (messages || []).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, MAX_IO) }));
  } catch { return undefined; }
}

/**
 * Wrap one model call as an `llm` span. `fn` returns the raw OpenAI/Azure response shape
 * ({ choices:[{message:{content}}], usage:{prompt_tokens, completion_tokens, total_tokens} }).
 * Returns fn() unchanged when disabled.
 */
async function traceLLM({ name = 'azure.chat', model, provider = 'azure_openai', input } = {}, fn) {
  if (!enabled) return fn();
  return llmobs.trace({ kind: 'llm', name, modelName: model, modelProvider: provider }, async () => {
    const resp = await fn();
    try {
      llmobs.annotate({
        inputData: CAPTURE_IO ? summarizeMessages(input) : undefined,
        outputData: CAPTURE_IO ? String(resp?.choices?.[0]?.message?.content || '').slice(0, MAX_IO) : undefined,
        metrics: {
          input_tokens: resp?.usage?.prompt_tokens,
          output_tokens: resp?.usage?.completion_tokens,
          total_tokens: resp?.usage?.total_tokens,
        },
      });
    } catch (_) { /* annotation is best-effort */ }
    return resp;
  });
}

/**
 * Emit a zero-duration `task` span carrying a finished SCORE OUTCOME — normalized score,
 * self-consistency variance, prompt-injection flag, outcome, and model — so the scoring engine
 * is directly queryable/alertable in Datadog. No-op when disabled.
 */
function recordScore({ name = 'proof.score', model, normalized, variance, injection, outcome, submissionId, injectionSource } = {}) {
  if (!enabled) return;
  try {
    llmobs.trace({ kind: 'task', name }, () => {
      llmobs.annotate({
        metadata: { submissionId, model, outcome },
        metrics: {
          ...(typeof normalized === 'number' ? { normalized_score: normalized } : {}),
          ...(typeof variance === 'number' ? { score_variance: variance } : {}),
        },
        tags: {
          injection: String(!!injection),
          outcome: outcome || 'n/a',
          ...(injectionSource ? { injection_source: injectionSource } : {}),
        },
      });
    });
  } catch (_) { /* best-effort */ }
}

module.exports = {
  get enabled() { return enabled; },
  traceLLM,
  recordScore,
};
