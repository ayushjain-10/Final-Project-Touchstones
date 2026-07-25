/**
 * Azure OpenAI connectivity smoke — validates the migrated AI layer end-to-end against the
 * live deployment, WITHOUT touching the database or the real scoring path. Exercises exactly
 * the code paths the graders use:
 *   1. aiService.getLLM().anthropic.messages.create(...)  → the Anthropic-shaped shim over Azure
 *      (system + JSON-mode user prompt, like the rubric grader)
 *   2. direct REST probe of the embeddings deployment (embeddingService.js was removed in a837227;
 *      the Azure deployment itself is still validated at the pgvector 1536-d contract)
 *
 * Run from the repo root:  node backend/scripts/azure-smoke.mjs
 * Reads backend/.env directly (gitignored) so it needs no shell env wiring.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load backend/.env into process.env BEFORE importing the services (they read env at module load).
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const aiService = (await import('../src/services/aiService.js')).default;

let failures = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};

console.log('=== Azure OpenAI smoke ===');
const { anthropic, model, provider } = aiService.getLLM();
ok('provider resolved to azure', provider === 'azure', `provider=${provider} model=${model}`);
ok('LLM client present', !!anthropic);

// 1) Grader-shaped JSON call through the shim (system blocks + "respond with ONLY JSON" → json_object mode)
try {
  const resp = await anthropic.messages.create({
    model,
    max_tokens: 800,
    system: [{ type: 'text', text: 'You are a strict grader. Respond with ONLY a JSON object, no prose, no markdown fences.' }],
    messages: [{ role: 'user', content: 'Grade this: 2+2=4. Reply as JSON {"correct": <true|false>, "points": <int 0-10>}.' }],
  });
  const text = (resp.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed = null;
  try { const a = text.indexOf('{'), b = text.lastIndexOf('}'); parsed = JSON.parse(text.slice(a, b + 1)); } catch (_) {}
  ok('chat call returned JSON', parsed && typeof parsed.points !== 'undefined', `raw=${JSON.stringify(text).slice(0, 160)}`);
  ok('usage reported', !!(resp.usage && (resp.usage.output_tokens || resp.usage.input_tokens)),
     `in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens}`);
} catch (e) {
  ok('chat call', false, String(e.message || e).slice(0, 300));
}

// 2) Embeddings deployment via direct REST at the pgvector dimension (no in-repo service anymore)
try {
  const base = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
  const dep = process.env.AZURE_OPENAI_EMBED_DEPLOYMENT;
  const ver = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
  if (!base || !dep) {
    ok('embedding env present', false, 'AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_EMBED_DEPLOYMENT unset');
  } else {
    const res = await fetch(`${base}/openai/deployments/${dep}/embeddings?api-version=${ver}`, {
      method: 'POST',
      headers: { 'api-key': process.env.AZURE_OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'senior backend engineer, distributed systems, postgres', dimensions: 1536 }),
    });
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    ok('embedding call returned 200', res.status === 200, `status=${res.status}`);
    ok('embedding dimension = 1536', Array.isArray(vec) && vec.length === 1536, `len=${vec?.length}`);
    ok('embedding is finite numbers', Array.isArray(vec) && vec.every((x) => Number.isFinite(x)));
  }
} catch (e) {
  ok('embedding call', false, String(e.message || e).slice(0, 300));
}

console.log(failures === 0 ? '\n✓ AZURE SMOKE PASSED' : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
