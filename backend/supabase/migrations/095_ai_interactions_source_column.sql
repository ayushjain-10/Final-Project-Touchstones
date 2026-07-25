-- 095_ai_interactions_source_column
-- Adds provenance to ai_interactions so the AI-direction score can distinguish a transcript the SERVER
-- observed (the in-app assistant: POST /ai-assist generates the reply and logs both turns) from one a
-- caller SELF-REPORTED (/v1 ai_transcript). Additive + backward-compatible: the default preserves the
-- existing server-logged behavior, so the currently-deployed code (which omits `source`) keeps working.
-- The write lockdown that actually blocks candidate self-authoring ships in 096 AFTER the app code that
-- writes `source` and routes /ai-assist through supabaseAdmin is deployed. Existing rows are grandfathered
-- to 'server_attested' (their true provenance is unknown; going-forward writes are enforced by 096).
-- REVERSAL (down): alter table public.ai_interactions drop column if exists source;
alter table public.ai_interactions
  add column if not exists source text not null default 'server_attested';
alter table public.ai_interactions
  drop constraint if exists ai_interactions_source_check;
alter table public.ai_interactions
  add constraint ai_interactions_source_check check (source in ('server_attested', 'client_attested'));
