// Type definitions for @touchstones/verify

export interface Criterion {
  id: string;
  requirement: string;
  points_possible: number;
  weight?: number;
  anchors?: string[];
}

export interface VerificationCreateParams {
  candidate_ref: string;
  rubric: { criteria: Criterion[] };
  rubric_version?: number;
  prompt_md?: string;
  work: { response_text?: string; response_code?: string };
  events?: Array<{ type?: string; category?: string; meta?: Record<string, unknown>; client_ts?: string }>;
  ai_transcript?: Array<{ role?: 'user' | 'assistant' | 'system'; content?: string; disposition?: 'accepted' | 'edited' | 'rejected'; client_ts?: string }>;
  run_tests?: boolean;
  work_sample_ref?: string;
  metadata?: Record<string, unknown>;
}

export interface ProofOfHuman {
  state: 'verified' | 'needs_review' | 'flagged';
  verified_chain: boolean | null;
  signals: Record<string, unknown>;
  digest: {
    head_hash: string | null;
    event_count: number;
    server_observed_count: number;
    summary: Record<string, unknown>;
  } | null;
}

export interface Score {
  score: number;
  outcome: string;
  per_criterion: Array<Record<string, unknown>>;
  overall_explanation: string;
  score_variance?: number;
  injection_flag: boolean;
  cached: boolean;
}

export interface Verification {
  id: string;
  candidate_ref: string | null;
  mode: 'live' | 'test';
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'needs_review';
  proof_of_human: ProofOfHuman;
  score: Score | null;
  ai_direction: Record<string, unknown> | null;
  code_execution: Record<string, unknown> | null;
  audit_url: string | null;
  report_url: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface TouchstonesOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class TouchstonesError extends Error {
  status: number;
  type?: string;
  param?: string;
  body?: unknown;
}

export class Touchstones {
  constructor(apiKey: string, opts?: TouchstonesOptions);
  apiKey: string;
  baseUrl: string;
  verifications: {
    create(body: VerificationCreateParams, options?: { idempotencyKey?: string }): Promise<Verification>;
    retrieve(id: string): Promise<Verification>;
    report(id: string): Promise<{ id: string; report_url: string }>;
    audit(id: string): Promise<Record<string, unknown>>;
  };
}

export default Touchstones;
