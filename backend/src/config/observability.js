/**
 * Observability (SYSTEM_DESIGN.md roadmap #15): structured logging (pino),
 * optional Sentry error reporting, and a request-id'd HTTP logger.
 *
 * Everything degrades gracefully: if a package isn't installed or no DSN is set,
 * we fall back to a console-backed logger and a no-op Sentry. Nothing here may
 * throw at import time.
 */
let pino = null;
try { pino = require('pino'); } catch (_) { /* optional */ }

const isTest = process.env.NODE_ENV === 'test';

const logger = pino
  ? pino({
      level: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'], remove: true },
      base: { service: 'touchstone-backend' },
    })
  : {
      // Minimal console shim with the pino surface we use.
      info: (...a) => !isTest && console.log(...a),
      warn: (...a) => !isTest && console.warn(...a),
      error: (...a) => console.error(...a),
      debug: () => {},
      child: () => logger,
    };

// --- Sentry (optional) ------------------------------------------------------
let Sentry = null;
function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    });
    logger.info('Sentry initialized');
    return Sentry;
  } catch (e) {
    logger.warn(`Sentry not initialized: ${e.message}`);
    return null;
  }
}

function captureException(err, context) {
  try {
    if (Sentry) Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch (_) { /* never let telemetry crash a request */ }
}

// --- HTTP request logger ----------------------------------------------------
// Public client-review links are bearer capabilities carried in the URL path
// (/api/client-reviews/public/:token), so a raw request log would persist the
// live token. Mask that path segment (and any :token route param) before the
// line is written; everything else about the request log is unchanged.
const CLIENT_REVIEW_TOKEN_RE = /(\/api\/client-reviews\/public\/)[^/?#]+/g;
function maskClientReviewToken(value) {
  return typeof value === 'string' ? value.replace(CLIENT_REVIEW_TOKEN_RE, '$1[redacted]') : value;
}

function httpLogger() {
  if (isTest) return (req, res, next) => next();
  try {
    const pinoHttp = require('pino-http');
    const crypto = require('crypto');
    return pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      serializers: {
        // pino-http wraps this around its standard req serializer, so `req` here
        // is the already-serialized { url, params, ... } object, safe to mutate.
        req(req) {
          req.url = maskClientReviewToken(req.url);
          if (req.params && req.params.token) req.params = { ...req.params, token: '[redacted]' };
          return req;
        },
      },
    });
  } catch (_) {
    return (req, res, next) => next();
  }
}

module.exports = { logger, initSentry, captureException, httpLogger, getSentry: () => Sentry };
