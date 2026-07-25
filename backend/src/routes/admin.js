/**
 * Founder admin dashboard — email-OTP gated, owner-only.
 *
 * Flow: POST /api/admin/otp/request (no body — the code is emailed to ADMIN_EMAIL, so there is
 * no email-enumeration surface) → POST /api/admin/otp/verify { code } → { token } (a short-lived
 * JWT with purpose 'admin_session') → GET /api/admin/overview with Authorization: Bearer <token>.
 *
 * Gating: everything 404s unless ADMIN_DASHBOARD_ENABLED === 'true' AND ADMIN_EMAIL and
 * JWT_SECRET are configured (feature OFF by default in code, per the repo flag idiom).
 * Codes: 6 digits from crypto.randomInt, stored ONLY as sha256 (migration 087), 10-minute
 * expiry, single-use, 5 verify attempts per code, 3 code requests per 15 minutes.
 * The code value is never logged.
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const emailService = require('../services/emailService');
const emailTemplates = require('../services/emailTemplates');

const OTP_TTL_MS = 10 * 60 * 1000;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_VERIFY_ATTEMPTS = 5;
const SESSION_TTL = '60m';

const enabled = () =>
  process.env.ADMIN_DASHBOARD_ENABLED === 'true' &&
  !!process.env.ADMIN_EMAIL &&
  !!process.env.JWT_SECRET;

// The whole feature is invisible when off.
router.use((req, res, next) => {
  if (!enabled()) return res.status(404).json({ error: 'Not found' });
  next();
});

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ------------------------------------------------------------------ OTP --- */

router.post('/otp/request', async (req, res) => {
  try {
    const since = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString();
    const { count } = await supabaseAdmin
      .from('admin_otp')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since);
    if ((count || 0) >= MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ error: 'Too many code requests — try again in a few minutes.' });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const { error } = await supabaseAdmin.from('admin_otp').insert({
      code_hash: sha256(code),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    });
    if (error) return res.status(500).json({ error: 'Could not create a code.' });

    const html = emailTemplates.founderNotice({
      heading: 'Your admin verification code',
      intro: 'Use this code to open the Touchstones admin dashboard. It expires in 10 minutes and works once.',
      rows: [['Code', code]],
      footnote: "If you didn't request this, you can ignore it — nothing is accessible without the code.",
      preheader: 'Your Touchstones admin code',
    });
    await emailService.sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: 'Your Touchstones admin code',
      body: `Your Touchstones admin verification code is: ${code}\n\nIt expires in 10 minutes and works once.`,
      html,
      fromName: 'Touchstones',
    });
    // Always the same shape — reveals nothing about configuration.
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: 'Could not send a code.' });
  }
});

router.post('/otp/verify', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(401).json({ error: 'Invalid code.' });

    const { data: rows } = await supabaseAdmin
      .from('admin_otp')
      .select('id, code_hash, expires_at, consumed_at, attempts')
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    const row = rows && rows[0];
    if (!row) return res.status(401).json({ error: 'Invalid or expired code.' });
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts — request a new code.' });
    }

    const ok = crypto.timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(row.code_hash));
    if (!ok) {
      await supabaseAdmin.from('admin_otp').update({ attempts: row.attempts + 1 }).eq('id', row.id);
      return res.status(401).json({ error: 'Invalid or expired code.' });
    }

    await supabaseAdmin.from('admin_otp').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
    const token = jwt.sign({ purpose: 'admin_session' }, process.env.JWT_SECRET, { expiresIn: SESSION_TTL });
    res.json({ token, expires_in: 3600 });
  } catch (_) {
    res.status(401).json({ error: 'Invalid or expired code.' });
  }
});

function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== 'admin_session') throw new Error('wrong purpose');
    next();
  } catch (_) {
    res.status(401).json({ error: 'Admin session required.' });
  }
}

/* ------------------------------------------------------------- Overview --- */

// Every section is independent: one failing query degrades to { error } for that
// section instead of killing the whole dashboard.
async function section(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: e.message || 'query failed' };
  }
}

const daysAgoIso = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

// Bucket ISO timestamps into per-day counts (small volumes; JS-side is fine).
function perDay(rows, field = 'created_at') {
  const out = {};
  for (const r of rows || []) {
    const d = String(r[field] || '').slice(0, 10);
    if (d) out[d] = (out[d] || 0) + 1;
  }
  return out;
}

