/**
 * In-app AI assistant for the candidate during a work sample. Backs the "Direct the
 * AI" feature: the candidate uses THIS assistant to do the task, and every turn is
 * logged to ai_interactions, so we passively capture how they direct the AI (and
 * whether they catch its mistakes) without any self-reporting.
 *
 * Deliberately helpful-but-not-autopilot: it answers what the candidate asks; it does
 * not silently complete the whole task. The quality of *their* prompting is the signal.
 */
const aiService = require('./aiService');

// Default must fit a COMPLETE solution file in one fenced block (the accept/reject edit flow
// depends on it) — 800 truncated real files mid-function.
const MAX_TOKENS = parseInt(process.env.AI_ASSIST_MAX_TOKENS || '3000', 10);

async function chat(taskPromptMd, history, userMessage, opts = {}) {
  const { anthropic, model } = aiService.getLLM();
  if (!anthropic) {
    return { reply: '[The AI assistant is not configured in this environment.]', model: null };
  }
  const taskContext =
    (opts.title ? `TASK: ${String(opts.title).slice(0, 200)}\n\n` : '') +
    String(taskPromptMd || '').slice(0, 6000);
  const system =
    'You are an AI assistant helping a candidate complete a real-world engineering work sample. ' +
    'Be genuinely useful and respond to exactly what they ask, but do NOT volunteer the entire ' +
    'solution unprompted — the candidate is being evaluated on how well they direct you and ' +
    'whether they catch your mistakes. If they DO explicitly ask you to write, complete, or solve ' +
    'the task, do it: solve the TASK CONTEXT below directly, using the code in their editor as the ' +
    'starting point. Be concise and technical. You can see the code currently ' +
    'in their editor when they share it. When you propose a change to their code, return the ' +
    'COMPLETE updated file in ONE fenced code block (```), so they can apply it in one click; keep ' +
    'the surrounding prose short. They choose whether to accept, edit, or reject your suggestion. ' +
    'Unless the candidate explicitly asks you to write or complete the full task, keep replies ' +
    'under roughly 250 words: answer the question, then offer to go deeper rather than dumping ' +
    'everything you know.\n\n' +
    'TASK CONTEXT:\n' + (taskContext || '(No task brief was provided; ask the candidate to describe the problem.)');

  const messages = [];
  for (const h of (history || []).slice(-20)) {
    messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '').slice(0, 4000) });
  }
  // The candidate's current editor code rides along with THIS turn (it changes over time, so it's
  // not cached in the system block). Lets the AI read + reason about the actual code in front of them.
  const code = typeof opts.code === 'string' ? opts.code.trim() : '';
  const codeCtx = code
    ? `\n\n[The current code in my editor${opts.language ? ` (${opts.language})` : ''}:]\n\`\`\`\n${code.slice(0, 8000)}\n\`\`\``
    : '';
  messages.push({ role: 'user', content: String(userMessage).slice(0, 4000) + codeCtx });

  const resp = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  const reply = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
  // Reasoning models can spend the whole token budget thinking and emit no text at all;
  // an empty assistant turn in the transcript reads as a glitch to both sides.
  if (!reply.trim()) {
    return {
      reply: 'I could not produce an answer for that one. Try asking again more specifically, or break the request into a smaller step.',
      model,
    };
  }
  return { reply, model };
}

module.exports = { chat };
