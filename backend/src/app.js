// Load polyfills first
require('./polyfill');

// Load .env file with better error handling
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Try to load .env file
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  console.log(`Loading environment variables from ${envPath}`);
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  } else {
    console.log('Successfully loaded environment variables from .env file');
    // Log key environment variables (without showing full values)
    const envVars = ['NODE_ENV', 'PORT', 'MONGODB_URI', 'JOB_SEARCH_API_KEY'];
    envVars.forEach(varName => {
      if (process.env[varName]) {
        if (varName.includes('KEY') || varName.includes('SECRET')) {
          // Don't log full API keys or secrets
          console.log(`${varName} is set (value hidden)`);
        } else if (varName === 'MONGODB_URI') {
          console.log(`${varName} is set (URI hidden)`);
        } else {
          console.log(`${varName} = ${process.env[varName]}`);
        }
      } else {
        console.log(`${varName} is NOT set`);
      }
    });
  }
} else {
  console.warn(`No .env file found at ${envPath}`);
}

// Datadog LLM Observability — init right after .env is loaded so DD_* vars are visible.
// No-op unless DD_LLMOBS_ENABLED=1. Traces the scoring engine (grader / assist / direction).
require('./telemetry/llmObs');

// Boot-time secret assertion (SYSTEM_DESIGN #2): refuse to start in production
// with weak/unset trust-critical secrets. Warns (does not exit) in dev/test.
require('./config/assertEnv')();

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { logger, initSentry, captureException, httpLogger } = require('./config/observability');
const { supabaseAdmin } = require('./config/supabase');

// Optional Sentry (no-op unless SENTRY_DSN is set).
initSentry();
const passport = require('./config/passport');
const session = require('express-session');

// Supabase is the only data layer. The legacy MongoDB routes/models/connection have
// been removed (see SUPABASE_MIGRATION.md). Routes always load from ./routes/supabase.
const routesPath = './routes/supabase';
console.log('Database mode: SUPABASE');

// Feature flags for the PAID RECRUITER SIDE (autopilot/warm-outreach + sourcing).
// Per the two-sided direction (TODO/strategy/*) these are core product and default ON;
// the flag is an ops kill-switch (set ENABLE_* = "false" to serve 503). NOTE: some
// autopilot interview-scheduling / follow-up-queue sub-endpoints are still un-ported to
// Supabase and respond as "deferred" no-ops until ported.
// ENABLE_SUITE (Phase 1) — the single master flag. When false (the shipping config),
// the app boots into the ONE loop: Dashboard → Author → Candidate → Result, and all
// non-wedge surface (sourcing, autopilot, jobs, pipeline-as-CRM, filters, …) is gated
// off (503). Defaults ON in code so the existing suite tests still run; set
// ENABLE_SUITE=false in the deployed env. The sub-flags below narrow further within the
// suite and can never re-enable anything once the suite itself is off.
const ENABLE_MARKETING_ASSISTANT = process.env.ENABLE_MARKETING_ASSISTANT === 'true'; // public marketing chatbox (off by default)
const ENABLE_MVP_SKELETONS = process.env.ENABLE_MVP_SKELETONS === 'true'; // July MVP scaffold, off by default
const ENABLE_SUITE = process.env.ENABLE_SUITE !== 'false';
const ENABLE_AUTOPILOT = ENABLE_SUITE && process.env.ENABLE_AUTOPILOT !== 'false';
const ENABLE_SOURCING = ENABLE_SUITE && process.env.ENABLE_SOURCING !== 'false';

