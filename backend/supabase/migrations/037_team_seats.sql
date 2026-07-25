-- 037_team_seats.sql — Phase 4 "Team seats / invite" (MVP: membership management).
--
-- A workspace OWNER invites teammates by email. Each invite is a row in
-- workspace_members keyed by (owner_id, member_email). The teammate accepts via a
-- one-time invite_token link (FRONTEND_URL/app/team?invite=<token>), at which point
-- member_id is bound to their auth.users id and status flips invited -> active.
--
-- SECURITY / RLS (mirrors 016 + 030 conventions — RLS is the tenant boundary; the
-- backend uses the token-scoped client, never service-role, for these reads/writes):
--   * Owner can SELECT/INSERT/UPDATE/DELETE their own rows  (owner_id = auth.uid()).
--   * Member can SELECT rows where member_id = auth.uid()    (read-only visibility).
-- The ACCEPT step (bind member_id by token) cannot be done under the invitee's own
-- RLS — at accept time member_id is still NULL so neither policy matches. The backend
-- performs the token lookup + bind with the service-role client (supabaseAdmin),
-- gated entirely on possession of the random invite_token (see collab.js
-- POST /api/collab/team/accept). This is a documented service-role use: the token IS
-- the capability, exactly like a password-reset/credential token.
--
-- NOT applied by this file — the founder applies migrations manually.

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  member_email TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  status       TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
  invite_token TEXT,
  invited_at   TIMESTAMPTZ DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  UNIQUE (owner_id, member_email)
);

-- Fast lookups: a member listing their memberships, and the token-based accept path.
CREATE INDEX IF NOT EXISTS idx_workspace_members_member ON public.workspace_members (member_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_token  ON public.workspace_members (invite_token);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- --- Owner: full control over their own rows -------------------------------------
DROP POLICY IF EXISTS workspace_members_owner_select ON public.workspace_members;
CREATE POLICY workspace_members_owner_select ON public.workspace_members
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS workspace_members_owner_insert ON public.workspace_members;
CREATE POLICY workspace_members_owner_insert ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS workspace_members_owner_update ON public.workspace_members;
CREATE POLICY workspace_members_owner_update ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS workspace_members_owner_delete ON public.workspace_members;
CREATE POLICY workspace_members_owner_delete ON public.workspace_members
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- --- Member: read-only visibility of their own membership rows --------------------
DROP POLICY IF EXISTS workspace_members_member_select ON public.workspace_members;
CREATE POLICY workspace_members_member_select ON public.workspace_members
  FOR SELECT TO authenticated
  USING (member_id = auth.uid());

COMMENT ON TABLE public.workspace_members IS
  'Phase 4 team seats: a workspace owner invites teammates by email. RLS: owner manages own rows; member reads rows where member_id = auth.uid(). Token-based accept binds member_id via service-role (the invite_token is the capability).';

SELECT 'workspace_members ready' AS status;
