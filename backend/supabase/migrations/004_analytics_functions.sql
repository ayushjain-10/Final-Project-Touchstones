-- ============================================
-- Phase 3: Analytics PostgreSQL Functions
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- These functions replace in-memory JS analytics with server-side SQL

-- ============================================
-- 1. OVERVIEW ANALYTICS
-- ============================================
CREATE OR REPLACE FUNCTION analytics_overview(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
  v_total_jobs int;
  v_active_jobs int;
  v_total_candidates int;
  v_candidates_30d int;
  v_candidates_7d int;
  v_candidates_prev_30d int;
  v_autopilot_triggered int;
  v_autopilot_emails int;
  v_high_matches int;
  v_emails_sent int;
  v_emails_30d int;
  v_growth_rate numeric;
BEGIN
  -- Jobs
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'open')
  INTO v_total_jobs, v_active_jobs
  FROM jobs WHERE recruiter_id = p_user_id;

  -- Candidates total
  SELECT COUNT(*) INTO v_total_candidates
  FROM candidate_submissions WHERE user_id = p_user_id;

  -- Candidates last 30 days
  SELECT COUNT(*) INTO v_candidates_30d
  FROM candidate_submissions
  WHERE user_id = p_user_id AND created_at >= NOW() - INTERVAL '30 days';

  -- Candidates last 7 days
  SELECT COUNT(*) INTO v_candidates_7d
  FROM candidate_submissions
  WHERE user_id = p_user_id AND created_at >= NOW() - INTERVAL '7 days';

  -- Candidates previous period (30-60 days ago)
  SELECT COUNT(*) INTO v_candidates_prev_30d
  FROM candidate_submissions
  WHERE user_id = p_user_id
    AND created_at >= NOW() - INTERVAL '60 days'
    AND created_at < NOW() - INTERVAL '30 days';

  -- Autopilot metrics from JSONB
  SELECT
    COUNT(*) FILTER (WHERE (autopilot->>'triggered')::boolean = true),
    COUNT(*) FILTER (WHERE autopilot->>'action_taken' = 'auto_email_sent'),
    COUNT(*) FILTER (WHERE COALESCE((autopilot->>'best_match_score')::int, 0) >= 80)
  INTO v_autopilot_triggered, v_autopilot_emails, v_high_matches
  FROM candidate_submissions WHERE user_id = p_user_id;

  -- Outreach emails
  SELECT COUNT(*), COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '30 days')
  INTO v_emails_sent, v_emails_30d
  FROM outreach_logs
  WHERE user_id = p_user_id AND channel = 'email' AND status = 'sent';

  -- Growth rate
  IF v_candidates_prev_30d > 0 THEN
    v_growth_rate := ROUND(((v_candidates_30d - v_candidates_prev_30d)::numeric / v_candidates_prev_30d) * 100, 1);
  ELSIF v_candidates_30d > 0 THEN
    v_growth_rate := 100;
  ELSE
    v_growth_rate := 0;
  END IF;

  result := json_build_object(
    'jobs', json_build_object('total', v_total_jobs, 'active', v_active_jobs, 'filled', v_total_jobs - v_active_jobs),
    'candidates', json_build_object('total', v_total_candidates, 'last30Days', v_candidates_30d, 'last7Days', v_candidates_7d, 'growthRate', v_growth_rate),
    'autopilot', json_build_object(
      'triggered', v_autopilot_triggered,
      'emailsSent', v_emails_sent + v_autopilot_emails,
      'highMatches', v_high_matches,
      'conversionRate', CASE WHEN v_autopilot_triggered > 0
        THEN ROUND(((v_emails_sent + v_autopilot_emails)::numeric / v_autopilot_triggered) * 100, 1)
        ELSE 0 END
    )
  );

  RETURN result;
END;
$$;