// Load routes from appropriate path
const authRoutes = require(`${routesPath}/auth`);
const candidateRoutes = require(`${routesPath}/candidates`);
const analyticsRoutes = require(`${routesPath}/analytics`);
const integrationsRoutes = require(`${routesPath}/integrations`);
const webhooksRoutes = require(`${routesPath}/webhooks`);
const feedbackRoutes = require(`${routesPath}/feedback`);
const proofRoutes = require(`${routesPath}/proof`);
const assessmentRoutes = require(`${routesPath}/assessments`); // assessment-template library + recruiter custom templates
const ashbyPartnerRoutes = require('./routes/integrations/ashby'); // Ashby Assessments partner endpoints (Ashby -> us)
const ashbySettingsRoutes = require(`${routesPath}/ashbySettings`); // Ashby integration settings (console -> stores outbound key)
const greenhouseSettingsRoutes = require(`${routesPath}/greenhouseSettings`); // Greenhouse Harvest v3 settings (console -> stores encrypted credential)
const greenhousePartnerRoutes = require('./routes/integrations/greenhouse'); // Greenhouse Assessments partner endpoints (Greenhouse -> us), flag-gated
const outcomeRoutes = require(`${routesPath}/outcomes`); // outcome-label flywheel (calibration moat)
const credentialRoutes = require(`${routesPath}/credentials`); // portable "Touchstones-verified" credential
const integrityRoutes = require(`${routesPath}/integrity`);
const collabRoutes = require(`${routesPath}/collab`);
const commentsRoutes = require(`${routesPath}/comments`);
const notificationsRoutes = require(`${routesPath}/notifications`);
const clientReviewRoutes = require(`${routesPath}/clientReviews`);
// D-2 (codebase-scan): autoApplyRoutes require removed — the router was never mounted (/api/autoapply
// is an inline 410). routes/supabase/autoApply.js + services/autoApplyService.js deleted.
const paymentsRoutes = require(`${routesPath}/payments`);
const apiKeysRoutes = require(`${routesPath}/apiKeys`); // Verify API Phase 1: console key management (behind supabaseAuth)
const apiWebhooksRoutes = require(`${routesPath}/apiWebhooks`); // Verify API Phase 3: console webhook-endpoint management
const webhookService = require('./services/webhookService'); // Verify API Phase 3: outbound signed-webhook delivery worker
const { apiKeyAuth } = require('./middleware/apiKeyAuth'); // Verify API Phase 2: /v1 public-surface auth
const verifyRoutes = require(`${routesPath}/verify`); // Verify API Phase 2: POST /v1/verifications + reads
const deliveryRoutes = require(`${routesPath}/delivery`); // score delivery: Slack + Ashby/Greenhouse write-back
const statusRoutes = require('./routes/status');
const requestDemoRoutes = require('./routes/requestDemo'); // public marketing form (db-agnostic)
const emailUnsubscribeRoutes = require('./routes/emailUnsubscribe'); // CAN-SPAM opt-out (public, token-gated)
const assistantRoutes = require('./routes/assistant'); // public marketing "Ask Touchstones" chatbox (ENABLE_MARKETING_ASSISTANT)
const adminRoutes = require('./routes/admin'); // founder admin dashboard (email-OTP gated; ADMIN_DASHBOARD_ENABLED)
const hooksRoutes = require('./routes/supabase/hooks'); // Supabase DB webhook -> Resend audience + welcome
const verifiedSessionRoutes = require('./routes/supabase/verifiedSession'); // ADR-001 Phase 2 consent (ENABLE_VERIFIED_SESSION; 404s off)
const mvpSkeletonRoutes = require(`${routesPath}/mvpSkeleton`);

const app = express();

// Exactly one proxy hop in front of us (Render, or Azure Container Apps ingress).
// Trust that single hop so req.ip is the real client and rate-limit buckets key
// per-client, not per-proxy. NOT `true` (that would trust a spoofed X-Forwarded-For).
app.set('trust proxy', 1);

// Security headers (SYSTEM_DESIGN #12). The assessment surface is embeddable only
// by us; block third-party framing (clickjacking) and lock cross-origin defaults.
app.use(helmet({
  contentSecurityPolicy: false, // CSP is tuned at the edge/CDN for the SPA; avoid breaking it here.
  crossOriginEmbedderPolicy: false,
}));
app.use(httpLogger());

// Router that returns 503 for any request to a deferred feature surface.
const deferredRouter = (name) => {
  const r = express.Router();
  r.use((req, res) => res.status(503).json({
    error: `${name} is not available in this deployment.`,
    deferred: true
  }));
  return r;
};

