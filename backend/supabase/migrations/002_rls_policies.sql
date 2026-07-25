-- Touchstones Row Level Security (RLS) Policies
-- This ensures each user can only access their own data

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_outreach_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_workflow_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_pipeline_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_pipeline_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_candidate_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopilot_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_preferred_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopilot_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_follow_ups_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_activity_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PROFILES POLICIES
-- ============================================

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- ============================================
-- JOBS POLICIES
-- ============================================

-- Users can view their own jobs
CREATE POLICY "Users can view own jobs"
    ON jobs FOR SELECT
    USING (auth.uid() = created_by);

-- Users can view scraped jobs (public)
CREATE POLICY "Users can view scraped jobs"
    ON jobs FOR SELECT
    USING (is_scraped = true);

-- Users can create jobs
CREATE POLICY "Users can create jobs"
    ON jobs FOR INSERT
    WITH CHECK (auth.uid() = created_by);

-- Users can update their own jobs
CREATE POLICY "Users can update own jobs"
    ON jobs FOR UPDATE
    USING (auth.uid() = created_by);

-- Users can delete their own jobs
CREATE POLICY "Users can delete own jobs"
    ON jobs FOR DELETE
    USING (auth.uid() = created_by);

-- ============================================
-- CANDIDATES POLICIES
-- ============================================

-- Users can view their own candidates
CREATE POLICY "Users can view own candidates"
    ON candidates FOR SELECT
    USING (auth.uid() = created_by);

-- Users can create candidates
CREATE POLICY "Users can create candidates"
    ON candidates FOR INSERT
    WITH CHECK (auth.uid() = created_by);

-- Users can update their own candidates
CREATE POLICY "Users can update own candidates"
    ON candidates FOR UPDATE
    USING (auth.uid() = created_by);

-- Users can delete their own candidates
CREATE POLICY "Users can delete own candidates"
    ON candidates FOR DELETE
    USING (auth.uid() = created_by);

-- ============================================
-- CANDIDATE SUBMISSIONS POLICIES
-- ============================================

-- Users can view their own submissions or submissions shared with them
CREATE POLICY "Users can view own or shared submissions"
    ON candidate_submissions FOR SELECT
    USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM submission_shares
            WHERE submission_shares.submission_id = candidate_submissions.id
            AND submission_shares.shared_with_user_id = auth.uid()
        )
    );

-- Users can create submissions
CREATE POLICY "Users can create submissions"
    ON candidate_submissions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own submissions
CREATE POLICY "Users can update own submissions"
    ON candidate_submissions FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own submissions
CREATE POLICY "Users can delete own submissions"
    ON candidate_submissions FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- SUBMISSION SHARES POLICIES
-- ============================================

-- Users can view shares for their submissions
CREATE POLICY "Users can view shares for own submissions"
    ON submission_shares FOR SELECT
    USING (
        auth.uid() = shared_with_user_id
        OR EXISTS (
            SELECT 1 FROM candidate_submissions
            WHERE candidate_submissions.id = submission_shares.submission_id
            AND candidate_submissions.user_id = auth.uid()
        )
    );

-- Owners can create shares
CREATE POLICY "Owners can create shares"
    ON submission_shares FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM candidate_submissions
            WHERE candidate_submissions.id = submission_shares.submission_id
            AND candidate_submissions.user_id = auth.uid()
        )
    );

-- Owners can delete shares
CREATE POLICY "Owners can delete shares"
    ON submission_shares FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM candidate_submissions
            WHERE candidate_submissions.id = submission_shares.submission_id
            AND candidate_submissions.user_id = auth.uid()
        )
    );

-- ============================================
-- SUBMISSION COMMENTS POLICIES
-- ============================================

-- Users can view comments on submissions they can access
CREATE POLICY "Users can view accessible submission comments"
    ON submission_comments FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM candidate_submissions cs
            LEFT JOIN submission_shares ss ON ss.submission_id = cs.id
            WHERE cs.id = submission_comments.submission_id
            AND (cs.user_id = auth.uid() OR ss.shared_with_user_id = auth.uid())
        )
    );

-- Users can create comments on accessible submissions
CREATE POLICY "Users can create comments on accessible submissions"
    ON submission_comments FOR INSERT
    WITH CHECK (
        auth.uid() = created_by
        AND EXISTS (
            SELECT 1 FROM candidate_submissions cs
            LEFT JOIN submission_shares ss ON ss.submission_id = cs.id
            WHERE cs.id = submission_comments.submission_id
            AND (cs.user_id = auth.uid() OR ss.shared_with_user_id = auth.uid())
        )
    );

-- ============================================
-- OUTREACH LOGS POLICIES
-- ============================================

