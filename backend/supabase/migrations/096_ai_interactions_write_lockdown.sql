-- 096_ai_interactions_write_lockdown
-- APPLY ONLY AFTER the 095-aware backend is deployed (POST /ai-assist now writes via supabaseAdmin with
-- source:'server_attested', and POST /ai-interactions returns 410 Gone). Removes the candidate's ability
-- to write ai_interactions directly, so the AI-direction transcript can no longer be self-authored or
-- fabricated to inflate the direction score — every in-app interaction is one the server actually
-- generated. Candidates keep READ access (the assistant panel + GET /ai-interactions replay) via the
-- existing SELECT policy + SELECT grant; only the write paths are removed.
-- REVERSAL (down): recreate policy ai_int_candidate_insert FOR INSERT TO authenticated WITH CHECK
-- (<ownership predicate>); GRANT INSERT ON public.ai_interactions TO authenticated.
drop policy if exists ai_int_candidate_insert on public.ai_interactions;
revoke insert, update, delete, truncate on public.ai_interactions from anon, authenticated;