// CORS configuration. Env-driven so production domains don't require a code change:
// FRONTEND_URL (the deployed app) + any comma-separated CORS_EXTRA_ORIGINS are added.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...String(process.env.CORS_EXTRA_ORIGINS || '').split(',').map(s => s.trim()),
  'https://touchstones.ai',
  'https://www.touchstones.ai',
  'https://app.touchstones.ai',
  'https://touchstone-mu.vercel.app',
  'https://touchstone-ayushjain10s-projects.vercel.app',
  'https://touchstone-api.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3002',
].filter(Boolean);

// SYSTEM_DESIGN #12: bearer tokens (not cookies) authenticate the API, so disable
// CORS credentials — this removes the cookie/CSRF surface entirely.
app.use(cors({
  origin: allowedOrigins,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

// SYSTEM_DESIGN #5: key the AI limiter PER ACCOUNT (by bearer token), not globally,
// so one account can't exhaust the shared LLM budget for everyone. A hard per-account
// daily scoring quota + global daily Anthropic spend ceiling live in the scoring path
// (services/spendGuard.js), checked before each model call.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  // We key by an opaque hash of the bearer token (per-account), falling back to IP for
  // unauthenticated requests; the IPv6-normalization helper isn't needed for the hash path.
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const h = req.headers.authorization;
    if (h && h.startsWith('Bearer ')) {
      return 'tok:' + crypto.createHash('sha256').update(h.slice(7)).digest('hex').slice(0, 24);
    }
    return req.ip;
  },
  message: { error: 'AI request limit reached, please try again later' }
});

// /api/proof is a MIXED router: most of it is non-AI (GET /activity, /metrics, /submissions,
// /scores, POST /run, /assign, /invite, /submit) and only four endpoints actually call an LLM
// (ai-assist, score, baseline, score-direction). Applying aiLimiter to the WHOLE router meant
// normal usage (loading Activity, running code, viewing results) exhausted the 30/15min AI
// bucket and then EVERY proof endpoint 429'd with "AI request limit reached" — breaking Activity,
// candidate run, and reads. This gate applies aiLimiter ONLY to the genuine LLM endpoints; the
// rest stay under the generous generalLimiter (200/15min).
const PROOF_AI_ENDPOINTS = /\/(ai-assist|baseline|score|score-direction)$/;
const proofAiLimiter = (req, res, next) =>
  (PROOF_AI_ENDPOINTS.test((req.originalUrl || req.url).split('?')[0]) ? aiLimiter(req, res, next) : next());
// Same scoping for the live AI probe: only the two LLM-driving endpoints (probe/start generates
// a question, .../answer scores it) are AI — the candidate's probe view and the recruiter's
// latest-probe/probe reads must NOT share the AI bucket, or normal viewing spuriously 429s.
const INTERVIEW_AI_ENDPOINTS = /\/(probe\/start|answer)$/;
const interviewAiLimiter = (req, res, next) =>
  (INTERVIEW_AI_ENDPOINTS.test((req.originalUrl || req.url).split('?')[0]) ? aiLimiter(req, res, next) : next());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' }
});

// Verify API `/v1` per-KEY limiter (aiLimiter clone). Keyed by the resolved account (set by
// apiKeyAuth, which runs FIRST on the /v1 mount), so one account can't exhaust another's budget.
// Test-mode keys get a higher ceiling (sandbox iteration). Responds with the Verify API error
// envelope + Retry-After. `/v1` has its OWN limiter — it never inherits the /api limiters.
const perKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    const isTest = req.apiAccount && req.apiAccount.mode === 'test';
    return Number(
      isTest
        ? (process.env.VERIFY_RATE_LIMIT_MAX_TEST || 120)
        : (process.env.VERIFY_RATE_LIMIT_MAX || 60),
    );
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => 'vk:' + (req.apiAccount ? req.apiAccount.accountId : req.ip),
  handler: (req, res) => {
    res.setHeader('Retry-After', '60');
    res.status(429).json({
      error: { type: 'rate_limit', message: 'Rate limit exceeded. Please retry later.' },
    });
  },
});

