-- ============================================
-- Phase 5: pg_cron Scheduled Tasks
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
--
-- PREREQUISITES:
--   1. Enable the pg_cron extension in Supabase Dashboard:
--      Dashboard > Database > Extensions > search "pg_cron" > Enable
--   2. Enable the pg_net extension for HTTP calls (optional, for webhook-based email):
--      Dashboard > Database > Extensions > search "pg_net" > Enable
--
-- These cron jobs replace the Node.js setInterval-based scheduling:
--   - followUpService.js: setInterval every 1 hour  -> pg_cron every 1 hour
--   - auto-scheduling check: none currently          -> pg_cron every 15 minutes
--
-- NOTE: pg_cron jobs run as the database superuser. The functions use
-- SECURITY DEFINER to ensure proper access regardless of caller.

-- ============================================
-- 1. ENABLE EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================
-- 2. FOLLOW-UP PROCESSING FUNCTION
-- ============================================
-- This function identifies autopilot_queue items that are due for
-- follow-up emails and marks them as ready for processing.
--
-- The actual email sending still happens via the Node.js backend
-- (called via pg_net webhook), because email composition requires
-- template rendering and SMTP integration that lives in Node.js.
--
-- What this function does:
--   a) Finds queue items where follow-up is due
--   b) Marks completed sequences (exceeded maxFollowUps)
--   c) Flags due items by setting a 'cron_flagged' key in email_tracking
--   d) Returns a summary of what was processed

CREATE OR REPLACE FUNCTION process_due_follow_ups()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_flagged int := 0;
  v_completed int := 0;
  v_total_due int := 0;
  v_item record;
BEGIN
  -- Find all queue items where follow-up email is due
  FOR v_item IN
    SELECT
      aq.id,
      aq.email_tracking,
      aq.response_tracking,
      ac.email_sequence
    FROM autopilot_queue aq
    LEFT JOIN autopilot_campaigns ac ON ac.id = aq.campaign_id
    WHERE aq.status = 'approved'
      AND (aq.email_tracking->>'initialEmailSent')::boolean = true
      AND COALESCE((aq.email_tracking->>'sequenceCompleted')::boolean, false) = false
      AND (aq.email_tracking->>'nextFollowUpAt')::timestamptz <= NOW()
      AND COALESCE((aq.response_tracking->>'received')::boolean, false) = false
  LOOP
    v_total_due := v_total_due + 1;

    -- Check if sequence should be marked complete
    -- (currentStep >= maxFollowUps or no more follow-ups defined)
    IF COALESCE((v_item.email_tracking->>'currentStep')::int, 0) >=
       COALESCE((v_item.email_sequence->>'maxFollowUps')::int, 3)
    THEN
      -- Mark sequence as completed
      UPDATE autopilot_queue
      SET
        email_tracking = email_tracking
          || jsonb_build_object(
            'sequenceCompleted', true,
            'sequenceCompletedAt', NOW()::text,
            'nextFollowUpAt', null
          ),
        updated_at = NOW()
      WHERE id = v_item.id;

      v_completed := v_completed + 1;
    ELSE
      -- Flag item as ready for follow-up processing
      -- The Node.js backend polls for cron_flagged items or receives a webhook
      UPDATE autopilot_queue
      SET
        email_tracking = email_tracking
          || jsonb_build_object(
            'cron_flagged', true,
            'cron_flagged_at', NOW()::text
          ),
        updated_at = NOW()
      WHERE id = v_item.id;

      v_flagged := v_flagged + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'processed_at', NOW(),
    'total_due', v_total_due,
    'flagged_for_sending', v_flagged,
    'sequences_completed', v_completed
  );
END;
$$;

-- ============================================
-- 3. AUTO-SCHEDULING CHECK FUNCTION
-- ============================================
-- Checks for autopilot_queue items that have received positive
-- responses and are eligible for automatic interview scheduling.
-- Flags them so the Node.js backend can process the actual
-- calendar API calls (Google Calendar / Calendly).

CREATE OR REPLACE FUNCTION check_auto_scheduling()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_flagged int := 0;
  v_item record;