// One self-contained JSON of an assessment session (submission + question + AI transcript with
// dispositions + integrity events + scores) — ADR-002. Built live from Postgres, so it works with
// or without the Azure archive; this is the "review a test session without copy-paste" surface.
router.get('/assessments/:submissionId/bundle', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.submissionId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: 'invalid submission id' });
    }
    const bundle = await require('../services/assessmentArchiveService').buildBundle(id);
    res.json(bundle);
  } catch (e) {
    // Only a genuinely absent submission is a 404; transient DB failures are 503 so an incident
    // never reads as "this session was erased". Raw driver text stays in the server log.
    console.warn('admin bundle failed:', e.message);
    if (/not found/.test(e.message)) return res.status(404).json({ error: 'submission not found' });
    res.status(503).json({ error: 'could not build the bundle; try again' });
  }
});

router.get('/overview', requireAdmin, async (_req, res) => {
  const [waitlist, users, clients, apiUsage, product, reachouts] = await Promise.all([
    section(async () => {
      const { count: total } = await supabaseAdmin.from('waitlist').select('id', { count: 'exact', head: true });
      const { count: demos } = await supabaseAdmin.from('waitlist').select('id', { count: 'exact', head: true }).eq('kind', 'demo');
      const { data: recent } = await supabaseAdmin
        .from('waitlist')
        .select('email, name, company, kind, referral_source, status, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      const { data: last14 } = await supabaseAdmin
        .from('waitlist').select('created_at').gt('created_at', daysAgoIso(14));
      return { total: total || 0, demoRequests: demos || 0, waitlistOnly: (total || 0) - (demos || 0), perDay14: perDay(last14), recent: recent || [] };
    }),
    section(async () => {
      const { count: total } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true });
      const { count: recruiters } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('account_type', 'recruiter');
      const { count: verified } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('recruiter_status', 'verified');
      const { count: pending } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('recruiter_status', 'pending');
      const { count: new7 } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).gt('created_at', daysAgoIso(7));
      const { count: new30 } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).gt('created_at', daysAgoIso(30));
      const { data: recent } = await supabaseAdmin
        .from('profiles')
        .select('email, first_name, last_name, company, account_type, recruiter_status, provider, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      return { total: total || 0, recruiters: recruiters || 0, verifiedRecruiters: verified || 0, pendingRecruiters: pending || 0, candidates: (total || 0) - (recruiters || 0), new7: new7 || 0, new30: new30 || 0, recent: recent || [] };
    }),
    section(async () => {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('email, company, subscription_plan, subscription_status, current_period_end, created_at')
        .not('subscription_plan', 'is', null)
        .neq('subscription_plan', 'free')
        .order('created_at', { ascending: false });
      const byPlan = {};
      for (const c of data || []) byPlan[c.subscription_plan] = (byPlan[c.subscription_plan] || 0) + 1;
      return { total: (data || []).length, byPlan, clients: data || [] };
    }),
    section(async () => {
      const { data: usage } = await supabaseAdmin
        .from('api_usage')
        .select('day, endpoint, count')
        .gt('day', daysAgoIso(30).slice(0, 10))
        .order('day', { ascending: false });
      let total = 0;
      const byDay = {};
      const byEndpoint = {};
      for (const u of usage || []) {
        total += u.count || 0;
        byDay[u.day] = (byDay[u.day] || 0) + (u.count || 0);
        byEndpoint[u.endpoint] = (byEndpoint[u.endpoint] || 0) + (u.count || 0);
      }
      const { count: activeKeys } = await supabaseAdmin.from('api_keys').select('id', { count: 'exact', head: true }).is('revoked_at', null);
      const { data: keys } = await supabaseAdmin
        .from('api_keys')
        .select('name, prefix, last4, mode, created_at, last_used_at, revoked_at')
        .order('created_at', { ascending: false })
        .limit(20);
      return { calls30d: total, byDay, byEndpoint, activeKeys: activeKeys || 0, keys: keys || [] };
    }),
    section(async () => {
      const { count: screens } = await supabaseAdmin.from('work_samples').select('id', { count: 'exact', head: true }).neq('status', 'archived');
      const { count: screens14 } = await supabaseAdmin.from('work_samples').select('id', { count: 'exact', head: true }).neq('status', 'archived').gt('created_at', daysAgoIso(14));
      const { count: subs } = await supabaseAdmin.from('work_sample_submissions').select('id', { count: 'exact', head: true });
      const { count: scored } = await supabaseAdmin.from('work_sample_submissions').select('id', { count: 'exact', head: true }).eq('status', 'scored');
      const { count: subs14 } = await supabaseAdmin.from('work_sample_submissions').select('id', { count: 'exact', head: true }).gt('created_at', daysAgoIso(14));
      return { screens: screens || 0, screens14: screens14 || 0, submissions: subs || 0, scored: scored || 0, submissions14: subs14 || 0 };
    }),
    section(async () => {
      const { data: demoList } = await supabaseAdmin
        .from('waitlist')
        .select('email, name, company, message, created_at')
        .eq('kind', 'demo')
        .order('created_at', { ascending: false })
        .limit(25);
      const { data: pendingReqs } = await supabaseAdmin
        .from('profiles')
        .select('email, first_name, last_name, company, created_at')
        .eq('recruiter_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(25);
      return { demoRequests: demoList || [], pendingRecruiterRequests: pendingReqs || [] };
    }),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    note: 'Shared database: waitlist/demo rows include production-site signups. Visitor counts live in PostHog/GA (client-side) — see the dashboard links in the UI.',
    waitlist,
    users,
    clients,
    apiUsage,
    product,
    reachouts,
  });
});

