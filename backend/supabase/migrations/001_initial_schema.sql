-- Touchstones Supabase Migration
-- Migrated from MongoDB to PostgreSQL/Supabase

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE subscription_plan AS ENUM ('free', 'growth', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'canceled', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');
CREATE TYPE auth_provider AS ENUM ('local', 'google');

CREATE TYPE job_type AS ENUM ('Full-time', 'Part-time', 'Contract', 'Internship', 'Remote');
CREATE TYPE job_status AS ENUM ('Open', 'Closed', 'On Hold');
CREATE TYPE job_source AS ENUM ('Indeed', 'LinkedIn', 'Glassdoor', 'Monster', 'ZipRecruiter', 'Other');

CREATE TYPE candidate_source AS ENUM ('LinkedIn', 'GitHub', 'Indeed', 'Referral', 'Direct Application', 'Other');
CREATE TYPE candidate_status AS ENUM ('New', 'Contacted', 'Interviewing', 'Offered', 'Hired', 'Rejected', 'Not Interested');
CREATE TYPE outreach_status AS ENUM ('sent', 'responded', 'no-response');
CREATE TYPE message_type AS ENUM ('email', 'linkedin', 'other');

CREATE TYPE submission_status AS ENUM ('new', 'screening', 'contacted', 'interview_scheduled', 'interview_completed', 'interview_canceled', 'offer', 'hired', 'rejected');
CREATE TYPE pipeline_stage AS ENUM ('new', 'contacted', 'replied', 'interviewing', 'offer', 'hired', 'rejected');
CREATE TYPE autopilot_action AS ENUM ('none', 'auto_email_sent', 'outreach_ready', 'recruiter_notified', 'skipped', 'error');
CREATE TYPE interview_source AS ENUM ('calendly', 'google_calendar', 'manual');

CREATE TYPE outreach_channel AS ENUM ('email', 'linkedin');
CREATE TYPE outreach_log_status AS ENUM ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed');
CREATE TYPE outreach_source AS ENUM ('manual', 'autopilot', 'bulk');

CREATE TYPE notification_type AS ENUM ('candidate_shared', 'comment_added', 'feedback_added', 'pipeline_moved', 'interview_scheduled', 'system');

CREATE TYPE experience_level AS ENUM ('entry', 'mid', 'senior', 'lead', 'executive');
CREATE TYPE alert_frequency AS ENUM ('instant', 'daily', 'weekly');

CREATE TYPE recruiter_status AS ENUM ('new', 'shortlisted', 'contacted', 'rejected');

CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');
CREATE TYPE scheduling_provider AS ENUM ('calendly', 'google_calendar', 'manual');

CREATE TYPE queue_status AS ENUM ('pending', 'approved', 'rejected', 'skipped', 'expired', 'processed');
CREATE TYPE response_type AS ENUM ('positive', 'negative', 'neutral', 'out_of_office', 'unsubscribe');
CREATE TYPE response_sentiment AS ENUM ('interested', 'not_interested', 'maybe_later', 'unsubscribed');
CREATE TYPE interview_status AS ENUM ('scheduled', 'completed', 'canceled', 'rescheduled', 'no_show');
CREATE TYPE priority_level AS ENUM ('high', 'medium', 'low');

-- ============================================
-- PROFILES TABLE (extends auth.users)
-- ============================================

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    email TEXT UNIQUE NOT NULL,
    company TEXT,
    provider auth_provider DEFAULT 'local',
    profile_pic TEXT,

    -- Subscription
    subscription_plan subscription_plan DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status subscription_status,
    current_period_end TIMESTAMPTZ,

    -- Calendly integration
    calendly_access_token TEXT,
    calendly_refresh_token TEXT,
    calendly_token_expires_at TIMESTAMPTZ,
    calendly_user_uri TEXT,
    calendly_scheduling_url TEXT,
    calendly_organization_uri TEXT,
    calendly_email TEXT,
    calendly_name TEXT,
    calendly_connected BOOLEAN DEFAULT FALSE,

    -- Google Calendar integration
    google_calendar_access_token TEXT,
    google_calendar_refresh_token TEXT,
    google_calendar_token_expires_at TIMESTAMPTZ,
    google_calendar_id TEXT DEFAULT 'primary',
    google_calendar_name TEXT,
    google_calendar_email TEXT,
    google_calendar_connected BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- JOBS TABLE
-- ============================================

CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    company TEXT DEFAULT 'Our Company',
    description TEXT NOT NULL,
    industry TEXT DEFAULT 'Technology',
    requirements TEXT[] DEFAULT '{}',
    location TEXT DEFAULT 'Remote',
    type job_type DEFAULT 'Full-time',
    status job_status DEFAULT 'Open',
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

    -- Scraped job fields
    is_scraped BOOLEAN DEFAULT FALSE,
    source job_source,
    source_url TEXT,
    salary TEXT,
    posted_date TEXT,
    scraped_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full text search index for jobs
CREATE INDEX jobs_search_idx ON jobs USING gin(
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(company, '') || ' ' || coalesce(industry, ''))
);

