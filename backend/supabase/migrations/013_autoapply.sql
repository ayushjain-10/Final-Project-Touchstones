-- ============================================
-- Feature: Candidate Auto-Apply (jobright.ai-style)
-- ============================================
-- A candidate has a primary resume + a list of job links. For each job we:
--   load the JD -> tailor the resume to it (Claude Haiku) -> save the tailored
--   resume -> "analyze the application site" -> autofill an in-app application
--   form from the candidate profile/resume -> submit.
-- Jobs are processed as a QUEUE with live per-job step states.
--
-- SAFETY SCOPE: external browser automation / real third-party submission is
-- explicitly OUT OF SCOPE. The "Application Site" is an in-app representation;
-- the `submitted` status here marks the in-app submission only. See
-- autoApplyService.submitToExternalSite() for the marked extension point.

-- 1) autoapply_settings — one row per user (the "Agent Settings" panel)
CREATE TABLE IF NOT EXISTS autoapply_settings (
  user_id              UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  mode                 TEXT    NOT NULL DEFAULT 'supervised'   -- supervised | automated
                         CHECK (mode IN ('supervised', 'automated')),
  weekly_objective     TEXT    NOT NULL DEFAULT 'under_20'     -- under_20 | 20_to_50 | over_50
                         CHECK (weekly_objective IN ('under_20', '20_to_50', 'over_50')),
  primary_resume_id    UUID,                                   -- optional ref to a stored resume (free-form; not FK'd)
  primary_resume_text  TEXT,                                   -- the resume content the agent tailors from
  customize_resume     BOOLEAN NOT NULL DEFAULT TRUE,          -- "customize resume for each application"
  generate_cover_letter BOOLEAN NOT NULL DEFAULT FALSE,        -- "generate cover letter"
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- 2) autoapply_jobs — the per-job queue rows with live step state
DO $$ BEGIN
  CREATE TYPE autoapply_status AS ENUM (
    'queued', 'tailoring', 'confirm', 'analyzing', 'filling', 'submitted', 'skipped', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS autoapply_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_url          TEXT NOT NULL,
  company          TEXT,
  job_title        TEXT,
  jd_text          TEXT,                                       -- the loaded job description
  tailored_resume  TEXT,                                       -- resume tailored to this JD
  cover_letter     TEXT,                                       -- optional generated cover letter
  status           autoapply_status NOT NULL DEFAULT 'queued',
  step             INT  NOT NULL DEFAULT 0,                    -- 0..5 (which of the 5 steps is active/complete)
  autofill         JSONB,                                      -- { fields:[...], values:{...} } from the in-app form
  error            TEXT,                                       -- populated when status = 'failed'
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autoapply_jobs_user ON autoapply_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_autoapply_jobs_status ON autoapply_jobs(status);

-- ---- RLS (user-scoped) ----
ALTER TABLE autoapply_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoapply_jobs     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aas_self ON autoapply_settings;
CREATE POLICY aas_self ON autoapply_settings FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS aaj_self ON autoapply_jobs;
CREATE POLICY aaj_self ON autoapply_jobs FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

SELECT 'Candidate auto-apply schema (013) ready' AS status;
