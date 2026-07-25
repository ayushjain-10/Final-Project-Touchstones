/**
 * Comments Routes - Supabase Version
 * Phase 6A: Normalized to use the 'comments' table instead of JSONB array
 * Candidate comments with notifications
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');

// Apply auth middleware to all routes
router.use(supabaseAuth);

/**
 * @route GET /api/comments/:candidateId
 * @desc Get all comments for a candidate
 * @access Private
 */
router.get('/:candidateId', async (req, res) => {
    try {
        const { candidateId } = req.params;

        const db = req.user.supabase;

        // Fetch candidate for access check
        const { data: candidate, error } = await db
            .from('candidate_submissions')
            .select('id, user_id, full_name, shared_with')
            .eq('id', candidateId)
            .single();

        if (error || !candidate) {
            return res.status(404).json({ message: 'Candidate not found' });
        }

        // Check access: owner or shared with
        const isOwner = candidate.user_id === req.user.id;
        const sharedWith = candidate.shared_with || [];
        const isSharedWith = sharedWith.includes(req.user.id);

        if (!isOwner && !isSharedWith) {
            return res.status(403).json({
                message: 'You do not have access to this candidate'
            });
        }

        // Query comments from the normalized comments table with author join
        const { data: comments, error: commentsError } = await supabaseAdmin
            .from('comments')
            .select('id, content, created_at, user_id')
            .eq('candidate_id', candidateId)
            .order('created_at', { ascending: false });

        if (commentsError) throw commentsError;

        // Get author details
        const authorIds = [...new Set((comments || []).filter(c => c.user_id).map(c => c.user_id))];

        let authorsMap = {};
        if (authorIds.length > 0) {
            const { data: authors } = await supabaseAdmin
                .from('profiles')
                .select('id, email, first_name, last_name')
                .in('id', authorIds);

            if (authors) {
                authors.forEach(author => {
                    authorsMap[author.id] = author;
                });
            }
        }

        // Format comments (preserve API response shape)
        const formattedComments = (comments || []).map(c => {
            const author = authorsMap[c.user_id];
            return {
                id: c.id,
                content: c.content,
                createdAt: c.created_at,
                author: author ? {
                    id: author.id,
                    email: author.email,
                    name: `${author.first_name || ''} ${author.last_name || ''}`.trim() || author.email
                } : null
            };
        });

        res.json({
            candidateId,
            candidateName: candidate.full_name,
            comments: formattedComments
        });

    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ message: 'Server error fetching comments' });
    }
});

/**
 * @route POST /api/comments/:candidateId
 * @desc Add a comment to a candidate
 * @access Private
 */
router.post('/:candidateId', async (req, res) => {
    try {
        const { candidateId } = req.params;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ message: 'Comment content is required' });
        }

        const db = req.user.supabase;

        // Fetch candidate for access check
        const { data: candidate, error: fetchError } = await db
            .from('candidate_submissions')
            .select('id, user_id, full_name, shared_with')
            .eq('id', candidateId)
            .single();

        if (fetchError || !candidate) {
            return res.status(404).json({ message: 'Candidate not found' });
        }

        // Check access: owner or shared with
        const isOwner = candidate.user_id === req.user.id;
        const sharedWith = candidate.shared_with || [];
        const isSharedWith = sharedWith.includes(req.user.id);

        if (!isOwner && !isSharedWith) {
            return res.status(403).json({
                message: 'You do not have access to comment on this candidate'
            });
        }

        // Insert comment into normalized comments table
        const { data: newComment, error: insertError } = await supabaseAdmin
            .from('comments')
            .insert({
                candidate_id: candidateId,
                user_id: req.user.id,
                content: content.trim()
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // Create notifications for others with access
        const usersToNotify = [];

        // Notify owner if not the commenter
        if (candidate.user_id && candidate.user_id !== req.user.id) {
            usersToNotify.push(candidate.user_id);
        }

        // Notify shared users if not the commenter
        sharedWith.forEach(userId => {
            if (userId !== req.user.id) {
                usersToNotify.push(userId);
            }
        });

        // E-12: one bulk insert instead of a sequential per-user await loop (faster; no partial set).
        if (usersToNotify.length) {
            const notifRows = usersToNotify.map((userId) => ({
                user_id: userId,
                type: 'comment_added',
                title: 'New Comment',
                message: `${req.user.email} commented on ${candidate.full_name}`,
                data: {
                    candidateId: candidate.id,
                    candidateName: candidate.full_name,
                    commentPreview: content.substring(0, 100),
                    commentBy: req.user.id,
                    commentByEmail: req.user.email
                }
            }));
            const { error: notifError } = await supabaseAdmin.from('notifications').insert(notifRows);
            if (notifError) console.error('Failed to create comment notifications:', notifError.message);
        }

        res.status(201).json({
            message: 'Comment added successfully',
            comment: {
                id: newComment.id,
                content: newComment.content,
                createdAt: newComment.created_at,
                author: {
                    id: req.user.id,
                    email: req.user.email
                }
            }
        });

    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ message: 'Server error adding comment' });
    }
});

/**
 * @route DELETE /api/comments/:candidateId/:commentId
 * @desc Delete a comment
 * @access Private
 */
router.delete('/:candidateId/:commentId', async (req, res) => {
    try {
        const { candidateId, commentId } = req.params;

        const db = req.user.supabase;

        // Verify candidate exists
        const { data: candidate, error: fetchError } = await db
            .from('candidate_submissions')
            .select('id')
            .eq('id', candidateId)
            .single();

        if (fetchError || !candidate) {
            return res.status(404).json({ message: 'Candidate not found' });
        }

        // Find the comment and verify ownership
        const { data: comment, error: commentError } = await supabaseAdmin
            .from('comments')
            .select('id, user_id')
            .eq('id', commentId)
            .eq('candidate_id', candidateId)
            .single();

        if (commentError || !comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        // Only comment author can delete
        if (comment.user_id !== req.user.id) {
            return res.status(403).json({
                message: 'You can only delete your own comments'
            });
        }

        // Delete comment from table
        const { error: deleteError } = await supabaseAdmin
            .from('comments')
            .delete()
            .eq('id', commentId);

        if (deleteError) throw deleteError;

        res.json({ message: 'Comment deleted successfully' });

    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ message: 'Server error deleting comment' });
    }
});

module.exports = router;