// Reads (GET status/audit/report) are cheap DB lookups that clients POLL — they must not share
// the ingest's strict bucket, or a normal poller 429s mid-flow. Give reads their own GENEROUS
// per-key limiter (still bounded, so an authenticated key can't poll unboundedly), and keep the
// strict perKeyLimiter for the cost-bearing POST ingest only.
const perKeyReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.VERIFY_READ_RATE_LIMIT_MAX || 600),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => 'vkr:' + (req.apiAccount ? req.apiAccount.accountId : req.ip),
  handler: (req, res) => {
    res.setHeader('Retry-After', '30');
    res.status(429).json({
      error: { type: 'rate_limit', message: 'Rate limit exceeded. Please retry later.' },
    });
  },
});
// The POST ingest runs the LLM scorer (the billable unit) → strict limiter; the GET reads →
// generous read limiter. The only POST under /v1 is /verifications.
const verifyKeyLimiter = (req, res, next) =>
  (req.method === 'POST' ? perKeyLimiter : perKeyReadLimiter)(req, res, next);

// Verify API usage metering: fire-and-forget per-(account, endpoint) counter bump via the
// SECURITY DEFINER increment_api_usage RPC (migration 041). Never blocks or fails the request.
// Only the POST ingest is a billable "verification" — metering a GET poll would inflate usage.
const usageMetering = (req, res, next) => {
  if (req.method !== 'POST') return next();
  try {
    supabaseAdmin
      .rpc('increment_api_usage', { p_account: req.apiAccount.accountId, p_endpoint: 'verifications' })
      .then(({ error }) => { if (error) console.warn('usageMetering bump failed:', error.message); })
      .catch(() => { /* best effort */ });
  } catch (_) { /* never block the request on metering */ }
  next();
};

app.use('/api/', generalLimiter);

// Stripe webhook signature verification (routes/supabase/webhooks.js POST /stripe) needs the
// RAW request body. Mount the raw parser for that exact path BEFORE the global express.json()
// below — otherwise json() consumes the stream first, constructEvent() receives a parsed object
// and ALWAYS throws, so checkout.session.completed never persists and paid upgrades silently fail.
// body-parser sets req._body once it reads the body, so the global json() safely skips this path.
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Increased body size limit for file uploads
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
// (request logging handled by pino-http via httpLogger() above)

// Add file upload handling with busboy-body-parser or fileupload
const fileUpload = require('express-fileupload');
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  abortOnLimit: true,
  responseOnLimit: 'File size limit exceeded (10MB)',
  useTempFiles: false, // Store files in memory
  debug: process.env.NODE_ENV === 'development'
}));

// Debug multipart form data (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      console.log('Multipart form detected');
      if (req.files) console.log('Files:', Object.keys(req.files));
      if (req.body) console.log('Fields:', Object.keys(req.body));
    }
    next();
  });
}

// Session middleware
// No static 'dev-secret-key' fallback (SYSTEM_DESIGN #2). In production a strong
// secret is guaranteed by assertEnv; in dev we use an ephemeral random secret so the
// app boots without baking a forgeable constant into the codebase.
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET ||
  (process.env.NODE_ENV !== 'production' ? crypto.randomBytes(32).toString('hex') : undefined);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from the uploads directory
app.use('/uploads', express.static(uploadsDir));

// Request logging (verbose only in development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
      query: req.query,
      params: req.params
    });
    next();
  });
}