-- ============================================
-- CANDIDATES TABLE (Legacy pool)
-- ============================================

CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    title TEXT,
    skills TEXT[] DEFAULT '{}',
    experience TEXT,
    education TEXT,
    domain TEXT,
    summary TEXT,
    match_score INTEGER DEFAULT 0 CHECK (match_score >= 0 AND match_score <= 100),
    is_autotagged BOOLEAN DEFAULT FALSE,
    location TEXT,
    source candidate_source DEFAULT 'Other',
    resume_url TEXT,
    resume_text TEXT,
    status candidate_status DEFAULT 'New',
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full text search index for candidates
CREATE INDEX candidates_search_idx ON candidates USING gin(
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(title, '') || ' ' || coalesce(array_to_string(skills, ' '), '') || ' ' || coalesce(domain, '') || ' ' || coalesce(summary, ''))
);

-- Junction table for candidates applied to jobs
CREATE TABLE candidate_jobs (
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (candidate_id, job_id)
);

-- Outreach history for candidates
CREATE TABLE candidate_outreach_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    message_type message_type DEFAULT 'email',
    message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    status outreach_status DEFAULT 'sent'
);

-- ============================================
-- CANDIDATE SUBMISSIONS TABLE
-- ============================================

CREATE TABLE candidate_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    location TEXT,
    desired_roles TEXT,
    visa_status TEXT,
    linkedin_url TEXT,
    resume_file_url TEXT NOT NULL,
    resume_original_name TEXT,
    resume_mime_type TEXT,
    resume_text TEXT,

    -- AI-enhanced fields
    skills TEXT[] DEFAULT '{}',
    education TEXT,
    domain TEXT,
    summary TEXT,
    match_score INTEGER DEFAULT 0 CHECK (match_score >= 0 AND match_score <= 100),
    is_autotagged BOOLEAN DEFAULT FALSE,

    -- Autopilot tracking
    autopilot_triggered BOOLEAN DEFAULT FALSE,
    autopilot_triggered_at TIMESTAMPTZ,
    autopilot_best_match_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    autopilot_best_match_score INTEGER CHECK (autopilot_best_match_score >= 0 AND autopilot_best_match_score <= 100),
    autopilot_action_taken autopilot_action DEFAULT 'none',
    autopilot_email_sent_at TIMESTAMPTZ,
    autopilot_email_message_id TEXT,

    -- Consent
    consent_given BOOLEAN NOT NULL,
    consent_timestamp TIMESTAMPTZ DEFAULT NOW(),
    marketing_opt_in BOOLEAN DEFAULT FALSE,

    -- Status and interview
    status submission_status DEFAULT 'new',
    interview_scheduled_at TIMESTAMPTZ,
    interview_event_id TEXT,
    interview_event_link TEXT,
    interview_meet_link TEXT,
    interview_source interview_source,

    -- Pipeline
    pipeline_stage pipeline_stage DEFAULT 'new',
    last_pipeline_activity TIMESTAMPTZ DEFAULT NOW(),

    -- Ownership
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX candidate_submissions_email_idx ON candidate_submissions(email);
CREATE INDEX candidate_submissions_user_idx ON candidate_submissions(user_id);
CREATE INDEX candidate_submissions_pipeline_idx ON candidate_submissions(pipeline_stage);
CREATE INDEX candidate_submissions_status_idx ON candidate_submissions(status);

-- Workflow log for autopilot
CREATE TABLE submission_workflow_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline history
CREATE TABLE submission_pipeline_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    from_stage pipeline_stage,
    to_stage pipeline_stage NOT NULL,
    moved_at TIMESTAMPTZ DEFAULT NOW(),
    moved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    note TEXT
);

