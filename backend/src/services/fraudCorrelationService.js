/**
 * Cross-session correlation service (NON-BIOMETRIC, advisory-only).
 * --------------------------------------------------------------------------
 * Given ONE submission, find other submissions TO THE SAME RECRUITER that share a
 * coarse, hashed session context (ip_hash / ip_prefix / ua_hash) but belong to a
 * DIFFERENT candidate. That pattern — many "candidates" arriving from one device or
 * one /24 network — is the classic one-person-many-identities / collusion signal the
 * "industrial-scale fake candidate" trend is about.
 *
 * Hard product posture (do not soften):
 *   - This is a recruiter REVIEW signal, never an auto-reject and never a verdict.
 *   - severity is capped at 'review' (info | review). Nothing higher exists here.
 *   - We surface explainable flags ("same device as N other candidates"), never the
 *     word fraud/cheater. The recruiter decides; we only point.
 *   - No biometrics, ever. Only device/IP/timing context that the capture layer hashed.
 *
 * Scope of the join is the OWNING RECRUITER's submissions only. We resolve the
 * submission -> work_sample -> owner, then look at session_fingerprints for ALL of
 * that owner's submissions. Comparing across recruiters would leak one tenant's data
 * into another and is meaningless (different candidate pools), so we never do it.
 *
 * Everything runs through the service-role client (fingerprints are not candidate-
 * readable, and we read across the recruiter's whole pool). The CALLING ROUTE is
 * responsible for the owner gate; this service assumes it has already passed.
 *
 * Degrades silently: a missing session_fingerprints table, no fingerprint for the
 * subject submission, or any query error yields an EMPTY (clean) result rather than
 * throwing — a correlation layer must never break the recruiter's review page.
 */
const { supabaseAdmin } = require('../config/supabase');

// Human-readable label for a candidate from a profiles row (matches proof.js).
function candidateLabel(profile) {
  if (!profile) return null;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  return name || profile.email || null;
}

// A "shared dimension" between two fingerprints, in plain words for the recruiter.
// Order matters for severity: a shared exact device/IP is a stronger nudge than a
// shared /24 network (which can just be one office or campus).
const SHARED_LABELS = {
  ip_hash: 'same network address',
  ua_hash: 'same device / browser',
  ip_prefix: 'same local network',
};

/**
 * @param {string} submissionId
 * @returns {Promise<{ flags: Array<{kind:string, detail:string, severity:'info'|'review'}>,
 *                     correlated: Array<{submission_id:string, candidate:string|null, shared:string[]}> }>}
 */
