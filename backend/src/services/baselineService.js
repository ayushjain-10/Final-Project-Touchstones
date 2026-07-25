/**
 * Delta-vs-one-shot-AI baseline. Generates a ONE-SHOT AI solution for a task (no
 * iteration, no human direction), runs it against the screen's hidden tests, and lets
 * us compare the candidate to it — the quantitative answer to "why can't an LLM just
 * do this?". The human earns credit specifically where they beat the agent.
 *
 * The baseline is per-TASK (cached on work_samples.baseline), not per-submission.
 */
const aiService = require('./aiService');
const codeExecutionService = require('./codeExecutionService');

function getLLM() {
  try {
    return aiService.getLLM ? aiService.getLLM() : {};
  } catch {
    return {};
  }
}

function isEnabled() {
  return Boolean(getLLM().anthropic);
}

// One-shot: the model sees the prompt + starter files ONCE and returns the full
// file(s). No iteration — this is the agent's unaided attempt.
async function generateOneShot(workSample) {
  const { anthropic, model } = getLLM();
  if (!anthropic) return null;
  const starter = Array.isArray(workSample.starter_files) ? workSample.starter_files : [];
  const fileList = starter
    .map((f) => `--- ${f.path} ---\n${String(f.content || '').slice(0, 4000)}`)
    .join('\n\n');
  const system =
    'You are a strong engineer. Solve the task in ONE shot — no clarifying questions, no iteration. ' +
    'Return ONLY a JSON object: {"files":[{"path":"...","content":"..."}]} with the COMPLETE updated ' +
    'file(s). No prose, no markdown fences.';
  const user = `TASK:\n${String(workSample.prompt_md || '').slice(0, 4000)}\n\nSTARTER FILES:\n${fileList || '(none)'}`;
  let resp;
  try {
    resp = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: user }],
    });
  } catch {
    return null;
  }
  const text = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.files) && obj.files.length) return obj.files;
  } catch {
    /* not parseable */
  }
  return null;
}

// Ensure the task has a cached baseline { files, result }. Generates + runs it once.
async function ensureBaseline(workSample, persist) {
  if (workSample.baseline && workSample.baseline.result) return workSample.baseline;
  if (!isEnabled()) return null;
  if (!workSample.tests || !workSample.tests.command) return null;
  const files = await generateOneShot(workSample);
  if (!files) return null;
  const result = await codeExecutionService.runTests({ files, tests: workSample.tests });
  const baseline = { files, result, generated_at: new Date().toISOString() };
  if (typeof persist === 'function') {
    try {
      await persist(baseline);
    } catch {
      /* caching is best-effort */
    }
  }
  return baseline;
}

module.exports = { isEnabled, generateOneShot, ensureBaseline };