-- Pipeline notes
CREATE TABLE submission_pipeline_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared with (collaboration)
CREATE TABLE submission_shares (
    submission_id UUID REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    shared_with_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    shared_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (submission_id, shared_with_user_id)
);

-- Comments on submissions
CREATE TABLE submission_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- OUTREACH LOGS TABLE
-- ============================================

CREATE TABLE outreach_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    candidate_id UUID,
    candidate_model TEXT DEFAULT 'CandidateSubmission' CHECK (candidate_model IN ('Candidate', 'CandidateSubmission')),
    candidate_name TEXT,
    candidate_email TEXT,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    job_title TEXT,

    channel outreach_channel NOT NULL,
    subject TEXT,
    message_body TEXT,
    message_id TEXT,

    status outreach_log_status DEFAULT 'sent',
    source outreach_source DEFAULT 'manual',
    match_score INTEGER CHECK (match_score >= 0 AND match_score <= 100),
    error TEXT,

    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX outreach_logs_user_sent_idx ON outreach_logs(user_id, sent_at DESC);
CREATE INDEX outreach_logs_user_channel_idx ON outreach_logs(user_id, channel);
CREATE INDEX outreach_logs_user_source_idx ON outreach_logs(user_id, source);
CREATE INDEX outreach_logs_user_status_idx ON outreach_logs(user_id, status);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notifications_user_read_idx ON notifications(user_id, read, created_at DESC);

-- ============================================
-- SAVED FILTERS TABLE
-- ============================================

CREATE TABLE saved_filters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recruiter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,

    -- Filter criteria
    filter_domain TEXT,
    filter_skills TEXT[] DEFAULT '{}',
    filter_location TEXT,
    filter_min_match_score INTEGER DEFAULT 0 CHECK (filter_min_match_score >= 0 AND filter_min_match_score <= 100),
    filter_visa_status TEXT,
    filter_experience_level experience_level,

    -- Alert settings
    alert_enabled BOOLEAN DEFAULT TRUE,
    alert_frequency alert_frequency DEFAULT 'instant',
    last_alert_sent TIMESTAMPTZ,

    -- Tracking
    match_count INTEGER DEFAULT 0,
    last_match_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX saved_filters_recruiter_idx ON saved_filters(recruiter_id, created_at DESC);

-- ============================================
-- RECRUITER CANDIDATE STATUS TABLE
-- ============================================

CREATE TABLE recruiter_candidate_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recruiter_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    status recruiter_status DEFAULT 'new',
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(recruiter_user_id, candidate_id)
);

-- ============================================
-- AUTOPILOT CAMPAIGNS TABLE
-- ============================================

CREATE TABLE autopilot_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    target_job UUID REFERENCES jobs(id) ON DELETE SET NULL,

    -- Target criteria (stored as JSONB for flexibility)
    target_criteria JSONB DEFAULT '{
        "skills": [],
        "minMatchScore": 70,
        "locations": [],
        "experienceLevel": "any",
        "domains": []
    }',

    -- Email sequence configuration
    email_sequence_enabled BOOLEAN DEFAULT TRUE,
    email_initial_subject TEXT,
    email_initial_body TEXT,
    email_max_follow_ups INTEGER DEFAULT 3 CHECK (email_max_follow_ups >= 0 AND email_max_follow_ups <= 10),

    -- Automation settings
    auto_source_candidates BOOLEAN DEFAULT TRUE,
    require_approval BOOLEAN DEFAULT TRUE,
    auto_send_initial_email BOOLEAN DEFAULT FALSE,
    auto_schedule_interviews BOOLEAN DEFAULT FALSE,
    daily_limit INTEGER DEFAULT 50 CHECK (daily_limit >= 1 AND daily_limit <= 200),
    weekly_limit INTEGER DEFAULT 200 CHECK (weekly_limit >= 1 AND weekly_limit <= 1000),

    -- Scheduling
    scheduling_enabled BOOLEAN DEFAULT FALSE,
    scheduling_provider scheduling_provider DEFAULT 'calendly',
    calendly_event_type TEXT,
    google_calendar_id TEXT,
    interview_duration INTEGER DEFAULT 30,
    availability_days_ahead INTEGER DEFAULT 14,

    -- Status
    status campaign_status DEFAULT 'draft',

    -- Metrics
    candidates_sourced INTEGER DEFAULT 0,
    candidates_approved INTEGER DEFAULT 0,
    candidates_rejected INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_replied INTEGER DEFAULT 0,
    interviews_scheduled INTEGER DEFAULT 0,
    offers_extended INTEGER DEFAULT 0,
    hires INTEGER DEFAULT 0,

    -- Timestamps
    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX autopilot_campaigns_user_status_idx ON autopilot_campaigns(user_id, status);
