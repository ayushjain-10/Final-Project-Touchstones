// Slice-0 end-to-end smoke test for Feature 1 (proof-of-skill).
// Creates a work sample + candidate answer, scores it via Claude Haiku, verifies
// the computed score, per-criterion evidence, and the immutable audit row.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const { supabaseAdmin } = require('../src/config/supabase');
const proof = require('../src/services/proofScoringService');

(async () => {
  const recruiterId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const { error: pErr } = await supabaseAdmin.from('profiles').insert([
    { id: recruiterId, email: `rec-${recruiterId.slice(0, 8)}@demo.dev`, first_name: 'Demo', last_name: 'Recruiter', role: 'recruiter', provider: 'local' },
    { id: candidateId, email: `cand-${candidateId.slice(0, 8)}@demo.dev`, first_name: 'Avery', last_name: 'Quinn', role: 'candidate', provider: 'local' },
  ]);
  if (pErr) throw new Error('profile insert: ' + pErr.message);

  const rubric = { criteria: [
    { id: 'correctness', requirement: 'Designs a correct rate limiter that handles bursts and is thread-safe', points_possible: 10, weight: 0.5,
      anchors: ['10 = token-bucket/sliding-window, thread-safe, handles bursts', '5 = basic counter, misses edge cases', '0 = incorrect'] },
    { id: 'clarity', requirement: 'Clear, well-structured explanation and code', points_possible: 10, weight: 0.3,
      anchors: ['10 = crisp and readable', '5 = ok', '0 = unreadable'] },
    { id: 'tradeoffs', requirement: 'Discusses real tradeoffs (memory, accuracy, distributed state)', points_possible: 10, weight: 0.2,
      anchors: ['10 = multiple concrete tradeoffs', '5 = one', '0 = none'] },
  ] };

  const { data: ws } = await supabaseAdmin.from('work_samples').insert({
    owner_id: recruiterId, title: 'Design an API rate limiter', role_family: 'backend',
    prompt_md: 'Design an API rate limiter. Explain your approach, give pseudocode, and discuss tradeoffs.',
    rubric, status: 'published',
  }).select().single();

  const answer = `I'd use a **token bucket**. Each client gets a bucket with a capacity (burst size) and a refill rate (e.g. 100 tokens, refilling 10/sec). Each request consumes a token; an empty bucket returns HTTP 429.

\`\`\`python
class TokenBucket:
    def __init__(self, capacity, refill_rate):
        self.capacity, self.tokens = capacity, capacity
        self.refill_rate, self.last = refill_rate, time.monotonic()
        self.lock = threading.Lock()
    def allow(self):
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.refill_rate)
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1; return True
            return False
\`\`\`

Thread-safety comes from the lock. Tradeoffs: token bucket allows controlled bursts (good for spiky traffic) vs a fixed window which is simpler but has boundary spikes. For a distributed deployment I'd move the counter to Redis with an atomic INCR + Lua script, trading a little latency for shared state. Memory is O(active clients).`;

  const { data: sub } = await supabaseAdmin.from('work_sample_submissions').insert({
    work_sample_id: ws.id, candidate_id: candidateId, response_text: answer,
    input_hash: crypto.createHash('sha256').update(answer).digest('hex'),
    submitted_at: new Date().toISOString(), status: 'submitted',
  }).select().single();

  console.log('Scoring submission via Claude Haiku (score computed in JS)...');
  const r = await proof.scoreSubmission(sub.id);
  console.log('\n=== SCORE ===');
  console.log(`normalized_score: ${r.normalized_score}/100 | outcome: ${r.outcome} | injection_flag: ${r.injection_flag}`);
  for (const c of r.per_criterion) console.log(`  ${c.id}: ${c.points_awarded}/${c.points_possible} [${c.verdict}] — ${c.explanation}`);
  console.log('overall:', r.overall_explanation);

  const { data: audit } = await supabaseAdmin.from('proof_audit_log')
    .select('decision_id, overall_score, model_id, model_version, rubric_version, prompt_version, input_hash, row_hash, event_ts_start, event_ts_end')
    .eq('proof_score_id', r.scoreId).single();
  console.log('\n=== IMMUTABLE AUDIT ROW ===');
  console.log(`  decision_id=${audit.decision_id}\n  model=${audit.model_id} rubric_v=${audit.rubric_version} prompt_v=${audit.prompt_version}\n  input_hash=${audit.input_hash.slice(0,16)}…  row_hash=${audit.row_hash.slice(0,16)}…`);

  const { error: upErr } = await supabaseAdmin.from('proof_audit_log').update({ overall_score: 999 }).eq('decision_id', audit.decision_id);
  console.log(`  append-only enforced: ${upErr ? 'YES ✅ (' + upErr.message.slice(0, 50) + ')' : 'NO — TRIGGER FAILED ❌'}`);
  console.log(`\n(left as demo seed: work_sample ${ws.id})`);
})().catch(e => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
