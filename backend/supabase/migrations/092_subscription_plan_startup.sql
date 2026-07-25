-- 092 — add 'startup' to the subscription_plan enum (finding B-1, codebase-scan 2026-07-02).
-- Pricing sells a Startup plan (frontend Pricing.jsx) and Stripe checkout stamps metadata.plan
-- ='startup', but profiles.subscription_plan was the enum ('free','growth','enterprise'), so the
-- webhook UPDATE failed with invalid_enum and planLimits fell back to 'free' — paying customers
-- were silently capped. Applied to dev 2026-07-02.
-- NOTE: Postgres cannot DROP an enum value, so there is no clean down-path; retiring the value
-- later means migrating the column to TEXT+CHECK. IF NOT EXISTS makes this safe to re-run.
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'startup';
