-- 044_interview_probes.sql — S1 Live AI Probe: an adaptive AI interview grounded in the
-- candidate's actual submission, tied to the verified human, scored in code.
--
-- After a screen is scored, the recruiter (or candidate) starts a short 3–5 turn adaptive Q&A that
-- interrogates the candidate's REAL work ("you fixed the race in the retry path — why not a lock?").
-- Each turn streams into the submission's append-only integrity hash-chain (append_integrity_event),
-- so the interview is tamper-evident and folds into the proof-of-human verdict. The probe is scored
-- IN CODE from a small rubric (the LLM emits per-dimension points; the 0–100 is blended in JS — same
-- anti-injection pattern as proofScoringService / aiDirectionService).
--
-- Candidate access is via probe_token (a public, unguessable capability — the /probe/:token page),
-- exactly like verified_credentials.public_token. Recruiter access is RLS-owner-scoped.
--
-- SECURITY / RLS (mirrors 040 / 016 conventions — RLS is the tenant boundary):
--   * Owner (account_id = auth.uid()) has full control over their own probe rows.
--   * The candidate answers through the public token routes (service-role + token gate), so no
--     candidate RLS policy is needed; the token IS the capability.
--   * No anon / cross-account visibility via RLS.
--
-- NOT applied by this file — the founder applies migrations manually. See the session summary.

CREATE TABLE IF NOT EXISTS public.interview_probes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.work_sample_submissions(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,  -- recruiter/owner
  -- Public candidate capability: the /probe/:token link. Unguessable; the token IS the access.
  probe_token     TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'done', 'failed')),
  max_turns       INT  NOT NULL DEFAULT 4,
  -- turns: [{ seq, role:'interviewer'|'candidate', content, client_ts }] — the adaptive transcript.
  turns           JSONB NOT NULL DEFAULT '[]'::jsonb,
  probe_score     INT,                       -- 0–100, computed in code (null until done)
  -- dimensions: { understanding:{points,evidence}, defends_and_extends:{points,evidence}, ownership:{points,evidence} }
  dimensions      JSONB,
  -- "consistency with submission": a confident defense of work the candidate didn't do is a signal.
  consistency_flag TEXT CHECK (consistency_flag IN ('consistent', 'inconsistent', 'unclear')),
  reasoning       TEXT,
  model_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- Recruiter "probes for this submission" + the result-page lookup.
CREATE INDEX IF NOT EXISTS idx_interview_probes_submission ON public.interview_probes (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_probes_account ON public.interview_probes (account_id, created_at DESC);

ALTER TABLE public.interview_probes ENABLE ROW LEVEL SECURITY;

-- --- Owner: full control over their own probe rows ---------------------------------------
DROP POLICY IF EXISTS interview_probes_owner_select ON public.interview_probes;
CREATE POLICY interview_probes_owner_select ON public.interview_probes
  FOR SELECT TO authenticated USING (account_id = auth.uid());

DROP POLICY IF EXISTS interview_probes_owner_insert ON public.interview_probes;
CREATE POLICY interview_probes_owner_insert ON public.interview_probes
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS interview_probes_owner_update ON public.interview_probes;
CREATE POLICY interview_probes_owner_update ON public.interview_probes
  FOR UPDATE TO authenticated USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS interview_probes_owner_delete ON public.interview_probes;
CREATE POLICY interview_probes_owner_delete ON public.interview_probes
  FOR DELETE TO authenticated USING (account_id = auth.uid());

COMMENT ON TABLE public.interview_probes IS
  'Live AI Probe (S1): adaptive interview grounded in the candidate''s submission, scored in code, tied to the integrity chain. probe_token is the public candidate capability (/probe/:token); RLS scopes recruiter reads to the owner.';

SELECT 'interview_probes ready' AS status;