// Routes
console.log('Registering routes...');
// Register routes with /api prefix (for production and new local setup)
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/jobs', deferredRouter('Jobs (removed — legacy suite)'));
app.use('/api/candidates/screen-resume', aiLimiter); // S-5: rate-limit the AI resume-screen path
app.use('/api/candidates', candidateRoutes);
app.use('/api/outreach', deferredRouter('Outreach (removed — legacy sourcing)'));
app.use('/api/job-scraping', deferredRouter('Job scraping (removed — legacy sourcing)'));
app.use('/api/payments', paymentsRoutes);
// Verify API Phase 1: console-side API-key management. supabaseAuth is applied inside the
// router (router.use(supabaseAuth)), consistent with other /api routes. The PUBLIC /v1
// surface (apiKeyAuth) is mounted in a later phase.
// Verify API Phase 3: console-side OUTBOUND webhook-endpoint management. Mounted BEFORE
// '/api/keys' so '/api/keys/webhooks/*' routes to this router (and is never captured by the
// apiKeys '/:id' routes). supabaseAuth is applied inside the router.
app.use('/api/keys/webhooks', apiWebhooksRoutes);
app.use('/api/keys', apiKeysRoutes);
// Verify API Phase 4: the PUBLIC OpenAPI 3.1 contract. Served WITHOUT auth (it's the docs/SDK
// source of truth) and registered BEFORE the authed `/v1` mount so apiKeyAuth never intercepts it.
const { buildOpenApiSpec } = require('./services/openapiSpec');
app.get('/v1/openapi.json', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const apiBaseUrl = (process.env.API_PUBLIC_URL || `${proto}://${req.get('host')}`).replace(/\/+$/, '');
  res.json(buildOpenApiSpec({ apiBaseUrl }));
});
// Verify API Phase 2: the PUBLIC `/v1` surface. Its OWN pipeline (does NOT inherit /api limiters):
//   apiKeyAuth → perKeyLimiter (per-account, mode-aware) → usageMetering → verify routes.
// express.json() is applied here explicitly for the /v1 mount (per spec); the global json
// middleware also covers it, but mounting it on /v1 keeps the surface self-contained.
app.use('/v1', express.json({ limit: '5mb' }), apiKeyAuth, verifyKeyLimiter, usageMetering, verifyRoutes);
app.use('/api/talent', deferredRouter('Talent pool (removed — legacy sourcing)'));
app.use('/api/match', deferredRouter('Resume/job match (removed — legacy)'));
app.use('/api/autopilot', deferredRouter('Autopilot (removed — legacy)'));
app.use('/api/analytics', analyticsRoutes);
// Ashby integration settings — mounted BEFORE /api/integrations so the more-specific path matches first.
app.use('/api/integrations/ashby', ashbySettingsRoutes);
// Greenhouse Harvest v3 settings — same rule (more-specific path before /api/integrations).
app.use('/api/integrations/greenhouse', greenhouseSettingsRoutes);
app.use('/api/integrations', integrationsRoutes);
// Ashby Assessments PARTNER endpoints (Ashby -> us), Basic-auth via the existing /v1 key path.
// Top-level /integrations (not /api) per the partner contract; before the SPA catch-all.
app.use('/integrations/ashby', ashbyPartnerRoutes);
// Greenhouse Assessments PARTNER endpoints (Greenhouse -> us), same Basic-auth key path; the whole
// surface self-404s unless GREENHOUSE_ASSESSMENTS_ENABLED === 'true'.
app.use('/integrations/greenhouse', greenhousePartnerRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/recommendations', deferredRouter('Recommendations (removed — legacy)'));
app.use('/api/feedback', aiLimiter, feedbackRoutes);
app.use('/api/proof', proofAiLimiter, proofRoutes); // aiLimiter scoped to LLM endpoints only (not /activity, /run, reads)
app.use('/api/assessments', assessmentRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/outcomes', outcomeRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/integrity', integrityRoutes);
app.use('/api/interview', interviewAiLimiter, require(`${routesPath}/interview`)); // S1 Live AI Probe — aiLimiter scoped to probe/start + answer only (reads must not 429)
// Face-liveness (camera) removed 2026 — contradicts the "behavioral, not biometric" proof-of-human.
// Verified-session consent (ADR-001 Phase 2): self-404s unless ENABLE_VERIFIED_SESSION==='true'.
// Mounted at both the singular and plural paths (the FE built against the plural collection name).
app.use('/api/verified-session', verifiedSessionRoutes);
app.use('/api/verified-sessions', verifiedSessionRoutes);
app.use('/api/pipeline', deferredRouter('Pipeline CRM (removed — legacy suite)'));
app.use('/api/filters', deferredRouter('Filters (removed — legacy suite)'));
app.use('/api/collab', collabRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/client-reviews', clientReviewRoutes);
app.use('/api/mvp-skeleton', ENABLE_MVP_SKELETONS ? mvpSkeletonRoutes : deferredRouter('MVP skeletons (ENABLE_MVP_SKELETONS)'));
app.use('/api/autopilot/campaigns', deferredRouter('Autopilot campaigns (removed — legacy)'));
app.use('/api/autopilot/queue', deferredRouter('Autopilot queue (removed — legacy)'));
// Auto-apply is PERMANENTLY disabled (STRATEGY.md non-goal) — not flag-gated.
app.use('/api/autoapply', (req, res) =>
  res.status(410).json({ error: 'Auto-apply is permanently disabled.' }));
app.use('/api/pool', deferredRouter('Intent pool (removed — legacy sourcing)'));
app.use('/api/status', statusRoutes);
app.use('/api/request-demo', requestDemoRoutes);
app.use('/api/email', emailUnsubscribeRoutes); // GET/POST /api/email/unsubscribe (RFC 8058 one-click capable)
app.use('/api/assistant', aiLimiter, ENABLE_MARKETING_ASSISTANT ? assistantRoutes : deferredRouter('Marketing assistant (ENABLE_MARKETING_ASSISTANT)'));
app.use('/api/admin', adminRoutes); // founder-only; 404s unless ADMIN_DASHBOARD_ENABLED + ADMIN_EMAIL set
app.use('/api/join', deferredRouter('Talent-pool join (removed — legacy sourcing)'));
app.use('/api/hooks', hooksRoutes); // Supabase DB webhook target (shared-secret gated): waitlist -> Resend
app.use('/api/notetaker', deferredRouter('Notetaker (removed — legacy)'));
// /api/candidate (multi-job mapping) was Mongo-only and is a deferred sourcing surface.
// Gated behind ENABLE_SOURCING; serves 503 when off (frontend panel is also flagged off).
app.use('/api/candidate', deferredRouter('Multi-job mapping (sourcing)'));
app.use('/api/screen-gen', aiLimiter, require(`${routesPath}/screenGen`)); // CC2/S2 — Author with AI (generate a screen from a JD/repo)
app.use('/api/benchmarks', require(`${routesPath}/benchmarks`)); // CC3: calibrated score + benchmarks (data moat made visible)
app.use('/api/passport', require(`${routesPath}/passport`)); // S4: Touchstones Passport (portable credential + accept-prior network)
app.use('/api/compliance', require(`${routesPath}/compliance`)); // CC1 v3: Compliance & Adverse-Impact (defensibility export + four-fifths)
app.use('/api/network', require(`${routesPath}/network`)); // CC3/v3: Candidate Network / "Apply with Touchstones" (candidate-initiated apply + employer accept)
app.use('/api/portal', require(`${routesPath}/portal`)); // candidate/recruiter account: request recruiter access (-> pending), founder approve

// Start follow-up email service (skip if pg_cron handles scheduling server-side)
if (process.env.USE_PG_CRON !== 'true' && ENABLE_AUTOPILOT) {
  // followUpService removed with the legacy autopilot suite (codebase-scan §4)
} else {
  console.log('pg_cron enabled - skipping Node.js follow-up service (handled by PostgreSQL)');
}

// Deadline sweep: remind candidates whose screen is due soon + expire un-submitted lapsed screens.
if (process.env.NODE_ENV !== 'test') {
  require('./services/deadlineSweep').start();
}

// Assessment archive (ADR-002): bundle terminal submissions into the owner's Azure Blob storage.
// Self-gates on ASSESSMENT_ARCHIVE_ENABLED (default OFF) + a configured connection string.
if (process.env.NODE_ENV !== 'test') {
  require('./services/assessmentArchiveService').start();
}

// Waitlist nurture (P1-3): one 48h follow-up to demo requesters. Self-gates on
// WAITLIST_NURTURE_ENABLED (default OFF) and is age-banded so it can never blast the backlog.
if (process.env.NODE_ENV !== 'test') {
  require('./services/waitlistNurture').start();
}

// Async scoring worker (SYSTEM_DESIGN #8): drains scoring_jobs and pushes results via
// Realtime. Opt-in (USE_SCORING_QUEUE=true); the default inline path stays unchanged.
if (process.env.USE_SCORING_QUEUE === 'true' && process.env.NODE_ENV !== 'test') {
  require('./services/scoringQueue').startWorker();
}

// Scoring sweep: self-healing rail for submissions whose inline auto-score never landed
// (outage/restart mid-score). Enqueues stuck submissions into scoring_jobs and drains them.
if (process.env.NODE_ENV !== 'test') {
  require('./services/scoringSweep').start();
}

// Confluent event relay: publishes domain_events outbox rows (migration 113) to Confluent Cloud.
// Self-gates on CONFLUENT_STREAMING_ENABLED (default OFF) + producer env; inert otherwise.
if (process.env.NODE_ENV !== 'test') {
  require('./services/eventRelay').start();
}

// Verify API Phase 3: outbound webhook retry drain. Cheap (a single indexed query every 30s
// that no-ops when nothing is due), so it runs unconditionally outside tests. First-attempt
// deliveries fire inline from the ingest path; this only re-drives FAILED rows on their backoff.
if (process.env.NODE_ENV !== 'test') {
  webhookService.startWebhookWorker();
}

// S-3 (codebase-scan 2026-07-02): the un-prefixed "backward compatibility" mounts (/auth, /jobs,
// /candidates, /outreach, /job-scraping) were DELETED. They sat outside /api, so generalLimiter never
// applied and /auth lost authLimiter while /jobs//outreach bypassed the ENABLE_SUITE/ENABLE_SOURCING
// kill-switches (unthrottled, unmetered legacy LLM/email surface). The frontend + SDK call only
// /api/* and /v1, so nothing legitimate used these. Every router remains mounted under /api.

// Health & readiness (SYSTEM_DESIGN #15).
// Liveness: the process is up. Cheap; never touches the DB.
app.get('/health/live', (req, res) => res.json({ status: 'ok' }));

// Readiness: confirms the DB is reachable (used for health-gated deploys). In
// mock/test mode there is no real DB, so report ready immediately.
async function readiness() {
  if (process.env.USE_MOCK_DB === 'true') return { ready: true, db: 'mock' };
  try {
    const { error } = await Promise.race([
      supabaseAdmin.from('profiles').select('id').limit(1),
      new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 2500)),
    ]);
    return { ready: !error, db: error ? 'down' : 'up' };
  } catch (e) {
    return { ready: false, db: 'down', error: e.message };
  }
}

