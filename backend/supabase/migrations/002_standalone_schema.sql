-- Touchstones Standalone Schema
-- Run this in Supabase SQL Editor if auth.users dependency causes issues
-- This creates tables without foreign key to auth.users

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES TABLE (standalone, no auth.users ref)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    first_name TEXT,
    last_name TEXT,
    company TEXT,
    role TEXT DEFAULT 'recruiter',
    provider TEXT DEFAULT 'local',
    profile_pic TEXT,

    -- Subscription (stored as JSONB for flexibility)
    subscription JSONB DEFAULT '{"plan": "free", "status": "active"}',

    -- Calendar integrations
    calendly JSONB DEFAULT '{}',
    google_calendar JSONB DEFAULT '{}',

    -- Password reset
    reset_password_token TEXT,
    reset_password_expires TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- JOBS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    company TEXT DEFAULT 'Our Company',
    description TEXT,
    industry TEXT DEFAULT 'Technology',
    requirements TEXT[] DEFAULT '{}',
    location TEXT DEFAULT 'Remote',
    type TEXT DEFAULT 'Full-time',
    status TEXT DEFAULT 'Open',
    recruiter_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

    -- Scraped job fields
    is_scraped BOOLEAN DEFAULT FALSE,
    source TEXT,
    source_url TEXT,
    salary TEXT,
    posted_date TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CANDIDATES TABLE (for job applications)
-- ============================================
CREATE TABLE IF NOT EXISTS candidates (
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
    match_score INTEGER DEFAULT 0,
    is_autotagged BOOLEAN DEFAULT FALSE,
    location TEXT,
    source TEXT DEFAULT 'Other',
    resume_url TEXT,
    resume_text TEXT,
    status TEXT DEFAULT 'New',
    notes TEXT,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    recruiter_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CANDIDATE SUBMISSIONS (talent pool)
-- ============================================
CREATE TABLE IF NOT EXISTS candidate_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    location TEXT,
    desired_roles TEXT,
    visa_status TEXT,
    linkedin_url TEXT,
    resume_file_url TEXT,
    resume_original_name TEXT,
    resume_mime_type TEXT,
    resume_text TEXT,

    -- AI fields
    skills TEXT[] DEFAULT '{}',
    education TEXT,
    domain TEXT,
    summary TEXT,
    match_score INTEGER DEFAULT 0,
    is_autotagged BOOLEAN DEFAULT FALSE,

    -- Autopilot (stored as JSONB)
    autopilot JSONB DEFAULT '{}',

    -- Status
    status TEXT DEFAULT 'new',
    pipeline_stage TEXT DEFAULT 'new',

    -- Interview
    interview JSONB DEFAULT '{}',

    -- Consent
    consent_given BOOLEAN DEFAULT TRUE,
    marketing_opt_in BOOLEAN DEFAULT FALSE,

    -- Ownership & sharing
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    shared_with UUID[] DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PIPELINE STAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    color TEXT DEFAULT '#3B82F6',
    is_default BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SAVED FILTERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS saved_filters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT FALSE,
    alert_enabled BOOLEAN DEFAULT FALSE,
    alert_frequency TEXT DEFAULT 'daily',
    last_alert_sent TIMESTAMPTZ,
    match_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RECRUITER CANDIDATE STATUSES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS recruiter_candidate_statuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recruiter_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'new',
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(recruiter_user_id, candidate_id)
);

-- ============================================
-- OUTREACH LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS outreach_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    candidate_id UUID,
    candidate_name TEXT,
    candidate_email TEXT,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    job_title TEXT,

    channel TEXT DEFAULT 'email',
    subject TEXT,
    message_body TEXT,
    message_id TEXT,

    status TEXT DEFAULT 'sent',
    source TEXT DEFAULT 'manual',
    match_score INTEGER,
    error TEXT,

    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- COMMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INTERVIEW FEEDBACK TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS interview_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
    technical_rating INTEGER CHECK (technical_rating >= 1 AND technical_rating <= 5),
    communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
    culture_fit_rating INTEGER CHECK (culture_fit_rating >= 1 AND culture_fit_rating <= 5),

    recommendation TEXT,
    strengths TEXT[] DEFAULT '{}',
    areas_for_improvement TEXT[] DEFAULT '{}',
    notes TEXT,

    ai_summary TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTOPILOT CAMPAIGNS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS autopilot_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    target_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

    target_criteria JSONB DEFAULT '{}',
    email_sequence JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',

    status TEXT DEFAULT 'draft',

    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTOPILOT QUEUE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS autopilot_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES autopilot_campaigns(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidate_submissions(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    match_score INTEGER DEFAULT 0,
    match_reason TEXT,
    match_details JSONB DEFAULT '{}',

    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'medium',

    email_tracking JSONB DEFAULT '{}',
    response_tracking JSONB DEFAULT '{}',
    interview_tracking JSONB DEFAULT '{}',

    generated_subject TEXT,
    generated_body TEXT,

    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    review_note TEXT,

    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_recruiter ON jobs(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_email ON candidate_submissions(email);
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_user ON candidate_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_candidate_submissions_status ON candidate_submissions(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_user ON outreach_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_candidate ON comments(candidate_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_queue_user_status ON autopilot_queue(user_id, status);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN ('profiles', 'jobs', 'candidates', 'candidate_submissions',
                          'notifications', 'outreach_logs', 'comments', 'interview_feedback',
                          'autopilot_campaigns', 'autopilot_queue', 'saved_filters',
                          'recruiter_candidate_statuses', 'pipeline_stages')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %I', t, t);
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END;
$$;

-- Success message
SELECT 'Schema created successfully!' as status;