async function getCorrelations(submissionId) {
  const EMPTY = { flags: [], correlated: [] };
  try {
    // 1) The subject submission's fingerprint. No row -> nothing to correlate (clean).
    const { data: self, error: selfErr } = await supabaseAdmin
      .from('session_fingerprints')
      .select('submission_id, ip_hash, ip_prefix, ua_hash')
      .eq('submission_id', submissionId)
      .maybeSingle();
    // Missing table / RLS / any error -> degrade silently to clean.
    if (selfErr || !self) return EMPTY;

    // 2) Resolve the owning recruiter + this submission's candidate, so we only compare
    //    within the recruiter's pool and only across DIFFERENT candidates. We resolve the
    //    owner in two plain steps (submission -> work_sample -> owner) rather than an
    //    embedded join, matching the codebase's existing .in()/.eq() query style.
    const { data: subRow, error: subErr } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, candidate_id, work_sample_id')
      .eq('id', submissionId)
      .maybeSingle();
    if (subErr || !subRow || !subRow.work_sample_id) return EMPTY;
    const selfCandidate = subRow.candidate_id || null;

    const { data: subWs, error: wsErr } = await supabaseAdmin
      .from('work_samples')
      .select('id, owner_id')
      .eq('id', subRow.work_sample_id)
      .maybeSingle();
    if (wsErr || !subWs || !subWs.owner_id) return EMPTY;
    const ownerId = subWs.owner_id;

    // 3) All of this recruiter's submissions (their candidate pool): the recruiter's
    //    work_samples, then every submission to them.
    const { data: ownerWs, error: ownerWsErr } = await supabaseAdmin
      .from('work_samples')
      .select('id')
      .eq('owner_id', ownerId)
      .limit(2000);
    if (ownerWsErr || !ownerWs || !ownerWs.length) return EMPTY;
    const ownerWsIds = ownerWs.map((w) => w.id);

    const { data: ownerSubs, error: ownerErr } = await supabaseAdmin
      .from('work_sample_submissions')
      .select('id, candidate_id')
      .in('work_sample_id', ownerWsIds)
      .limit(2000);
    if (ownerErr || !ownerSubs || ownerSubs.length < 2) return EMPTY;

    const candidateById = {};
    const otherIds = [];
    for (const s of ownerSubs) {
      candidateById[s.id] = s.candidate_id || null;
      if (s.id !== submissionId) otherIds.push(s.id);
    }
    if (!otherIds.length) return EMPTY;

    // 4) Fingerprints for the recruiter's OTHER submissions, then keep only those that
    //    share a dimension with the subject AND belong to a different candidate_id.
    const { data: others, error: fpErr } = await supabaseAdmin
      .from('session_fingerprints')
      .select('submission_id, ip_hash, ip_prefix, ua_hash')
      .in('submission_id', otherIds)
      .limit(2000);
    if (fpErr || !others || !others.length) return EMPTY;

    const matches = []; // { submission_id, candidate_id, shared:string[] }
    for (const o of others) {
      const otherCandidate = candidateById[o.submission_id] || null;
      // The whole point is DIFFERENT identities sharing one context. Same candidate
      // (a resume / second attempt) is expected and NOT a signal.
      if (otherCandidate && selfCandidate && otherCandidate === selfCandidate) continue;

      const shared = [];
      if (self.ip_hash && o.ip_hash && self.ip_hash === o.ip_hash) shared.push('ip_hash');
      if (self.ua_hash && o.ua_hash && self.ua_hash === o.ua_hash) shared.push('ua_hash');
      // /24 prefix is the weakest signal; only count it when it ADDS information
      // beyond an already-shared exact IP hash.
      if (
        self.ip_prefix && o.ip_prefix && self.ip_prefix === o.ip_prefix &&
        !shared.includes('ip_hash')
      ) {
        shared.push('ip_prefix');
      }
      if (shared.length) matches.push({ submission_id: o.submission_id, candidate_id: otherCandidate, shared });
    }
    if (!matches.length) return EMPTY;

    // 5) Enrich candidate display names (service-role; profiles aren't recruiter-readable
    //    under RLS — same enrichment pattern as proof.js activity).
    const candIds = [...new Set(matches.map((m) => m.candidate_id).filter(Boolean))];
    let labelByCand = {};
    if (candIds.length) {
      const { data: profs } = await supabaseAdmin
        .from('profiles').select('id, email, first_name, last_name').in('id', candIds);
      labelByCand = Object.fromEntries((profs || []).map((p) => [p.id, candidateLabel(p)]));
    }

    const correlated = matches.map((m) => ({
      submission_id: m.submission_id,
      candidate: m.candidate_id ? (labelByCand[m.candidate_id] || null) : null,
      shared: m.shared.map((k) => SHARED_LABELS[k] || k),
    }));

    // 6) Explainable, capped-at-'review' flags. Distinct OTHER candidates is the count
    //    that matters (10 submissions from one device is one signal if it's one person;
    //    it's a real signal when it's many DIFFERENT identities).
    const distinctOtherCandidates = new Set(
      matches.map((m) => m.candidate_id).filter(Boolean)
    ).size;
    const sharesExactDevice = matches.some((m) => m.shared.includes('ua_hash'));
    const sharesExactIp = matches.some((m) => m.shared.includes('ip_hash'));
    const sharesOnlyNetwork = !sharesExactDevice && !sharesExactIp &&
      matches.some((m) => m.shared.includes('ip_prefix'));

    const flags = [];
    const others_n = distinctOtherCandidates || matches.length;
    const candWord = others_n === 1 ? 'candidate' : 'candidates';

    if (sharesExactDevice) {
      flags.push({
        kind: 'shared_device',
        detail: `Same device/browser as ${others_n} other ${candWord} you screened — worth a look.`,
        severity: 'review',
      });
    }
    if (sharesExactIp) {
      flags.push({
        kind: 'shared_ip',
        detail: `Same network address as ${others_n} other ${candWord} — could be a shared office, worth a glance.`,
        severity: 'review',
      });
    }
    if (sharesOnlyNetwork) {
      // Network-only overlap is the weakest signal: an office, campus or VPN explains it.
      flags.push({
        kind: 'shared_network',
        detail: `Connected from the same local network as ${others_n} other ${candWord} — often just a shared office.`,
        severity: 'info',
      });
    }

    return { flags, correlated };
  } catch (_e) {
    // A correlation layer must never break the review page — fail clean.
    return EMPTY;
  }
}

module.exports = { getCorrelations };
