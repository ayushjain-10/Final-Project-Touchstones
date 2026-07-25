-- ============================================
-- Phase 2: Row Level Security (RLS) Policies
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- These policies enforce per-user data isolation using auth.uid()
-- auth.uid() matches profiles.id (synced by ensureAuthUser)

-- ============================================
-- PROFILES
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

-- ============================================
-- JOBS
-- ============================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs"
  ON jobs FOR SELECT
  USING (recruiter_id = auth.uid());

CREATE POLICY "Users can insert own jobs"
  ON jobs FOR INSERT
  WITH CHECK (recruiter_id = auth.uid());

CREATE POLICY "Users can update own jobs"
  ON jobs FOR UPDATE
  USING (recruiter_id = auth.uid());

CREATE POLICY "Users can delete own jobs"
  ON jobs FOR DELETE
  USING (recruiter_id = auth.uid());

-- ============================================
-- CANDIDATES
-- ============================================
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own candidates"
  ON candidates FOR SELECT
  USING (recruiter_id = auth.uid());

CREATE POLICY "Users can insert own candidates"
  ON candidates FOR INSERT
  WITH CHECK (recruiter_id = auth.uid());

CREATE POLICY "Users can update own candidates"
  ON candidates FOR UPDATE
  USING (recruiter_id = auth.uid());

CREATE POLICY "Users can delete own candidates"
  ON candidates FOR DELETE
  USING (recruiter_id = auth.uid());

-- ============================================
-- CANDIDATE SUBMISSIONS (talent pool)
-- Supports shared_with UUID[] for collaboration
-- ============================================
ALTER TABLE candidate_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own or shared submissions"
  ON candidate_submissions FOR SELECT
  USING (user_id = auth.uid() OR auth.uid() = ANY(shared_with));

CREATE POLICY "Users can insert own submissions"
  ON candidate_submissions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own submissions"
  ON candidate_submissions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own submissions"
  ON candidate_submissions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- NOTIFICATIONS
-- ============================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());

-- INSERT uses supabaseAdmin (system creates notifications)

-- ============================================
-- PIPELINE STAGES
-- ============================================
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pipeline stages"
  ON pipeline_stages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own pipeline stages"
  ON pipeline_stages FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own pipeline stages"
  ON pipeline_stages FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own pipeline stages"
  ON pipeline_stages FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- SAVED FILTERS
-- ============================================
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own filters"
  ON saved_filters FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own filters"
  ON saved_filters FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own filters"
  ON saved_filters FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own filters"
  ON saved_filters FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- RECRUITER CANDIDATE STATUSES
-- ============================================
ALTER TABLE recruiter_candidate_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own statuses"
  ON recruiter_candidate_statuses FOR SELECT
  USING (recruiter_user_id = auth.uid());

CREATE POLICY "Users can insert own statuses"
  ON recruiter_candidate_statuses FOR INSERT
  WITH CHECK (recruiter_user_id = auth.uid());

CREATE POLICY "Users can update own statuses"
  ON recruiter_candidate_statuses FOR UPDATE
  USING (recruiter_user_id = auth.uid());

CREATE POLICY "Users can delete own statuses"
  ON recruiter_candidate_statuses FOR DELETE
  USING (recruiter_user_id = auth.uid());

-- ============================================
-- OUTREACH LOGS
-- ============================================
ALTER TABLE outreach_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own outreach"
  ON outreach_logs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own outreach"
  ON outreach_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own outreach"
  ON outreach_logs FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own outreach"
  ON outreach_logs FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Comments visible to submission owner + shared users (via join to candidate_submissions)
CREATE POLICY "Users can view comments on accessible submissions"
  ON comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM candidate_submissions cs
      WHERE cs.id = comments.candidate_id
      AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
    )
  );

CREATE POLICY "Users can insert comments"
  ON comments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own comments"
  ON comments FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own comments"
  ON comments FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- INTERVIEW FEEDBACK
-- ============================================
ALTER TABLE interview_feedback ENABLE ROW LEVEL SECURITY;

-- Feedback visible to submission owner + shared users
CREATE POLICY "Users can view feedback on accessible submissions"
  ON interview_feedback FOR SELECT
  USING (
    interviewer_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM candidate_submissions cs
      WHERE cs.id = interview_feedback.candidate_id
      AND (cs.user_id = auth.uid() OR auth.uid() = ANY(cs.shared_with))
    )
  );

CREATE POLICY "Users can insert own feedback"
  ON interview_feedback FOR INSERT
  WITH CHECK (interviewer_id = auth.uid());

CREATE POLICY "Users can update own feedback"
  ON interview_feedback FOR UPDATE
  USING (interviewer_id = auth.uid());

CREATE POLICY "Users can delete own feedback"
  ON interview_feedback FOR DELETE
  USING (interviewer_id = auth.uid());

-- ============================================
-- AUTOPILOT CAMPAIGNS
-- ============================================
ALTER TABLE autopilot_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own campaigns"
  ON autopilot_campaigns FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own campaigns"
  ON autopilot_campaigns FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own campaigns"
  ON autopilot_campaigns FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own campaigns"
  ON autopilot_campaigns FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- AUTOPILOT QUEUE
-- ============================================
ALTER TABLE autopilot_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own queue items"
  ON autopilot_queue FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own queue items"
  ON autopilot_queue FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own queue items"
  ON autopilot_queue FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own queue items"
  ON autopilot_queue FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- DONE
-- ============================================
SELECT 'RLS policies applied successfully!' as status;
