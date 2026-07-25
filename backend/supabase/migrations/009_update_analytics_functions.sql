-- ============================================
-- Phase 6C: Update Analytics Functions for Flat Columns
-- ============================================
-- Replaces all autopilot JSONB casting with flat column references.
-- Run AFTER 008_normalize_autopilot.sql

-- ============================================
-- 1. OVERVIEW ANALYTICS (updated)
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
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'open')
  INTO v_total_jobs, v_active_jobs
  FROM jobs WHERE recruiter_id = p_user_id;

  SELECT COUNT(*) INTO v_total_candidates
  FROM candidate_submissions WHERE user_id = p_user_id;

  SELECT COUNT(*) INTO v_candidates_30d
  FROM candidate_submissions
  WHERE user_id = p_user_id AND created_at >= NOW() - INTERVAL '30 days';

  SELECT COUNT(*) INTO v_candidates_7d
  FROM candidate_submissions
  WHERE user_id = p_user_id AND created_at >= NOW() - INTERVAL '7 days';

  SELECT COUNT(*) INTO v_candidates_prev_30d
  FROM candidate_submissions
  WHERE user_id = p_user_id
    AND created_at >= NOW() - INTERVAL '60 days'
    AND created_at < NOW() - INTERVAL '30 days';

  -- Autopilot metrics from flat columns
  SELECT
    COUNT(*) FILTER (WHERE autopilot_triggered = TRUE),
    COUNT(*) FILTER (WHERE autopilot_action_taken = 'auto_email_sent'),
    COUNT(*) FILTER (WHERE autopilot_best_match_score >= 80)
  INTO v_autopilot_triggered, v_autopilot_emails, v_high_matches
  FROM candidate_submissions WHERE user_id = p_user_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '30 days')
  INTO v_emails_sent, v_emails_30d
  FROM outreach_logs
  WHERE user_id = p_user_id AND channel = 'email' AND status = 'sent';

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
-- 2. OUTREACH ANALYTICS (unchanged - no autopilot JSONB)
-- ============================================
-- No changes needed

-- ============================================
-- 3. AUTOPILOT ANALYTICS (updated)
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
              WHEN autopilot_best_match_score >= 100 THEN '100'
              WHEN autopilot_best_match_score >= 80 THEN '80-99'
              WHEN autopilot_best_match_score >= 60 THEN '60-79'
              WHEN autopilot_best_match_score >= 40 THEN '40-59'
              WHEN autopilot_best_match_score >= 20 THEN '20-39'
              ELSE '0-19'
            END AS bucket,
            COUNT(*) AS cnt
          FROM candidate_submissions
          WHERE user_id = p_user_id AND autopilot_best_match_score > 0
          GROUP BY bucket
        ) scores ON scores.bucket = ranges.range
      ) t
    ), '[]'::json),
    'funnel', (
      SELECT json_build_object(
        'submitted', COUNT(*),
        'processed', COUNT(*) FILTER (WHERE autopilot_triggered = TRUE),
        'qualified', COUNT(*) FILTER (WHERE autopilot_best_match_score >= 80),
        'contacted', COUNT(*) FILTER (WHERE autopilot_action_taken = 'auto_email_sent')
      )
      FROM candidate_submissions
      WHERE user_id = p_user_id AND created_at >= v_start_date
    ),
    'dailyActivity', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date) FROM (
        SELECT
          DATE(autopilot_triggered_at)::text AS date,
          COUNT(*) AS processed,
          COUNT(*) FILTER (WHERE autopilot_best_match_score >= 80) AS "highMatches",
          COUNT(*) FILTER (WHERE autopilot_action_taken = 'auto_email_sent') AS "emailsSent"
        FROM candidate_submissions
        WHERE user_id = p_user_id
          AND created_at >= v_start_date
          AND autopilot_triggered_at IS NOT NULL
        GROUP BY DATE(autopilot_triggered_at)
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- 4. JOBS ANALYTICS (updated)
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
          CASE WHEN COUNT(cs.autopilot_best_match_score) > 0
            THEN ROUND(AVG(cs.autopilot_best_match_score))::int ELSE 0 END AS "avgMatchScore",
          COUNT(*) FILTER (WHERE cs.autopilot_action_taken = 'auto_email_sent') AS "emailsSent"
        FROM jobs j
        LEFT JOIN candidate_submissions cs ON (
          cs.autopilot_best_match_job_id = j.id
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
-- 5. FUNNEL ANALYTICS (updated)
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

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE resume_text IS NOT NULL OR skills != '{}'),
    COUNT(*) FILTER (WHERE autopilot_best_match_score > 0),
    COUNT(*) FILTER (WHERE autopilot_best_match_score >= 80),
    COUNT(*) FILTER (WHERE autopilot_action_taken = 'auto_email_sent'),
    COUNT(*) FILTER (WHERE autopilot_action_taken = 'auto_email_sent' AND status = 'responded')
  INTO v_total, v_screened, v_matched, v_qualified, v_contacted, v_responded
  FROM candidate_submissions
  WHERE user_id = p_user_id
    AND created_at >= v_start_date
    AND (p_job_id IS NULL OR autopilot_best_match_job_id = p_job_id);

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
          COUNT(*) FILTER (WHERE autopilot_best_match_score >= 80) AS qualified,
          COUNT(*) FILTER (WHERE autopilot_action_taken = 'auto_email_sent') AS contacted
        FROM candidate_submissions
        WHERE user_id = p_user_id
          AND created_at >= v_start_date
          AND (p_job_id IS NULL OR autopilot_best_match_job_id = p_job_id)
        GROUP BY DATE(created_at)
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

SELECT 'Phase 6C: Analytics functions updated for flat columns!' as status;