app.get('/health', async (req, res) => {
  const r = await readiness();
  res.status(r.ready ? 200 : 503).json({ status: r.ready ? 'ok' : 'degraded', ...r });
});
app.get('/ready', async (req, res) => {
  const r = await readiness();
  res.status(r.ready ? 200 : 503).json(r);
});

// CORS test endpoint
app.get('/cors-test', (req, res) => {
  res.json({
    message: 'CORS is working!',
    headers: {
      origin: req.headers.origin,
      host: req.headers.host,
      referer: req.headers.referer
    },
    env: {
      frontend_url: process.env.FRONTEND_URL,
      node_env: process.env.NODE_ENV
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path, requestId: req.id }, 'Unhandled error');
  captureException(err, { path: req.path });
  res.status(500).json({
    message: 'Server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Serve frontend static files in production (Monorepo/Render support)
const frontendBuildPath = path.join(__dirname, '../../frontend/build');
if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendBuildPath)) {
  console.log('Serving frontend from:', frontendBuildPath);
  app.use(express.static(frontendBuildPath));

  // Handle SPA routing - return index.html for all non-API routes
  app.get('*', (req, res) => {
    // Don't intercept API routes (though they should be matched above)
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ message: 'API route not found' });
    }
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
}

// 404 handler
app.use((req, res) => {
  console.log('404 Not Found:', req.method, req.path);
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 3001;

// Only listen when not imported as a module (for tests)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  // SIGTERM graceful shutdown (SYSTEM_DESIGN #15) — Render sends SIGTERM on every
  // deploy. Stop accepting connections, drain in-flight, then exit. A hard 10s cap
  // guarantees we don't hang the deploy.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — draining and shutting down`);
    // followUpService removed with the legacy autopilot suite
    server.close(() => {
      logger.info('HTTP server closed — exiting');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Forced shutdown after 10s drain timeout');
      process.exit(0);
    }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
