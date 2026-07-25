// Fireworks open-model grader — mirrors the Azure grader's EXACT system prompt, submission
// framing, and JSON contract so an open model can be benchmarked apples-to-apples against the
// pinned gpt-5.4-mini grader.
//
// Since 2026-07-09 this is ALSO the production grader path when GRADER_PROVIDER=fireworks
// (owner decision after the Wave-2 benchmark: glm-5p2 + calibrated prompt measured 94.0 recall /
// 97.9 precision vs the Azure shim's 77.1 / 94.9 on 200 execution-labeled programs). Scoring
// stays pinned to ONE model per score: proofScoringService selects the provider per score run
// and records model_id, falling back to the Azure shim only when every Fireworks sample fails.
// See Linear TOU-7 for the benchmark data.
const { buildSystemPrompt, validateGraderOutput } = require('./proofScoringService');

const FIREWORKS_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const DEFAULT_MODEL = process.env.FIREWORKS_GRADER_MODEL || 'accounts/fireworks/models/deepseek-v4-pro';

// One grading pass with a Fireworks model. Returns { grade: validated {per_criterion,...} | null,
// usage, model }. Never wired into the request path; callers are eval scripts.
async function gradeWithFireworks(rubric, response, opts = {}) {
  const apiKey = opts.apiKey || process.env.FIREWORKS_API_KEY;
  if (!apiKey) throw new Error('FIREWORKS_API_KEY not set');
  const model = opts.model || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs || 60000;
  const system = buildSystemPrompt(rubric);
  const user = `<submission>\n${String(response).slice(0, 12000)}\n</submission>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(FIREWORKS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens || 2000, // reasoning models (kimi) can blow 2000 and truncate the JSON
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.error && data.error.message) || `fireworks http ${r.status}`);
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    // deepseek/glm return content; gpt-oss uses a reasoning field.
    const text = msg.content || msg.reasoning_content || '';
    return { grade: validateGraderOutput(text), usage: data.usage || {}, model };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { gradeWithFireworks, DEFAULT_MODEL };
