-- 100_client_review_portal.sql
-- Client Review Portal: recruiter-owned, token-gated client review links for
-- scored work-sample submissions. Public clients never get a database policy;
-- the backend resolves hashed invite tokens and returns a safe review summary.

CREATE TABLE IF NOT EXISTS public.client_review_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  submission_id  UUID NOT NULL REFERENCES public.work_sample_submissions(id) ON DELETE CASCADE,
  score_id       UUID REFERENCES public.proof_scores(id) ON DELETE SET NULL,
  client_email   TEXT NOT NULL,
  client_name    TEXT,
  token_hash     TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'viewed', 'decided', 'revoked', 'expired')),
  message        TEXT,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  last_viewed_at TIMESTAMPTZ,
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_review_invites_owner
  ON public.client_review_invites(owner_id);
CREATE INDEX IF NOT EXISTS idx_client_review_invites_submission
  ON public.client_review_invites(submission_id);
CREATE INDEX IF NOT EXISTS idx_client_review_invites_created_by
  ON public.client_review_invites(created_by);
CREATE INDEX IF NOT EXISTS idx_client_review_invites_status
  ON public.client_review_invites(status);

CREATE TABLE IF NOT EXISTS public.client_review_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_id    UUID NOT NULL REFERENCES public.client_review_invites(id) ON DELETE CASCADE,
  author_type  TEXT NOT NULL CHECK (author_type IN ('recruiter', 'client')),
  author_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name  TEXT,
  author_email TEXT,
  visibility   TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'internal')),
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_review_comments_invite
  ON public.client_review_comments(invite_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_review_comments_owner
  ON public.client_review_comments(owner_id);

CREATE TABLE IF NOT EXISTS public.client_review_decisions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_id  UUID NOT NULL UNIQUE REFERENCES public.client_review_invites(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('advance', 'reject', 'needs_more_signal')),
  reasoning  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_review_decisions_owner
  ON public.client_review_decisions(owner_id);

ALTER TABLE public.client_review_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_review_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cri_recruiter_select ON public.client_review_invites;
CREATE POLICY cri_recruiter_select ON public.client_review_invites
  FOR SELECT
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS cri_recruiter_insert ON public.client_review_invites;
CREATE POLICY cri_recruiter_insert ON public.client_review_invites
  FOR INSERT
  WITH CHECK (
    public.is_verified_recruiter()
    AND created_by = auth.uid()
    AND (owner_id = auth.uid() OR public.is_workspace_member(owner_id))
    AND EXISTS (
      SELECT 1
      FROM public.work_sample_submissions s
      JOIN public.work_samples w ON w.id = s.work_sample_id
      WHERE s.id = client_review_invites.submission_id
        AND w.owner_id = client_review_invites.owner_id
    )
  );

DROP POLICY IF EXISTS cri_recruiter_update ON public.client_review_invites;
CREATE POLICY cri_recruiter_update ON public.client_review_invites
  FOR UPDATE
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id))
  WITH CHECK (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS cri_recruiter_delete ON public.client_review_invites;
CREATE POLICY cri_recruiter_delete ON public.client_review_invites
  FOR DELETE
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS crc_recruiter_select ON public.client_review_comments;
CREATE POLICY crc_recruiter_select ON public.client_review_comments
  FOR SELECT
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS crc_recruiter_insert ON public.client_review_comments;
CREATE POLICY crc_recruiter_insert ON public.client_review_comments
  FOR INSERT
  WITH CHECK (
    public.is_verified_recruiter()
    AND author_type = 'recruiter'
    AND author_id = auth.uid()
    AND (owner_id = auth.uid() OR public.is_workspace_member(owner_id))
    AND EXISTS (
      SELECT 1 FROM public.client_review_invites i
      WHERE i.id = client_review_comments.invite_id
        AND i.owner_id = client_review_comments.owner_id
    )
  );

DROP POLICY IF EXISTS crc_recruiter_delete ON public.client_review_comments;
CREATE POLICY crc_recruiter_delete ON public.client_review_comments
  FOR DELETE
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS crd_recruiter_select ON public.client_review_decisions;
CREATE POLICY crd_recruiter_select ON public.client_review_decisions
  FOR SELECT
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

DROP POLICY IF EXISTS crd_recruiter_insert ON public.client_review_decisions;
CREATE POLICY crd_recruiter_insert ON public.client_review_decisions
  FOR INSERT
  WITH CHECK (
    public.is_verified_recruiter()
    AND (owner_id = auth.uid() OR public.is_workspace_member(owner_id))
    AND EXISTS (
      SELECT 1 FROM public.client_review_invites i
      WHERE i.id = client_review_decisions.invite_id
        AND i.owner_id = client_review_decisions.owner_id
    )
  );

DROP POLICY IF EXISTS crd_recruiter_update ON public.client_review_decisions;
CREATE POLICY crd_recruiter_update ON public.client_review_decisions
  FOR UPDATE
  USING (owner_id = auth.uid() OR public.is_workspace_member(owner_id))
  WITH CHECK (owner_id = auth.uid() OR public.is_workspace_member(owner_id));

COMMENT ON TABLE public.client_review_invites IS
  'Recruiter-created client review links for scored work-sample submissions. Token hashes only; public clients access through backend token resolution, not RLS.';
COMMENT ON TABLE public.client_review_comments IS
  'Shared or internal comments on a client review invite. Public client writes are mediated by the backend service role after token validation.';
COMMENT ON TABLE public.client_review_decisions IS
  'One structured client recommendation per review invite: advance, reject, or needs_more_signal.';

SELECT 'client review portal schema ready' AS status;
