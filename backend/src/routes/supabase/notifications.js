/**
 * Notifications Routes - Supabase Version
 * Migrated from MongoDB/Mongoose to Supabase/PostgreSQL
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth } = require('../../middleware/supabaseAuth');

// GET /api/notifications - Get notifications for current user
router.get('/', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { page = 1, limit = 20, unreadOnly = 'false' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let query = db
            .from('notifications')
            .select('*', { count: 'exact' })
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);

        if (unreadOnly === 'true') {
            query = query.eq('read', false);
        }

        const { data: notifications, error, count } = await query;

        if (error) throw error;

        // Get unread count separately
        const { count: unreadCount, error: unreadError } = await db
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', req.user.id)
            .eq('read', false);

        if (unreadError) throw unreadError;

        res.json({
            notifications,
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalNotifications: count,
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Server error fetching notifications' });
    }
});

// GET /api/notifications/unread-count - Get count of unread notifications
router.get('/unread-count', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { count, error } = await db
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', req.user.id)
            .eq('read', false);

        if (error) throw error;

        res.json({ unreadCount: count });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// PUT /api/notifications/:id/read - Mark a notification as read
router.put('/:id/read', supabaseAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const db = req.user.supabase;
        const { data: notification, error } = await db
            .from('notifications')
            .update({
                read: true,
                read_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ message: 'Notification not found' });
            }
            throw error;
        }

        res.json({
            message: 'Notification marked as read',
            notification
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { data, error } = await db
            .from('notifications')
            .update({
                read: true,
                read_at: new Date().toISOString()
            })
            .eq('user_id', req.user.id)
            .eq('read', false)
            .select();

        if (error) throw error;

        res.json({
            message: 'All notifications marked as read',
            updatedCount: data?.length || 0
        });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', supabaseAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const db = req.user.supabase;
        // First check if notification exists and belongs to user
        const { data: existing, error: fetchError } = await db
            .from('notifications')
            .select('id')
            .eq('id', id)
            .eq('user_id', req.user.id)
            .single();

        if (fetchError || !existing) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        const { error } = await db
            .from('notifications')
            .delete()
            .eq('id', id)
            .eq('user_id', req.user.id);

        if (error) throw error;

        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE /api/notifications - Delete all notifications for user
router.delete('/', supabaseAuth, async (req, res) => {
    try {
        const db = req.user.supabase;
        // Get count first
        const { count, error: countError } = await db
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', req.user.id);

        if (countError) throw countError;

        const { error } = await db
            .from('notifications')
            .delete()
            .eq('user_id', req.user.id);

        if (error) throw error;

        res.json({
            message: 'All notifications deleted',
            deletedCount: count
        });
    } catch (error) {
        console.error('Error deleting notifications:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/notifications - Create a notification (internal use)
router.post('/', supabaseAuth, async (req, res) => {
    try {
        const { type, title, message, link, data, metadata } = req.body;

        if (!type || !title) {
            return res.status(400).json({ error: 'Type and title are required' });
        }

        // The table has a `data` jsonb column (no `link`/`metadata` columns). Fold any caller-supplied
        // link/metadata into `data`. `message` is NOT NULL, so default it to the title.
        const payload = (data && typeof data === 'object' ? { ...data } : metadata && typeof metadata === 'object' ? { ...metadata } : {});
        if (link) payload.link = link;

        // Use supabaseAdmin for inserts - no INSERT RLS policy on notifications
        const { data: notification, error } = await supabaseAdmin
            .from('notifications')
            .insert({
                user_id: req.user.id,
                type,
                title,
                message: message || title,
                data: payload
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json(notification);
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
