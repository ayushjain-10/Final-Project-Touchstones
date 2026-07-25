-- 059_passport_rpcs.sql — public, redacted read paths for the Passport + the
-- accept-prior network. Modeled exactly on get_credential (029): SECURITY DEFINER,
-- NO broad table policy, single-key lookup, returns DATA ONLY (no PII, no internal
-- ids beyond the already-public credential token). Granted to anon + authenticated.
--
-- NOT applied by this file — the founder applies migrations manually.

-- get_passport(handle): the public profile aggregate. Returns the passport display
-- fields + its VISIBLE entries whose credential is still valid (revoked_at IS NULL).
-- Each entry exposes ONLY: the public verify token, score + direction (live, from
-- the credential), the proof-of-human snapshot, the screen title/role, and an
-- optional percentile. Returns NULL (no row) when the handle is missing or private.
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
      WHERE pe.passport_id = p.id AND pe.is_visible = TRUE AND vc.revoked_at IS NULL
    ), '[]'::jsonb)
  )
  FROM passports p
  WHERE lower(p.handle) = lower(p_handle) AND p.is_public = TRUE;
$$;
REVOKE EXECUTE ON FUNCTION public.get_passport(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_passport(text) TO anon, authenticated;

-- get_credential_full(token): the recruiter accept-prior verification view — the
-- minimal public verify (get_credential) PLUS the tamper-evident digest_hash and
-- the network counter (how many distinct teams have accepted it). DATA only; no
-- PII. Returns NULL (no row) for a missing or revoked token.
CREATE OR REPLACE FUNCTION public.get_credential_full(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'valid', true,
    'score', vc.score,
    'direction_score', vc.direction_score,
    'digest_hash', vc.digest_hash,
    'issued_at', vc.issued_at,
    'accepted_count', (
      SELECT COUNT(DISTINCT ca.accepting_account_id)
      FROM credential_acceptances ca WHERE ca.credential_id = vc.id
    )
  )
  FROM verified_credentials vc
  WHERE vc.public_token = p_token AND vc.revoked_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_credential_full(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_credential_full(text) TO anon, authenticated;