BEGIN
  -- Find queue items with positive responses that need scheduling
  FOR v_item IN
    SELECT aq.id
    FROM autopilot_queue aq
    LEFT JOIN autopilot_campaigns ac ON ac.id = aq.campaign_id
    WHERE aq.status = 'approved'
      AND COALESCE((aq.response_tracking->>'received')::boolean, false) = true
      AND COALESCE((aq.response_tracking->>'sentiment'), '') IN ('positive', 'interested')
      AND COALESCE((aq.interview_tracking->>'scheduled')::boolean, false) = false
      AND COALESCE((aq.interview_tracking->>'auto_schedule_flagged')::boolean, false) = false
      AND COALESCE((ac.settings->>'autoScheduleInterviews')::boolean, false) = true
  LOOP
    UPDATE autopilot_queue
    SET
      interview_tracking = COALESCE(interview_tracking, '{}'::jsonb)
        || jsonb_build_object(
          'auto_schedule_flagged', true,
          'auto_schedule_flagged_at', NOW()::text
        ),
      updated_at = NOW()
    WHERE id = v_item.id;

    v_flagged := v_flagged + 1;
  END LOOP;

  RETURN json_build_object(
    'checked_at', NOW(),
    'flagged_for_scheduling', v_flagged
  );
END;
$$;

-- ============================================
-- 4. EXPIRED QUEUE ITEMS CLEANUP
-- ============================================
-- Marks expired autopilot_queue items so they stop being processed.

CREATE OR REPLACE FUNCTION cleanup_expired_queue_items()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired int;
BEGIN
  UPDATE autopilot_queue
  SET status = 'expired', updated_at = NOW()
  WHERE status IN ('pending', 'approved')
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN json_build_object(
    'cleaned_at', NOW(),
    'expired_items', v_expired
  );
END;
$$;

-- ============================================
-- 5. STALE CAMPAIGN CHECK
-- ============================================
-- Pauses campaigns that have had no activity for 30 days.

CREATE OR REPLACE FUNCTION pause_stale_campaigns()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_paused int;
BEGIN
  UPDATE autopilot_campaigns
  SET
    status = 'paused',
    paused_at = NOW(),
    updated_at = NOW()
  WHERE status = 'active'
    AND updated_at < NOW() - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM autopilot_queue aq
      WHERE aq.campaign_id = autopilot_campaigns.id
        AND aq.updated_at >= NOW() - INTERVAL '30 days'
    );

  GET DIAGNOSTICS v_paused = ROW_COUNT;

  RETURN json_build_object(
    'checked_at', NOW(),
    'campaigns_paused', v_paused
  );
END;
$$;

-- ============================================
-- 6. SCHEDULE CRON JOBS
-- ============================================
-- Remove existing jobs if re-running this migration
SELECT cron.unschedule('touchstone-follow-ups')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'touchstone-follow-ups');

SELECT cron.unschedule('touchstone-auto-scheduling')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'touchstone-auto-scheduling');

SELECT cron.unschedule('touchstone-expired-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'touchstone-expired-cleanup');

SELECT cron.unschedule('touchstone-stale-campaigns')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'touchstone-stale-campaigns');

-- Follow-up email processing: every hour at minute 0
SELECT cron.schedule(
  'touchstone-follow-ups',
  '0 * * * *',
  $$SELECT process_due_follow_ups()$$
);

-- Auto-scheduling check: every 15 minutes
SELECT cron.schedule(
  'touchstone-auto-scheduling',
  '*/15 * * * *',
  $$SELECT check_auto_scheduling()$$
);

-- Expired queue items cleanup: daily at 3:00 AM UTC
SELECT cron.schedule(
  'touchstone-expired-cleanup',
  '0 3 * * *',
  $$SELECT cleanup_expired_queue_items()$$
);

-- Stale campaign check: daily at 4:00 AM UTC
SELECT cron.schedule(
  'touchstone-stale-campaigns',
  '0 4 * * *',
  $$SELECT pause_stale_campaigns()$$
);

-- ============================================
-- 7. INDEXES FOR CRON QUERY PERFORMANCE
-- ============================================
-- Composite index for the follow-up query pattern
CREATE INDEX IF NOT EXISTS idx_autopilot_queue_followup_due
  ON autopilot_queue (status)
  WHERE (email_tracking->>'initialEmailSent')::boolean = true
    AND COALESCE((email_tracking->>'sequenceCompleted')::boolean, false) = false;

-- Index for auto-scheduling check
CREATE INDEX IF NOT EXISTS idx_autopilot_queue_scheduling
  ON autopilot_queue (status)
  WHERE COALESCE((response_tracking->>'received')::boolean, false) = true
    AND COALESCE((interview_tracking->>'scheduled')::boolean, false) = false;

-- Index for expired items cleanup
CREATE INDEX IF NOT EXISTS idx_autopilot_queue_expires
  ON autopilot_queue (expires_at)
  WHERE status IN ('pending', 'approved')
    AND expires_at IS NOT NULL;

-- ============================================
-- DONE
-- ============================================
SELECT 'pg_cron scheduled tasks created successfully!' AS status;