-- ============================================
-- 2. OUTREACH ANALYTICS
-- ============================================
CREATE OR REPLACE FUNCTION analytics_outreach(p_user_id uuid, p_days int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
  v_start_date timestamptz;
BEGIN
  v_start_date := NOW() - (p_days || ' days')::interval;

  SELECT json_build_object(
    'byAction', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT source AS action, COUNT(*) AS count,
          CASE WHEN COUNT(match_score) > 0
            THEN ROUND(AVG(match_score))::int ELSE 0 END AS "avgMatchScore"
        FROM outreach_logs
        WHERE user_id = p_user_id AND sent_at >= v_start_date
        GROUP BY source
        UNION ALL
        SELECT channel AS action, COUNT(*) AS count, 0 AS "avgMatchScore"
        FROM outreach_logs
        WHERE user_id = p_user_id AND sent_at >= v_start_date
        GROUP BY channel
      ) t
    ), '[]'::json),
    'dailyVolume', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date) FROM (
        SELECT DATE(sent_at)::text AS date, COUNT(*) AS "emailsSent",
          CASE WHEN COUNT(match_score) > 0
            THEN ROUND(AVG(match_score))::int ELSE 0 END AS "avgScore"
        FROM outreach_logs
        WHERE user_id = p_user_id AND sent_at >= v_start_date
        GROUP BY DATE(sent_at)
      ) t
    ), '[]'::json),
    'topJobs', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT o.job_id AS "_id", COALESCE(j.title, 'Unknown Job') AS "jobTitle",
          COUNT(*) AS "emailsSent",
          CASE WHEN COUNT(o.match_score) > 0
            THEN ROUND(AVG(o.match_score))::int ELSE 0 END AS "avgScore"
        FROM outreach_logs o
        LEFT JOIN jobs j ON j.id = o.job_id
        WHERE o.user_id = p_user_id AND o.sent_at >= v_start_date AND o.job_id IS NOT NULL
        GROUP BY o.job_id, j.title
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- 3. AUTOPILOT ANALYTICS
-- ============================================
CREATE OR REPLACE FUNCTION analytics_autopilot(p_user_id uuid, p_days int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
  v_start_date timestamptz;
BEGIN
  v_start_date := NOW() - (p_days || ' days')::interval;

  SELECT json_build_object(
    'scoreDistribution', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT range, COALESCE(cnt, 0) AS count FROM (
          VALUES ('0-19'), ('20-39'), ('40-59'), ('60-79'), ('80-99'), ('100')
        ) AS ranges(range)
        LEFT JOIN (
          SELECT
            CASE
              WHEN COALESCE((autopilot->>'best_match_score')::int, 0) >= 100 THEN '100'
              WHEN COALESCE((autopilot->>'best_match_score')::int, 0) >= 80 THEN '80-99'
              WHEN COALESCE((autopilot->>'best_match_score')::int, 0) >= 60 THEN '60-79'
              WHEN COALESCE((autopilot->>'best_match_score')::int, 0) >= 40 THEN '40-59'
              WHEN COALESCE((autopilot->>'best_match_score')::int, 0) >= 20 THEN '20-39'
              ELSE '0-19'
            END AS bucket,
            COUNT(*) AS cnt
          FROM candidate_submissions
          WHERE user_id = p_user_id AND autopilot->>'best_match_score' IS NOT NULL
          GROUP BY bucket
        ) scores ON scores.bucket = ranges.range
      ) t
    ), '[]'::json),
    'funnel', (
      SELECT json_build_object(
        'submitted', COUNT(*),
        'processed', COUNT(*) FILTER (WHERE (autopilot->>'triggered')::boolean = true),
        'qualified', COUNT(*) FILTER (WHERE COALESCE((autopilot->>'best_match_score')::int, 0) >= 80),
        'contacted', COUNT(*) FILTER (WHERE autopilot->>'action_taken' = 'auto_email_sent')
      )
      FROM candidate_submissions
      WHERE user_id = p_user_id AND created_at >= v_start_date
    ),
    'dailyActivity', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date) FROM (
        SELECT
          DATE(autopilot->>'triggered_at')::text AS date,
          COUNT(*) AS processed,
          COUNT(*) FILTER (WHERE COALESCE((autopilot->>'best_match_score')::int, 0) >= 80) AS "highMatches",
          COUNT(*) FILTER (WHERE autopilot->>'action_taken' = 'auto_email_sent') AS "emailsSent"
        FROM candidate_submissions
        WHERE user_id = p_user_id
          AND created_at >= v_start_date
          AND autopilot->>'triggered_at' IS NOT NULL
        GROUP BY DATE(autopilot->>'triggered_at')
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- 4. JOBS ANALYTICS
-- ============================================
CREATE OR REPLACE FUNCTION analytics_jobs(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'statusBreakdown', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT COALESCE(status, 'unknown') AS status, COUNT(*) AS count
        FROM jobs WHERE recruiter_id = p_user_id
        GROUP BY status
      ) t
    ), '[]'::json),
    'topJobs', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT j.id, j.title, j.status,
          COUNT(cs.id) AS "candidateCount",
          CASE WHEN COUNT((cs.autopilot->>'best_match_score')::int) > 0
            THEN ROUND(AVG((cs.autopilot->>'best_match_score')::int))::int ELSE 0 END AS "avgMatchScore",
          COUNT(*) FILTER (WHERE cs.autopilot->>'action_taken' = 'auto_email_sent') AS "emailsSent"
        FROM jobs j
        LEFT JOIN candidate_submissions cs ON (
          cs.autopilot->>'best_match_job_id' = j.id::text
          AND cs.user_id = p_user_id
        )
        WHERE j.recruiter_id = p_user_id
        GROUP BY j.id, j.title, j.status
        ORDER BY COUNT(cs.id) DESC
        LIMIT 10
      ) t
    ), '[]'::json),
    'trendsOverTime', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.month) FROM (
        SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*) AS count
        FROM jobs WHERE recruiter_id = p_user_id
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 12
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- 5. FUNNEL ANALYTICS
-- ============================================
CREATE OR REPLACE FUNCTION analytics_funnel(p_user_id uuid, p_days int DEFAULT 30, p_job_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
  v_start_date timestamptz;
  v_total int;
  v_screened int;
  v_matched int;
  v_qualified int;
  v_contacted int;
  v_responded int;
BEGIN
  v_start_date := NOW() - (p_days || ' days')::interval;

  -- Funnel counts
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE resume_text IS NOT NULL OR skills != '{}'),
    COUNT(*) FILTER (WHERE autopilot->>'best_match_score' IS NOT NULL),
    COUNT(*) FILTER (WHERE COALESCE((autopilot->>'best_match_score')::int, 0) >= 80),
    COUNT(*) FILTER (WHERE autopilot->>'action_taken' = 'auto_email_sent'),
    COUNT(*) FILTER (WHERE autopilot->>'action_taken' = 'auto_email_sent' AND status = 'responded')
  INTO v_total, v_screened, v_matched, v_qualified, v_contacted, v_responded
  FROM candidate_submissions
  WHERE user_id = p_user_id
    AND created_at >= v_start_date
    AND (p_job_id IS NULL OR autopilot->>'best_match_job_id' = p_job_id::text);

  SELECT json_build_object(
    'funnel', json_build_array(
      json_build_object('stage', 'Submissions', 'count', v_total, 'conversionRate', 100),
      json_build_object('stage', 'Screened', 'count', v_screened, 'conversionRate',
        CASE WHEN v_total > 0 THEN ROUND((v_screened::numeric / v_total) * 100, 1) ELSE 0 END),
      json_build_object('stage', 'Matched', 'count', v_matched, 'conversionRate',
        CASE WHEN v_screened > 0 THEN ROUND((v_matched::numeric / v_screened) * 100, 1) ELSE 0 END),
      json_build_object('stage', 'Qualified (80%+)', 'count', v_qualified, 'conversionRate',
        CASE WHEN v_matched > 0 THEN ROUND((v_qualified::numeric / v_matched) * 100, 1) ELSE 0 END),
      json_build_object('stage', 'Contacted', 'count', v_contacted, 'conversionRate',
        CASE WHEN v_qualified > 0 THEN ROUND((v_contacted::numeric / v_qualified) * 100, 1) ELSE 0 END),
      json_build_object('stage', 'Responded', 'count', v_responded, 'conversionRate',
        CASE WHEN v_contacted > 0 THEN ROUND((v_responded::numeric / v_contacted) * 100, 1) ELSE 0 END)
    ),
    'trends', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date) FROM (
        SELECT
          DATE(created_at)::text AS date,
          COUNT(*) AS submissions,
          COUNT(*) FILTER (WHERE COALESCE((autopilot->>'best_match_score')::int, 0) >= 80) AS qualified,
          COUNT(*) FILTER (WHERE autopilot->>'action_taken' = 'auto_email_sent') AS contacted
        FROM candidate_submissions
        WHERE user_id = p_user_id
          AND created_at >= v_start_date
          AND (p_job_id IS NULL OR autopilot->>'best_match_job_id' = p_job_id::text)
        GROUP BY DATE(created_at)
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- DONE
-- ============================================
SELECT 'Analytics functions created successfully!' as status;