CREATE POLICY "Users can view own outreach logs"
    ON outreach_logs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create outreach logs"
    ON outreach_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own outreach logs"
    ON outreach_logs FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================
-- NOTIFICATIONS POLICIES
-- ============================================

CREATE POLICY "Users can view own notifications"
    ON notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE
    USING (auth.uid() = user_id);

-- System can create notifications (via service role)
CREATE POLICY "Service can create notifications"
    ON notifications FOR INSERT
    WITH CHECK (true);

-- ============================================
-- SAVED FILTERS POLICIES
-- ============================================

CREATE POLICY "Users can view own saved filters"
    ON saved_filters FOR SELECT
    USING (auth.uid() = recruiter_id);

CREATE POLICY "Users can create saved filters"
    ON saved_filters FOR INSERT
    WITH CHECK (auth.uid() = recruiter_id);

CREATE POLICY "Users can update own saved filters"
    ON saved_filters FOR UPDATE
    USING (auth.uid() = recruiter_id);

CREATE POLICY "Users can delete own saved filters"
    ON saved_filters FOR DELETE
    USING (auth.uid() = recruiter_id);

-- ============================================
-- RECRUITER CANDIDATE STATUS POLICIES
-- ============================================

CREATE POLICY "Users can view own recruiter status"
    ON recruiter_candidate_status FOR SELECT
    USING (auth.uid() = recruiter_user_id);

CREATE POLICY "Users can create recruiter status"
    ON recruiter_candidate_status FOR INSERT
    WITH CHECK (auth.uid() = recruiter_user_id);

CREATE POLICY "Users can update own recruiter status"
    ON recruiter_candidate_status FOR UPDATE
    USING (auth.uid() = recruiter_user_id);

CREATE POLICY "Users can delete own recruiter status"
    ON recruiter_candidate_status FOR DELETE
    USING (auth.uid() = recruiter_user_id);

-- ============================================
-- AUTOPILOT CAMPAIGNS POLICIES
-- ============================================

CREATE POLICY "Users can view own campaigns"
    ON autopilot_campaigns FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create campaigns"
    ON autopilot_campaigns FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own campaigns"
    ON autopilot_campaigns FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own campaigns"
    ON autopilot_campaigns FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- CAMPAIGN FOLLOW-UPS POLICIES
-- ============================================

CREATE POLICY "Users can view campaign follow-ups"
    ON campaign_follow_ups FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM autopilot_campaigns
            WHERE autopilot_campaigns.id = campaign_follow_ups.campaign_id
            AND autopilot_campaigns.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage campaign follow-ups"
    ON campaign_follow_ups FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM autopilot_campaigns
            WHERE autopilot_campaigns.id = campaign_follow_ups.campaign_id
            AND autopilot_campaigns.user_id = auth.uid()
        )
    );

-- ============================================
-- AUTOPILOT QUEUE POLICIES
-- ============================================

CREATE POLICY "Users can view own queue items"
    ON autopilot_queue FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create queue items"
    ON autopilot_queue FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue items"
    ON autopilot_queue FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue items"
    ON autopilot_queue FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- HELPER POLICIES FOR CHILD TABLES
-- ============================================

-- Submission workflow logs - inherit from parent
CREATE POLICY "Users can view workflow logs for own submissions"
    ON submission_workflow_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM candidate_submissions
            WHERE candidate_submissions.id = submission_workflow_logs.submission_id
            AND candidate_submissions.user_id = auth.uid()
        )
    );

-- Pipeline history
CREATE POLICY "Users can view pipeline history for own submissions"
    ON submission_pipeline_history FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM candidate_submissions
            WHERE candidate_submissions.id = submission_pipeline_history.submission_id
            AND candidate_submissions.user_id = auth.uid()
        )
    );

-- Pipeline notes
CREATE POLICY "Users can view pipeline notes for own submissions"
    ON submission_pipeline_notes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM candidate_submissions
            WHERE candidate_submissions.id = submission_pipeline_notes.submission_id
            AND candidate_submissions.user_id = auth.uid()
        )
    );

-- Campaign activity logs
CREATE POLICY "Users can view campaign activity logs"
    ON campaign_activity_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM autopilot_campaigns
            WHERE autopilot_campaigns.id = campaign_activity_logs.campaign_id
            AND autopilot_campaigns.user_id = auth.uid()
        )
    );

-- Queue activity logs
CREATE POLICY "Users can view queue activity logs"
    ON queue_activity_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM autopilot_queue
            WHERE autopilot_queue.id = queue_activity_logs.queue_id
            AND autopilot_queue.user_id = auth.uid()
        )
    );