/* ------------------------------------------------------------------ Users --- */

// Auth metadata (last sign-in, confirmation) by user id. Small user counts → one page is fine;
// degrade to {} on any failure so the users list still renders from profiles alone.
async function authUserMap() {
  try {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const map = {};
    for (const u of data?.users || []) {
      map[u.id] = { last_sign_in_at: u.last_sign_in_at || null, confirmed: !!u.email_confirmed_at, auth_created_at: u.created_at };
    }
    return map;
  } catch (_) {
    return {};
  }
}

// Full user list with activity counts. ?q= filters email/name/company; ?type= candidate|recruiter.
router.get('/users', requireAdmin, async (req, res) => {
  const out = await section(async () => {
    let q = supabaseAdmin
      .from('profiles')
      .select('id, email, first_name, last_name, company, provider, account_type, recruiter_status, subscription_plan, subscription_status, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (req.query.type) q = q.eq('account_type', String(req.query.type));
    const { data: profiles, error } = await q;
    if (error) throw error;

    const needle = String(req.query.q || '').trim().toLowerCase();
    const filtered = needle
      ? (profiles || []).filter((p) =>
          [p.email, p.first_name, p.last_name, p.company].filter(Boolean).join(' ').toLowerCase().includes(needle))
      : profiles || [];

    const [auth, { data: screens }, { data: subs }] = await Promise.all([
      authUserMap(),
      supabaseAdmin.from('work_samples').select('owner_id').neq('status', 'archived'),
      supabaseAdmin.from('work_sample_submissions').select('candidate_id, status'),
    ]);
    const screenCount = {};
    for (const s of screens || []) screenCount[s.owner_id] = (screenCount[s.owner_id] || 0) + 1;
    const subCount = {};
    const scoredCount = {};
    for (const s of subs || []) {
      subCount[s.candidate_id] = (subCount[s.candidate_id] || 0) + 1;
      if (s.status === 'scored') scoredCount[s.candidate_id] = (scoredCount[s.candidate_id] || 0) + 1;
    }

    return {
      total: filtered.length,
      users: filtered.map((p) => ({
        ...p,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        last_sign_in_at: auth[p.id]?.last_sign_in_at || null,
        confirmed: auth[p.id]?.confirmed ?? null,
        screens: screenCount[p.id] || 0,
        submissions: subCount[p.id] || 0,
        scored: scoredCount[p.id] || 0,
      })),
    };
  });
  res.json(out);
});

// Single-user drill-down: profile + auth + their screens + their submissions + API keys.
router.get('/users/:id', requireAdmin, async (req, res) => {
  const uid = String(req.params.id);
  const [profile, authInfo, screens, submissions, keys] = await Promise.all([
    section(async () => {
      const { data, error } = await supabaseAdmin.from('profiles').select('*').eq('id', uid).single();
      if (error) throw error;
      // Never expose stored integration tokens through the dashboard.
      for (const k of Object.keys(data)) if (/token|secret/i.test(k)) delete data[k];
      return data;
    }),
    section(async () => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
      const u = data?.user;
      return u
        ? { last_sign_in_at: u.last_sign_in_at, confirmed: !!u.email_confirmed_at, auth_created_at: u.created_at, providers: (u.identities || []).map((i) => i.provider) }
        : null;
    }),
    section(async () => {
      const { data } = await supabaseAdmin
        .from('work_samples')
        .select('id, title, role_family, status, created_at')
        .eq('owner_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    }),
    section(async () => {
      const { data } = await supabaseAdmin
        .from('work_sample_submissions')
        .select('id, work_sample_id, status, created_at, submitted_at')
        .eq('candidate_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    }),
    section(async () => {
      const { data } = await supabaseAdmin
        .from('api_keys')
        .select('name, prefix, last4, mode, created_at, last_used_at, revoked_at')
        .eq('account_id', uid);
      return data || [];
    }),
  ]);
  res.json({ profile, auth: authInfo, screens, submissions, apiKeys: keys });
});

/* --------------------------------------------------------------- Activity --- */

// Merged chronological business feed: signups, screens, submissions, waitlist/demo, API keys.
router.get('/activity', requireAdmin, async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = daysAgoIso(days);
  const out = await section(async () => {
    const [pr, ws, subs, wl, keys] = await Promise.all([
      supabaseAdmin.from('profiles').select('email, first_name, last_name, account_type, created_at').gt('created_at', since),
      supabaseAdmin.from('work_samples').select('title, owner_id, status, created_at').gt('created_at', since),
      supabaseAdmin.from('work_sample_submissions').select('status, created_at, submitted_at').gt('created_at', since),
      supabaseAdmin.from('waitlist').select('email, name, company, kind, referral_source, created_at').gt('created_at', since),
      supabaseAdmin.from('api_keys').select('name, prefix, created_at').gt('created_at', since),
    ]);
    const feed = [];
    for (const p of pr.data || []) feed.push({ ts: p.created_at, type: 'signup', label: `${[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email} signed up (${p.account_type || 'candidate'})`, detail: p.email });
    for (const s of ws.data || []) feed.push({ ts: s.created_at, type: 'screen', label: `Screen created: ${s.title || 'Untitled'}`, detail: s.status });
    for (const s of subs.data || []) feed.push({ ts: s.created_at, type: 'submission', label: `Candidate ${s.status === 'scored' ? 'scored' : s.submitted_at ? 'submitted' : 'started'} a screen`, detail: s.status });
    for (const w of wl.data || []) feed.push({ ts: w.created_at, type: w.kind === 'demo' ? 'message' : 'waitlist', label: w.kind === 'demo' ? `Message from ${w.name || w.email}${w.company ? ` (${w.company})` : ''}` : `Waitlist: ${w.email}${w.referral_source ? ` via ${w.referral_source}` : ''}`, detail: w.email });
    for (const k of keys.data || []) feed.push({ ts: k.created_at, type: 'api_key', label: `API key created: ${k.name || k.prefix}`, detail: k.prefix });
    feed.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return { days, events: feed.slice(0, 200) };
  });
  res.json(out);
});

/* -------------------------------------------------------------- Marketing --- */

router.get('/marketing', requireAdmin, async (_req, res) => {
  const out = await section(async () => {
    const since = daysAgoIso(30);
    const { data: wl } = await supabaseAdmin
      .from('waitlist')
      .select('kind, referral_source, created_at, welcomed_at, nurtured_at')
      .gt('created_at', since);
    const bySource = {};
    const byKind = {};
    for (const w of wl || []) {
      const src = w.referral_source || 'direct';
      bySource[src] = (bySource[src] || 0) + 1;
      byKind[w.kind || 'waitlist'] = (byKind[w.kind || 'waitlist'] || 0) + 1;
    }
    const { count: totalWaitlist } = await supabaseAdmin.from('waitlist').select('id', { count: 'exact', head: true });
    return {
      window: '30d',
      totalAllTime: totalWaitlist || 0,
      byKind,
      bySource,
      perDay: perDay(wl),
      welcomed: (wl || []).filter((w) => w.welcomed_at).length,
      nurtured: (wl || []).filter((w) => w.nurtured_at).length,
    };
  });
  res.json(out);
});

/* -------------------------------------------------------------- Email log --- */

// Recent transactional sends with delivery status, straight from Resend (source of truth).
router.get('/email-log', requireAdmin, async (_req, res) => {
  const out = await section(async () => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { emails: [], note: 'RESEND_API_KEY not configured' };
    const r = await fetch('https://api.resend.com/emails?limit=25', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`Resend ${r.status}`);
    const json = await r.json();
    const emails = (json?.data || []).map((e) => ({
      to: Array.isArray(e.to) ? e.to.join(', ') : e.to,
      subject: e.subject,
      status: e.last_event || e.status || 'sent',
      created_at: e.created_at,
    }));
    const statusCounts = {};
    for (const e of emails) statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
    return { emails, statusCounts };
  });
  res.json(out);
});

module.exports = router;
