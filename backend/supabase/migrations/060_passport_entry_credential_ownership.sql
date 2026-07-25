-- 060_passport_entry_credential_ownership.sql — SECURITY FIX (v2-hardening, P0).
-- ----------------------------------------------------------------------------------------
-- FINDING (S4-1): passport_entries' INSERT/UPDATE RLS only checked PASSPORT ownership
-- (passport_id ∈ my passports). It NEVER checked CREDENTIAL ownership. Because Supabase
-- exposes PostgREST directly, any authenticated candidate — bypassing our Express route's
-- in-code cred_candidate gate (passport.js) — could insert a passport_entry pointing at
-- ANOTHER candidate's verified_credential. The public get_passport() RPC (059) then joined
-- passport_entries → verified_credentials with NO candidate match and published the
-- victim's live score / direction / public_token / issued_at under the ATTACKER's handle
-- (impersonation + token/score disclosure).
--
-- FIX (two layers, defense-in-depth):
--   1. RLS: INSERT and UPDATE on passport_entries now ALSO require the credential to belong
--      to the same candidate (auth.uid()). A candidate can only attach their OWN credentials.
--   2. get_passport() RPC: the entries join now requires vc.candidate_id = p.candidate_id, so
--      even a pre-existing / forged entry row can never surface a foreign credential publicly.
--
-- candidate_id is nullable on verified_credentials; both checks fail CLOSED for NULL
-- (NULL = auth.uid() → false), which is the safe direction. Idempotent (DROP … IF EXISTS).
--
-- NOT applied by this file — the founder applies migrations manually via the Management API.

-- ── 1. Tighten passport_entries INSERT / UPDATE: require credential ownership ──
DROP POLICY IF EXISTS passport_entry_owner_insert ON public.passport_entries;
CREATE POLICY passport_entry_owner_insert ON public.passport_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    passport_id   IN (SELECT id FROM public.passports            WHERE candidate_id = auth.uid())
    AND credential_id IN (SELECT id FROM public.verified_credentials WHERE candidate_id = auth.uid())
  );

DROP POLICY IF EXISTS passport_entry_owner_update ON public.passport_entries;
CREATE POLICY passport_entry_owner_update ON public.passport_entries
  FOR UPDATE TO authenticated
  USING (passport_id IN (SELECT id FROM public.passports WHERE candidate_id = auth.uid()))
  WITH CHECK (
    passport_id   IN (SELECT id FROM public.passports            WHERE candidate_id = auth.uid())
    AND credential_id IN (SELECT id FROM public.verified_credentials WHERE candidate_id = auth.uid())
  );

-- ── 2. Harden the public read RPC: entries must belong to the passport owner ──
CREATE OR REPLACE FUNCTION public.get_passport(p_handle text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'handle', p.handle,
    'display_name', p.display_name,
    'headline', p.headline,
    'created_at', p.created_at,
    'entries', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'token', vc.public_token,
          'score', vc.score,
          'direction_score', vc.direction_score,
          'proof_of_human', pe.proof_of_human,
          'title', pe.title,
          'role_family', pe.role_family,
          'percentile', pe.percentile,
          'issued_at', vc.issued_at
        )
        ORDER BY pe.sort_order, vc.issued_at DESC
      )
      FROM passport_entries pe
      JOIN verified_credentials vc ON vc.id = pe.credential_id
      WHERE pe.passport_id = p.id
        AND pe.is_visible = TRUE
        AND vc.revoked_at IS NULL
        AND vc.candidate_id = p.candidate_id   -- defense-in-depth: never surface a foreign credential
    ), '[]'::jsonb)
  )
  FROM passports p
  WHERE lower(p.handle) = lower(p_handle) AND p.is_public = TRUE;
$$;
REVOKE EXECUTE ON FUNCTION public.get_passport(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_passport(text) TO anon, authenticated;

SELECT 'passport_entry credential-ownership fix ready' AS status;
