-- Enable Supabase Realtime for key tables
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
--
-- This adds tables to the supabase_realtime publication so that
-- postgres_changes events are broadcast to connected clients.

-- Notifications: live badge updates when new notifications arrive
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Candidate Submissions: live pipeline updates when collaborators move candidates
ALTER PUBLICATION supabase_realtime ADD TABLE candidate_submissions;

-- Comments: live comment thread updates
ALTER PUBLICATION supabase_realtime ADD TABLE comments;

-- Verify the publication includes the tables
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
