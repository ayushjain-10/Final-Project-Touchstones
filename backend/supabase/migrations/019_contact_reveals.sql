-- 019_contact_reveals.sql
-- The paid contact-reveal ledger. Recruiters search the PII-safe pool (018) and
-- spend a quota to REVEAL a candidate's real contact info. This table records each
-- reveal exactly once per (recruiter, candidate) so re-viewing an already-revealed
-- candidate is free, and a monthly count gates new reveals (free tier = 10/month).
--
-- No payment is processed here — the quota gate lives in the API; this is the ledger.

CREATE TABLE public.contact_reveals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidate_submissions(id) ON DELETE CASCADE,
  revealed_at  timestamptz DEFAULT now(),
  UNIQUE (recruiter_id, candidate_id)
);

ALTER TABLE public.contact_reveals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recruiters manage own reveals"
  ON public.contact_reveals
  FOR ALL
  TO authenticated
  USING (recruiter_id = auth.uid())
  WITH CHECK (recruiter_id = auth.uid());

CREATE INDEX idx_contact_reveals_recruiter
  ON public.contact_reveals (recruiter_id, revealed_at DESC);
