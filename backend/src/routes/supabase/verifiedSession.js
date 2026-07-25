/**
 * Verified-session CONSENT routes (ADR-001 Phase 2) — /api/verified-session/...
 *
 * SCOPE: consent only. NO media capture/upload/storage, NO Azure Blob, NO transcription — those are
 * Phase 3 (verified_sessions / session_media). This is proof_consent's first real enforcement site.
 *
 * KILL-SWITCH: the whole surface 404s unless ENABLE_VERIFIED_SESSION==='true' (the liveness.js
 * idiom — surface invisible, not 503-deferred). Boot-time constant; flipping needs a restart.
 *
 * SECURITY / PRIVACY invariants (ADR §8, Principle 7):
 *   • Grants for capture modalities are SERVER-MEDIATED (service-role insert) with a SERVER-stamped
 *     consent_copy_hash — a client can never forge a "granted" row without the rendered copy.
 *   • Fail-closed: a grant is rejected unless the client is on the current consent-copy version.
 *   • Consent is candidate-scoped. A decline or withdrawal is recorded candidate-side ONLY and is
 *     NEVER surfaced to a recruiter or any external system — no declined signal exists anywhere a
 *     decision-maker can see it.
 *   • Never log consent payloads/copy — only ids + states. Chain-event meta carries {modality,decision}.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const { supabaseAdmin } = require('../../config/supabase');

// Boot-time kill-switch (strict === 'true', never the !== 'false' polarity — ADR §15).
const ENABLED = process.env.ENABLE_VERIFIED_SESSION === 'true';

// Interim Phase 2–4 gate (removed in Phase 5 when the per-screen recruiter toggles land): a
// comma-separated allowlist of dev work_sample ids the offer/consent is permitted for. Empty =>
// no allowlist restriction (dev). ADR §15 VERIFIED_SESSION_SCREEN_ALLOWLIST.
const SCREEN_ALLOWLIST = new Set(
  String(process.env.VERIFIED_SESSION_SCREEN_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean),
);

// Capture modalities that require server-mediated consent (ADR §8/§11). 'video/audio/typed' in the
// product copy map to these: video→camera, audio→microphone, the spoken walkthrough→walkthrough_recording;
// the typed alternative needs no capture consent.
const CAPTURE_MODALITIES = new Set(['camera', 'microphone', 'walkthrough_recording']);

// The current consent copy — the SERVER owns the canonical STRUCTURED copy (design (b)): an ordered
// array of typed blocks the FE renders verbatim. The server stamps a SHA-256 of the canonical JSON on
// every grant, so a grant can never exist without the exact copy the candidate saw (Phase 2
// acceptance: "no grant row without the server-rendered copy hash"). When counsel replaces the
// wording, it is one edit here + a `CONSENT_COPY_VERSION` bump (the fail-closed 409 mechanism).
// Block types: heading | body | list ({title, items[]}) | ack ({id, label} — a distinct affirmative
// act; ADR §8 requires two: collect + share).
const CONSENT_COPY_VERSION = 'vs-2026-07-01';
const CONSENT_COPY_BLOCKS = [
  { type: 'heading', text: 'Before anything is recorded' },
  { type: 'body', text: 'This walkthrough is optional. Declining never affects your score or consideration — you can type your walkthrough instead.' },
  { type: 'body', text: 'What is captured: your camera and/or microphone during a short (~90 second) walkthrough only — never the whole session. You choose the format and can stop at any time.' },
  { type: 'list', title: 'What we never do', items: [
    'No facial recognition',
    'No identity matching',
    'No voiceprint or speaker recognition',
    'No emotion or attention analysis',
    'No automated decision is ever made from this recording — a named human reviews it',
  ] },
  { type: 'body', text: 'A named human on the hiring team watches or reads it solely to confirm you completed the session and can explain your approach. You can withdraw at any time; your recording and transcript are then deleted.' },
  { type: 'detail', items: [
    { title: 'What\u2019s recorded', body: 'Your spoken (or typed) walkthrough \u2014 about 90 seconds. The camera and mic are used only during this step, never the whole session.' },
    { title: 'Why', body: 'A named human reviewer watches or reads it solely to confirm you completed the session and can explain your approach.' },
    { title: 'How long it\u2019s kept', body: 'The recording auto-deletes when the reviewer finishes (or within 90 days). A transcript and their review note are kept as the hiring record. Removal from backups completes within 30 days.' },
    { title: 'Storage & your rights', body: 'Encrypted in transit and at rest. You can access, download, or delete your recording at any time.' },
  ] },
  { type: 'ack', id: 'collect', label: 'I consent to Touchstones recording this optional walkthrough.' },
  { type: 'ack', id: 'share', label: 'I consent to sharing this recording with the hiring team for this role.' },
];

// Derived plain-text join (backward-compat / accessibility fallback).
const CONSENT_COPY_TEXT = CONSENT_COPY_BLOCKS.map((b) => {
  if (b.type === 'list') return [b.title, ...b.items].filter(Boolean).join('\n');
  if (b.type === 'detail') return b.items.map((i) => `${i.title}: ${i.body}`).join('\n');
  return b.text || b.label || '';
}).filter(Boolean).join('\n');

// Deterministic canonicalization for the hash: JSON with recursively SORTED keys, so the hash is
// stable regardless of authored key order and covers EXACTLY what the client renders (version + blocks).
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
const CONSENT_COPY_CANONICAL = stableStringify({ consent_version: CONSENT_COPY_VERSION, blocks: CONSENT_COPY_BLOCKS });
const CONSENT_COPY_HASH = crypto.createHash('sha256').update(CONSENT_COPY_CANONICAL).digest('hex');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Kill-switch FIRST (before auth): when the flag is off the surface simply does not exist.
router.use((req, res, next) => {
  if (!ENABLED) return fail(res, 404, 'verified sessions are not enabled');
  next();
});
router.use(supabaseAuth);

// Best-effort integrity-chain event (never blocks the consent decision). Meta is ids/states ONLY —
// never the consent copy or any payload. category 'walkthrough', source 'server_observed' (server
// code is the caller; anything a candidate could self-author would carry zero trust weight).
async function appendConsentEvent({ submissionId, type, modality, decision }) {
  try {
    await supabaseAdmin.rpc('append_integrity_event', {
      p_submission_id: submissionId,
      p_type: type, // consent_granted | consent_declined | consent_withdrawn
      p_category: 'walkthrough',
      p_meta: { modality, decision },
      p_client_ts: null,
      p_source: 'server_observed',
    });
  } catch (e) {
    console.warn('verifiedSession: chain append failed (non-blocking):', e.message);
  }
}

// Resolve + authorize the submission the caller claims (RLS-scoped read = the ownership gate), and
// honor the interim screen allowlist. Returns the submission row or null (having already responded).
async function assertSubmission(req, res, submissionId) {
  if (!isUUID(submissionId)) { fail(res, 400, 'submission_id (uuid) required'); return null; }
  const { data: sub } = await req.user.supabase
    .from('work_sample_submissions').select('id, work_sample_id, candidate_id').eq('id', submissionId).single();
  if (!sub) { fail(res, 404, 'submission not found or not accessible'); return null; }
  if (sub.candidate_id && sub.candidate_id !== req.user.id) { fail(res, 403, 'not your submission'); return null; }
  if (SCREEN_ALLOWLIST.size && !SCREEN_ALLOWLIST.has(sub.work_sample_id)) {
    fail(res, 403, 'verified session is not enabled for this screen'); return null;
  }
  return sub;
}

// GET /api/verified-session/consent-copy — the canonical STRUCTURED consent copy the FE renders
// against (so a grant it later posts matches the server's hashed copy). `blocks` is the source of
// truth; `text` is the derived plain-text join. The hash itself is never exposed.
router.get('/consent-copy', (req, res) => {
  res.json({ consent_version: CONSENT_COPY_VERSION, blocks: CONSENT_COPY_BLOCKS, text: CONSENT_COPY_TEXT });
});

// POST /api/verified-session/consent — record a consent DECISION (grant | decline) for a modality,
// tied to the submission. Grants are service-role inserts with the SERVER-stamped copy hash + context
// (fail-closed: the client can't supply the hash, and must be on the current copy version). A decline
// records candidate-side state + a chain event and is never recruiter-visible.
router.post('/consent', async (req, res) => {
  try {
    const body = req.body || {};
    // Accept a single `modality` OR a `modalities` array — the ADR's unified release covers all
    // captured modalities in one instrument, so the FE can grant camera+microphone+walkthrough in
    // one call; we still store one per-modality row (the 025 ledger shape). De-dupe + validate.
    const mods = [...new Set(Array.isArray(body.modalities) ? body.modalities : (body.modality ? [body.modality] : []))];
    if (!mods.length || !mods.every((m) => CAPTURE_MODALITIES.has(m))) {
      return fail(res, 400, 'modality/modalities must be one or more of camera|microphone|walkthrough_recording');
    }
    const decision = body.decision || 'granted';
    if (decision !== 'granted' && decision !== 'declined') return fail(res, 400, "decision must be 'granted' or 'declined'");
    // Fail closed: a grant must be made against the CURRENT server copy version.
    if (decision === 'granted' && body.consent_version !== CONSENT_COPY_VERSION) {
      return fail(res, 409, 'consent copy is out of date — reload the consent screen');
    }
    const sub = await assertSubmission(req, res, body.submission_id);
    if (!sub) return;

    // Service-role insert (034/025-hardening pattern): copy hash + context are SERVER-stamped, never
    // client-supplied. One row per modality; context holds only non-PII provenance.
    const copyHash = decision === 'granted' ? CONSENT_COPY_HASH : null;
    const rows = mods.map((m) => ({
      candidate_id: req.user.id,
      submission_id: body.submission_id,
      modality: m,
      decision,
      consent_version: CONSENT_COPY_VERSION,
      consent_copy_hash: copyHash,
      context: { via: 'verified_session' },
    }));
    const { data, error } = await supabaseAdmin
      .from('proof_consent').insert(rows)
      .select('id, modality, decision, consent_version, granted_at, withdrawn_at');
    if (error) return fail(res, 500, error.message);

    for (const m of mods) {
      await appendConsentEvent({
        submissionId: body.submission_id, modality: m, decision,
        type: decision === 'granted' ? 'consent_granted' : 'consent_declined',
      });
    }
    return res.status(201).json({ consent: data || [] });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/verified-session/consent?submission_id=&modality= — candidate reads their CURRENT consent
// state (read-back for the candidate flow). Candidate-scoped via RLS; returns the rows + a derived
// per-modality state (granted | declined | withdrawn).
router.get('/consent', async (req, res) => {
  try {
    const submission_id = req.query.submission_id;
    const modality = req.query.modality;
    if (!isUUID(submission_id)) return fail(res, 400, 'submission_id (uuid) required');
    let q = req.user.supabase
      .from('proof_consent')
      .select('id, modality, decision, consent_version, granted_at, withdrawn_at, created_at')
      .eq('candidate_id', req.user.id).eq('submission_id', submission_id)
      .order('created_at', { ascending: false });
    if (modality) q = q.eq('modality', modality);
    const { data, error } = await q;
    if (error) return fail(res, 500, error.message);
    const state = {};
    for (const r of data || []) {
      if (state[r.modality]) continue; // desc order → first seen is latest
      state[r.modality] = r.decision === 'declined' ? 'declined' : (r.withdrawn_at ? 'withdrawn' : 'granted');
    }
    return res.json({ consent: data || [], state });
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/verified-session/consent/withdraw — withdraw a prior grant (candidate). Sets withdrawn_at
// NULL->now on the candidate's own active grant, via service-role (scoped to their own row); the DB
// trigger independently blocks any other candidate mutation on direct PostgREST.
router.post('/consent/withdraw', async (req, res) => {
  try {
    const { submission_id, modality } = req.body || {};
    if (!isUUID(submission_id)) return fail(res, 400, 'submission_id (uuid) required');
    // modality is OPTIONAL: omit it to withdraw ALL active grants for the submission (the
    // "delete my recording" one-click); pass one to withdraw just that modality.
    if (modality && !CAPTURE_MODALITIES.has(modality)) {
      return fail(res, 400, 'modality must be camera|microphone|walkthrough_recording');
    }
    let q = supabaseAdmin
      .from('proof_consent')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('candidate_id', req.user.id).eq('submission_id', submission_id)
      .eq('decision', 'granted').is('withdrawn_at', null);
    if (modality) q = q.eq('modality', modality);
    const { data, error } = await q.select('id, modality, decision, withdrawn_at');
    if (error) return fail(res, 500, error.message);
    if (!Array.isArray(data) || !data.length) return fail(res, 404, 'no active consent to withdraw');
    for (const r of data) {
      await appendConsentEvent({ submissionId: submission_id, modality: r.modality, decision: 'withdrawn', type: 'consent_withdrawn' });
    }
    return res.json({ withdrawn: data });
  } catch (e) { fail(res, 500, e.message); }
});

// Whether the verified-session offer should render for a given screen: flag on AND (interim) the
// screen is allowlisted (empty allowlist = all screens, dev). Mirrors the route's own gate so the FE
// can gate the offer without guessing the backend allowlist. Consumed by proof.js getSubmission.
function isOfferable(workSampleId) {
  return ENABLED && (SCREEN_ALLOWLIST.size === 0 || SCREEN_ALLOWLIST.has(workSampleId));
}

module.exports = router;
module.exports.isOfferable = isOfferable;