CREATE INDEX autopilot_campaigns_target_job_idx ON autopilot_campaigns(target_job);

-- Campaign follow-ups
CREATE TABLE campaign_follow_ups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES autopilot_campaigns(id) ON DELETE CASCADE,
    delay_days INTEGER NOT NULL CHECK (delay_days >= 1),
    subject TEXT,
    body TEXT,
    send_only_if_no_reply BOOLEAN DEFAULT TRUE,
    sequence_order INTEGER NOT NULL
);

-- Campaign activity log
CREATE TABLE campaign_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES autopilot_campaigns(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB,
    performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign preferred times
CREATE TABLE campaign_preferred_times (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES autopilot_campaigns(id) ON DELETE CASCADE,
    day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_hour INTEGER,
    end_hour INTEGER
);

-- ============================================
-- AUTOPILOT QUEUE TABLE
-- ============================================

CREATE TABLE autopilot_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES autopilot_campaigns(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Match details
    match_score INTEGER NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
    match_reason TEXT,
    match_details JSONB DEFAULT '{}',

    -- Queue status
    status queue_status DEFAULT 'pending',

    -- Review
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    review_note TEXT,

    -- Email sequence tracking
    email_current_step INTEGER DEFAULT 0,
    email_initial_sent BOOLEAN DEFAULT FALSE,
    email_initial_sent_at TIMESTAMPTZ,
    email_initial_message_id TEXT,
    email_last_sent_at TIMESTAMPTZ,
    email_next_follow_up_at TIMESTAMPTZ,
    email_sequence_completed BOOLEAN DEFAULT FALSE,
    email_sequence_completed_at TIMESTAMPTZ,

    -- Response tracking
    response_received BOOLEAN DEFAULT FALSE,
    response_received_at TIMESTAMPTZ,
    response_type response_type,
    response_content TEXT,
    response_sentiment response_sentiment,

    -- Interview
    interview_scheduled BOOLEAN DEFAULT FALSE,
    interview_scheduled_at TIMESTAMPTZ,
    interview_event_id TEXT,
    interview_event_link TEXT,
    interview_meet_link TEXT,
    interview_provider scheduling_provider,
    interview_status interview_status,
    interview_feedback TEXT,

    -- Priority
    priority priority_level DEFAULT 'medium',
    priority_score INTEGER DEFAULT 50,

    -- Generated outreach
    generated_subject TEXT,
    generated_body TEXT,
    generated_at TIMESTAMPTZ,
    outreach_edited BOOLEAN DEFAULT FALSE,
    outreach_edited_body TEXT,

    -- Expiration
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX autopilot_queue_campaign_status_idx ON autopilot_queue(campaign_id, status);
CREATE INDEX autopilot_queue_user_status_priority_idx ON autopilot_queue(user_id, status, priority);
CREATE INDEX autopilot_queue_user_status_created_idx ON autopilot_queue(user_id, status, created_at DESC);
CREATE INDEX autopilot_queue_follow_up_idx ON autopilot_queue(email_next_follow_up_at, status);

-- Queue follow-ups sent
CREATE TABLE queue_follow_ups_sent (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id UUID NOT NULL REFERENCES autopilot_queue(id) ON DELETE CASCADE,
    step INTEGER NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    message_id TEXT
);

-- Queue activity log
CREATE TABLE queue_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id UUID NOT NULL REFERENCES autopilot_queue(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FUNCTIONS AND TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to all tables
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_candidates_updated_at BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_candidate_submissions_updated_at BEFORE UPDATE ON candidate_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_outreach_logs_updated_at BEFORE UPDATE ON outreach_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_saved_filters_updated_at BEFORE UPDATE ON saved_filters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recruiter_candidate_status_updated_at BEFORE UPDATE ON recruiter_candidate_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_autopilot_campaigns_updated_at BEFORE UPDATE ON autopilot_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_autopilot_queue_updated_at BEFORE UPDATE ON autopilot_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email, first_name, last_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', '')
    );
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Trigger to auto-create profile on signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
