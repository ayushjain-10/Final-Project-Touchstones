/**
 * openapiSpec — the OpenAPI 3.1 contract for the PUBLIC Verify API (`/v1`).
 * ------------------------------------------------------------------------
 * Single source of truth for: the served GET /v1/openapi.json document, the public docs page
 * (/docs/api), and the embeddable SDK's typed surface. Hand-authored from the ACTUAL route
 * shapes in routes/supabase/verify.js + services/verifyService.js (not generated) so it never
 * drifts into describing endpoints that don't exist.
 *
 * buildOpenApiSpec(opts) lets the served document advertise the correct server URL (the API host
 * is request-derived via API_PUBLIC_URL); everything else is static.
 */

const VERSION = '1.0.0';

function buildOpenApiSpec({ apiBaseUrl } = {}) {
  const servers = [];
  if (apiBaseUrl) servers.push({ url: apiBaseUrl, description: 'This API host' });
  // Always advertise the canonical hosts too (docs render these even off-host).
  servers.push({ url: 'https://api.touchstones.ai', description: 'Production' });

  return {
    openapi: '3.1.0',
    info: {
      title: 'Touchstones Verify API',
      version: VERSION,
      summary: 'Embed proof-of-human + skill verification into your assessment platform.',
      description:
        'The Verify API turns a candidate work sample into a tamper-evident **Verification**: a '
        + 'proof-of-human signal backed by an append-only integrity hash-chain, a rubric score from '
        + 'the same engine that powers Touchstones, optional AI-direction and sandboxed code-execution '
        + 'signals, and a portable, shareable report. Authenticate with an API key '
        + '(`tsk_live_…` / `tsk_test_…`); every request is strictly scoped to your account.',
      contact: { name: 'Touchstones', email: 'support@touchstones.ai' },
    },
    servers,
    security: [{ ApiKeyAuth: [] }],
    tags: [
      { name: 'Verifications', description: 'Create and retrieve verifications.' },
    ],
    paths: {
      '/v1/verifications': {
        post: {
          tags: ['Verifications'],
          operationId: 'createVerification',
          summary: 'Create a verification',
          description:
            'Submit a candidate work sample (text or code) plus an optional integrity-event stream and '
            + 'AI transcript. The server reuses the Touchstones engine to score the work, computes the '
            + 'proof-of-human state from the integrity hash-chain, and returns the assembled Verification. '
            + 'Idempotent via the `Idempotency-Key` header.',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 255 },
              description: 'A unique key (per account). Replaying the same key returns the original Verification without re-scoring.',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VerificationCreate' } } },
          },
          responses: {
            200: {
              description: 'Verification completed synchronously.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Verification' } } },
            },
            202: {
              description: 'Accepted and queued (scoring is proceeding asynchronously).',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/VerificationQueued' } } },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
            422: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      '/v1/verifications/{id}': {
        get: {
          tags: ['Verifications'],
          operationId: 'getVerification',
          summary: 'Retrieve a verification',
          parameters: [{ $ref: '#/components/parameters/VerificationId' }],
          responses: {
            200: {
              description: 'The Verification.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Verification' } } },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      '/v1/verifications/{id}/audit': {
        get: {
          tags: ['Verifications'],
          operationId: 'getVerificationAudit',
          summary: 'Download the immutable audit record',
          description: 'Returns the tamper-evident audit row (hash-chained) for the verification\'s score, as a downloadable JSON attachment.',
          parameters: [{ $ref: '#/components/parameters/VerificationId' }],
          responses: {
            200: { description: 'The audit record (JSON).', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      '/v1/verifications/{id}/report': {
        get: {
          tags: ['Verifications'],
          operationId: 'getVerificationReport',
          summary: 'Get the portable report URL',
          description: 'Mints (or reuses) a portable, shareable credential and returns its public `report_url`.',
          parameters: [{ $ref: '#/components/parameters/VerificationId' }],
          responses: {
            200: {
              description: 'The report URL.',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' }, report_url: { type: 'string', format: 'uri' } },
              } } },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            422: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
    },
    // OpenAPI 3.1 webhooks: events Touchstones POSTs to your registered endpoint(s).
    webhooks: {
      'verification.completed': {
        post: {
          summary: 'Verification completed',
          description: 'Sent when a verification finishes with a clean proof-of-human state. Signed with '
            + '`Touchstones-Signature: t=<unixSeconds>,v1=<hmacSha256Hex>` over `${t}.${rawBody}`, keyed by your endpoint\'s signing secret.',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } },
          responses: { 200: { description: 'Return any 2xx to acknowledge.' } },
        },
      },
      'verification.needs_review': {
        post: {
          summary: 'Verification needs review',
          description: 'Sent when proof-of-human is flagged/needs review or scoring is inconclusive.',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } },
          responses: { 200: { description: 'Return any 2xx to acknowledge.' } },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Provide your API key as `Authorization: Bearer tsk_live_…` (or the `X-API-Key` header). Use a `tsk_test_…` key against the sandbox.',
        },
      },
      parameters: {
        VerificationId: {
          name: 'id', in: 'path', required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'The verification id.',
        },
      },
      responses: {
        Error: {
          description: 'Error envelope.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['type', 'message'],
              properties: {
                type: { type: 'string', enum: ['validation_error', 'auth_error', 'not_found', 'idempotency_conflict', 'unscoreable', 'rate_limit', 'api_error'] },
                message: { type: 'string' },
                param: { type: 'string', description: 'The offending field, when applicable.' },
              },
            },
          },
        },
        Criterion: {
          type: 'object',
          required: ['id', 'requirement', 'points_possible'],
          properties: {
            id: { type: 'string' },
            requirement: { type: 'string', description: 'What this criterion tests.' },
            points_possible: { type: 'number' },
            weight: { type: 'number' },
            anchors: { type: 'array', items: { type: 'string' }, description: 'Optional scoring anchors.' },
          },
        },
        VerificationCreate: {
          type: 'object',
          required: ['candidate_ref', 'rubric', 'work'],
          properties: {
            candidate_ref: { type: 'string', maxLength: 256, description: 'Your opaque id for the candidate (never interpreted as a Touchstones user).' },
            rubric: {
              type: 'object', required: ['criteria'],
              properties: { criteria: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/Criterion' } } },
            },
            rubric_version: { type: 'integer', minimum: 1, default: 1 },
            prompt_md: { type: 'string', maxLength: 20000, description: 'The prompt the candidate answered (markdown).' },
            work: {
              type: 'object',
              description: 'Exactly one of response_text / response_code must be non-empty.',
              properties: {
                response_text: { type: 'string', description: 'Free-text / markdown answer.' },
                response_code: { type: 'string', description: 'Code answer (multiple files may be serialized with `/* ===== path ===== */` headers).' },
              },
            },
            events: {
              type: 'array', description: 'Integrity events (typing/paste/focus). Recorded as client-attested signals on a hash-chain.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' }, category: { type: 'string' },
                  meta: { type: 'object', additionalProperties: true },
                  client_ts: { type: 'string', format: 'date-time' },
                },
              },
            },
            ai_transcript: {
              type: 'array', description: 'The candidate\'s AI assistant interactions, scored for AI-direction quality.',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                  content: { type: 'string' },
                  disposition: { type: 'string', enum: ['accepted', 'edited', 'rejected'] },
                  client_ts: { type: 'string', format: 'date-time' },
                },
              },
            },
            run_tests: { type: 'boolean', description: 'Run sandboxed tests from a trusted account-owned template (referenced by work_sample_ref). Caller-supplied commands are never executed.' },
            work_sample_ref: { type: 'string', format: 'uuid', description: 'An account-owned work_sample whose stored tests to run.' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        ProofOfHuman: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['verified', 'needs_review', 'flagged'] },
            verified_chain: { type: ['boolean', 'null'], description: 'Whether the integrity hash-chain linked-verified.' },
            signals: { type: 'object', additionalProperties: true, description: 'Advisory behavioral summary (typed fraction, focus, paste).' },
            digest: {
              type: ['object', 'null'],
              properties: {
                head_hash: { type: ['string', 'null'] },
                event_count: { type: 'integer' },
                server_observed_count: { type: 'integer' },
                summary: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        Score: {
          type: ['object', 'null'],
          properties: {
            score: { type: 'number', description: 'Normalized 0–100.' },
            outcome: { type: 'string', description: 'e.g. advance / review / reject.' },
            per_criterion: { type: 'array', items: { type: 'object', additionalProperties: true } },
            overall_explanation: { type: 'string' },
            score_variance: { type: 'number' },
            injection_flag: { type: 'boolean', description: 'Set if a prompt-injection attempt was detected in the work.' },
            cached: { type: 'boolean' },
          },
        },
        AiDirection: {
          type: ['object', 'null'],
          properties: {
            direction_score: { type: 'number' }, prompt_quality: { type: 'number' },
            error_catching: { type: 'number' }, verification_rigor: { type: 'number' },
            interaction_count: { type: 'integer' }, reasoning: { type: 'string' },
          },
        },
        CodeExecution: {
          type: ['object', 'null'],
          properties: {
            passed: { type: 'boolean' }, passed_count: { type: 'integer' },
            failed_count: { type: 'integer' }, total: { type: 'integer' },
            exit_code: { type: 'integer' }, duration_ms: { type: 'integer' },
          },
        },
        Verification: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            candidate_ref: { type: ['string', 'null'] },
            mode: { type: 'string', enum: ['live', 'test'] },
            status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed', 'needs_review'] },
            proof_of_human: { $ref: '#/components/schemas/ProofOfHuman' },
            score: { $ref: '#/components/schemas/Score' },
            ai_direction: { $ref: '#/components/schemas/AiDirection' },
            code_execution: { $ref: '#/components/schemas/CodeExecution' },
            audit_url: { type: ['string', 'null'], format: 'uri' },
            report_url: { type: ['string', 'null'], format: 'uri' },
            created_at: { type: ['string', 'null'], format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        VerificationQueued: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['queued'] },
          },
        },
        WebhookEvent: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['verification.completed', 'verification.needs_review', 'verification.failed', 'webhook.test'] },
            created: { type: 'integer', description: 'Unix seconds.' },
            data: {
              type: 'object',
              properties: { verification: { $ref: '#/components/schemas/Verification' } },
            },
          },
        },
      },
    },
  };
}

module.exports = { buildOpenApiSpec, VERSION };
