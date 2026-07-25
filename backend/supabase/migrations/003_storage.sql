-- Touchstones Storage Configuration
-- Creates storage bucket for resumes with proper policies

-- Create the resumes bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'resumes',
    'resumes',
    false,  -- Private bucket
    52428800,  -- 50MB limit
    ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can upload to their own folder
CREATE POLICY "Users can upload resumes to own folder"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'resumes'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy: Users can view their own resumes
CREATE POLICY "Users can view own resumes"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'resumes'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy: Users can view resumes of candidates shared with them
CREATE POLICY "Users can view shared candidate resumes"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'resumes'
        AND EXISTS (
            SELECT 1 FROM candidate_submissions cs
            JOIN submission_shares ss ON ss.submission_id = cs.id
            WHERE cs.resume_file_url LIKE '%' || storage.objects.name || '%'
            AND ss.shared_with_user_id = auth.uid()
        )
    );

-- Policy: Users can delete their own resumes
CREATE POLICY "Users can delete own resumes"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'resumes'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy: Users can update their own resumes
CREATE POLICY "Users can update own resumes"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'resumes'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
