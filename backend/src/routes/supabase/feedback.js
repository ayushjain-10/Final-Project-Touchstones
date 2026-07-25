/**
 * Feedback Routes - Supabase Version
 * Migrated from MongoDB/Mongoose to Supabase/PostgreSQL
 * AI Interview Feedback Summarizer feature
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');
const aiService = require('../../services/aiService');
const { v4: uuidv4 } = require('uuid');

// Apply auth middleware to all routes
router.use(supabaseAuth);

// Helper to validate UUID format
const isValidUUID = (id) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

/**
 * @route   POST /api/feedback/summarize
 * @desc    Summarize interview feedback notes using AI
 * @access  Private
 */
router.post('/summarize', async (req, res) => {
    try {
        const db = req.user.supabase;
        const {
            candidateId,
            interviewerNotes,
            interviewStage,
            interviewerName,
            saveToCandidate = true
        } = req.body;

        // Validate required fields
        if (!candidateId) {
            return res.status(400).json({
                error: 'candidateId is required'
            });
        }

        if (!interviewerNotes || interviewerNotes.trim().length === 0) {
            return res.status(400).json({
                error: 'interviewerNotes is required and cannot be empty'
            });
        }

        // Validate candidateId format
        if (!isValidUUID(candidateId)) {
            return res.status(400).json({
                error: 'Invalid candidateId format'
            });
        }

        // Find the candidate
        const { data: candidate, error: fetchError } = await db
            .from('candidate_submissions')
            .select('*')
            .eq('id', candidateId)
            .single();

        if (fetchError || !candidate) {
            return res.status(404).json({
                error: 'Candidate not found'
            });
        }

        // Generate AI summary
        const feedbackResult = await aiService.summarizeFeedback(interviewerNotes, {
            interviewStage,
            candidateName: candidate.full_name,
            role: candidate.desired_roles
        });

        // Prepare response
        const response = {
            summary: feedbackResult.summary,
            tags: feedbackResult.tags,
            recommendation: feedbackResult.recommendation,
            rating: feedbackResult.rating,
            saved: false
        };

        // Save to candidate's feedbackHistory if requested
        if (saveToCandidate) {
            const feedbackEntry = {
                id: uuidv4(),
                interviewer_notes: interviewerNotes,
                summary: feedbackResult.summary,
                tags: feedbackResult.tags,
                interview_stage: interviewStage || null,
                interviewer_name: interviewerName || null,
                rating: feedbackResult.rating,
                recommendation: feedbackResult.recommendation,
                created_at: new Date().toISOString(),
                created_by: req.user.id
            };

            // Initialize feedbackHistory if it doesn't exist
            const feedbackHistory = candidate.feedback_history || [];
            feedbackHistory.push(feedbackEntry);

            const { error: updateError } = await db
                .from('candidate_submissions')
                .update({ feedback_history: feedbackHistory })
                .eq('id', candidateId);

            if (updateError) throw updateError;

            response.saved = true;
            response.feedbackId = feedbackEntry.id;
        }

        res.json(response);
    } catch (error) {
        console.error('Error summarizing feedback:', error);
        res.status(500).json({
            error: 'Failed to summarize feedback',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/feedback/:candidateId
 * @desc    Get all feedback history for a candidate
 * @access  Private
 */
router.get('/:candidateId', async (req, res) => {
    try {
        const db = req.user.supabase;
        const { candidateId } = req.params;

        // Validate candidateId format
        if (!isValidUUID(candidateId)) {
            return res.status(400).json({
                error: 'Invalid candidateId format'
            });
        }

        const { data: candidate, error } = await db
            .from('candidate_submissions')
            .select('id, full_name, email, feedback_history')
            .eq('id', candidateId)
            .single();

        if (error || !candidate) {
            return res.status(404).json({
                error: 'Candidate not found'
            });
        }

        const feedbackHistory = candidate.feedback_history || [];

        res.json({
            candidateId: candidate.id,
            candidateName: candidate.full_name,
            candidateEmail: candidate.email,
            feedbackCount: feedbackHistory.length,
            feedbackHistory: feedbackHistory.map(f => ({
                id: f.id,
                interviewerNotes: f.interviewer_notes,
                summary: f.summary,
                tags: f.tags,
                interviewStage: f.interview_stage,
                interviewerName: f.interviewer_name,
                rating: f.rating,
                recommendation: f.recommendation,
                createdAt: f.created_at,
                createdBy: f.created_by
            }))
        });
    } catch (error) {
        console.error('Error fetching feedback history:', error);
        res.status(500).json({
            error: 'Failed to fetch feedback history',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   DELETE /api/feedback/:candidateId/:feedbackId
 * @desc    Delete a specific feedback entry from a candidate's history
 * @access  Private
 */
router.delete('/:candidateId/:feedbackId', async (req, res) => {
    try {
        const db = req.user.supabase;
        const { candidateId, feedbackId } = req.params;

        // Validate IDs
        if (!isValidUUID(candidateId) || !isValidUUID(feedbackId)) {
            return res.status(400).json({
                error: 'Invalid ID format'
            });
        }

        const { data: candidate, error: fetchError } = await db
            .from('candidate_submissions')
            .select('id, feedback_history')
            .eq('id', candidateId)
            .single();

        if (fetchError || !candidate) {
            return res.status(404).json({
                error: 'Candidate not found'
            });
        }

        // Find and remove the feedback entry
        const feedbackHistory = candidate.feedback_history || [];
        const feedbackIndex = feedbackHistory.findIndex(f => f.id === feedbackId);

        if (feedbackIndex === -1) {
            return res.status(404).json({
                error: 'Feedback entry not found'
            });
        }

        feedbackHistory.splice(feedbackIndex, 1);

        const { error: updateError } = await db
            .from('candidate_submissions')
            .update({ feedback_history: feedbackHistory })
            .eq('id', candidateId);

        if (updateError) throw updateError;

        res.json({
            message: 'Feedback entry deleted successfully',
            remainingCount: feedbackHistory.length
        });
    } catch (error) {
        console.error('Error deleting feedback:', error);
        res.status(500).json({
            error: 'Failed to delete feedback',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   POST /api/feedback/summarize-only
 * @desc    Summarize feedback notes without saving (preview mode)
 * @access  Private
 */
router.post('/summarize-only', async (req, res) => {
    try {
        const { interviewerNotes, interviewStage, candidateName, role } = req.body;

        if (!interviewerNotes || interviewerNotes.trim().length === 0) {
            return res.status(400).json({
                error: 'interviewerNotes is required and cannot be empty'
            });
        }

        // Generate AI summary without saving
        const feedbackResult = await aiService.summarizeFeedback(interviewerNotes, {
            interviewStage,
            candidateName,
            role
        });

        res.json({
            summary: feedbackResult.summary,
            tags: feedbackResult.tags,
            recommendation: feedbackResult.recommendation,
            rating: feedbackResult.rating,
            preview: true
        });
    } catch (error) {
        console.error('Error summarizing feedback:', error);
        res.status(500).json({
            error: 'Failed to summarize feedback',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/feedback/analytics/:candidateId
 * @desc    Get analytics/aggregate insights from all feedback for a candidate
 * @access  Private
 */
router.get('/analytics/:candidateId', async (req, res) => {
    try {
        const db = req.user.supabase;
        const { candidateId } = req.params;

        if (!isValidUUID(candidateId)) {
            return res.status(400).json({
                error: 'Invalid candidateId format'
            });
        }

        const { data: candidate, error } = await db
            .from('candidate_submissions')
            .select('id, full_name, feedback_history')
            .eq('id', candidateId)
            .single();

        if (error || !candidate) {
            return res.status(404).json({
                error: 'Candidate not found'
            });
        }

        const feedbackHistory = candidate.feedback_history || [];

        if (feedbackHistory.length === 0) {
            return res.json({
                candidateId,
                candidateName: candidate.full_name,
                totalFeedback: 0,
                analytics: null
            });
        }

        // Calculate analytics
        const ratings = feedbackHistory.filter(f => f.rating).map(f => f.rating);
        const averageRating = ratings.length > 0
            ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
            : null;

        // Aggregate tags
        const allTags = feedbackHistory.flatMap(f => f.tags || []);
        const tagCounts = allTags.reduce((acc, tag) => {
            acc[tag] = (acc[tag] || 0) + 1;
            return acc;
        }, {});
        const topTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count }));

        // Recommendation distribution
        const recommendations = feedbackHistory.filter(f => f.recommendation).map(f => f.recommendation);
        const recCounts = recommendations.reduce((acc, rec) => {
            acc[rec] = (acc[rec] || 0) + 1;
            return acc;
        }, {});

        // Interview stages covered
        const stages = [...new Set(
            feedbackHistory.filter(f => f.interview_stage).map(f => f.interview_stage)
        )];

        // Rating distribution
        const ratingDistribution = ratings.reduce((acc, r) => {
            acc[r] = (acc[r] || 0) + 1;
            return acc;
        }, {});

        res.json({
            candidateId,
            candidateName: candidate.full_name,
            totalFeedback: feedbackHistory.length,
            analytics: {
                averageRating: parseFloat(averageRating),
                ratingDistribution,
                topTags,
                recommendationDistribution: recCounts,
                interviewStagesCovered: stages,
                latestFeedback: feedbackHistory[feedbackHistory.length - 1]?.created_at,
                firstFeedback: feedbackHistory[0]?.created_at
            }
        });
    } catch (error) {
        console.error('Error fetching feedback analytics:', error);
        res.status(500).json({
            error: 'Failed to fetch feedback analytics',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;
