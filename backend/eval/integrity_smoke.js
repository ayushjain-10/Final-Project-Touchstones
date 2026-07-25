// Smoke test for the integrity hash-chain (migration 012 + /api/integrity logic).
// Inserts a per-submission event chain, verifies linkage, and confirms the
// append-only trigger rejects tampering. Mirrors routes/supabase/integrity.js.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const { supabaseAdmin } = require('../src/config/supabase');

const genesis = (sid) => crypto.createHash('sha256').update('genesis:' + sid).digest('hex');
const contentHash = (prev, ev) => crypto.createHash('sha256').update(String(prev || '') + JSON.stringify({
  seq: ev.seq, submission_id: ev.submission_id, type: ev.type, category: ev.category, meta: ev.meta, client_ts: ev.client_ts,
})).digest('hex');

(async () => {
  const recruiterId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  await supabaseAdmin.from('profiles').insert([
    { id: recruiterId, email: `rec-${recruiterId.slice(0, 8)}@demo.dev`, first_name: 'Demo', last_name: 'Rec', role: 'recruiter', provider: 'local' },
    { id: candidateId, email: `cand-${candidateId.slice(0, 8)}@demo.dev`, first_name: 'Sam', last_name: 'Lee', role: 'candidate', provider: 'local' },
  ]);
  const { data: ws } = await supabaseAdmin.from('work_samples').insert({
    owner_id: recruiterId, title: 'Integrity smoke', prompt_md: 'x', rubric: { criteria: [{ id: 'a', requirement: 'x', points_possible: 10, weight: 1 }] }, status: 'published',
  }).select().single();
  const { data: sub } = await supabaseAdmin.from('work_sample_submissions').insert({
    work_sample_id: ws.id, candidate_id: candidateId, status: 'in_progress',
  }).select().single();

  // build a chain of events exactly as the route does
  const incoming = [
    { type: 'session_start', category: 'provenance', meta: { ua: 'smoke' }, client_ts: new Date().toISOString() },
    { type: 'tab_hidden', category: 'proctoring', meta: {}, client_ts: new Date().toISOString() },
    { type: 'paste', category: 'provenance', meta: { chars: 240 }, client_ts: new Date().toISOString() },
    { type: 'bot_verdict', category: 'automation', meta: { bot: false }, client_ts: new Date().toISOString() },
    { type: 'session_submit', category: 'provenance', meta: { typed_chars: 80, paste_chars: 240, final_chars: 320 }, client_ts: new Date().toISOString() },
  ];
  let seq = 0, prev = genesis(sub.id);
  const nowIso = new Date().toISOString();
  const rows = incoming.map((e) => {
    seq += 1;
    const ev = { submission_id: sub.id, seq, type: e.type, category: e.category, meta: e.meta, client_ts: e.client_ts, server_ts: nowIso, ts: nowIso };
    ev.prev_hash = prev; ev.row_hash = contentHash(prev, ev); prev = ev.row_hash;
    return ev;
  });
  const { error: insErr } = await supabaseAdmin.from('submission_integrity_events').insert(rows);
  if (insErr) throw new Error('insert chain: ' + insErr.message);

  // read back + verify linkage
  const { data: back } = await supabaseAdmin.from('submission_integrity_events')
    .select('seq, type, prev_hash, row_hash').eq('submission_id', sub.id).order('seq', { ascending: true });
  let p = genesis(sub.id), linked = true;
  for (const e of back) { if ((e.prev_hash || '') !== p) linked = false; p = e.row_hash; }

  console.log('=== INTEGRITY HASH-CHAIN SMOKE ===');
  console.log(`events: ${back.length} | chain linked: ${linked ? 'YES ✅' : 'NO ❌'}`);
  console.log(`head digest: ${back[back.length - 1].row_hash.slice(0, 16)}…`);

  // attempt to tamper -> append-only trigger must reject
  const { error: upErr } = await supabaseAdmin.from('submission_integrity_events')
    .update({ type: 'tampered' }).eq('id', back[0] && back[0].id || rows[0].submission_id);
  // (update by seq to be safe)
  const { error: upErr2 } = await supabaseAdmin.from('submission_integrity_events')
    .update({ row_hash: 'tampered' }).eq('submission_id', sub.id).eq('seq', 1);
  const blocked = (upErr || upErr2);
  console.log(`append-only enforced: ${blocked ? 'YES ✅ (' + String((upErr2 || upErr).message).slice(0, 50) + ')' : 'NO — TRIGGER FAILED ❌'}`);
  console.log(`\n(left as demo seed: submission ${sub.id})`);
  process.exit(linked && blocked ? 0 : 1);
})().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
