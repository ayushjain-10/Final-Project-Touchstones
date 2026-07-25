/**
 * Candidates Routes - Supabase Version
 * Migrated from MongoDB/Mongoose to Supabase/PostgreSQL
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth, optionalSupabaseAuth } = require('../../middleware/supabaseAuth');

// GET /api/candidates - Get all candidates with filtering
router.get('/', supabaseAuth, async (req, res) => {
    try {
        const { status, source, search, limit = 20, page = 1 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // SECURITY (REVIEW-2026-06 §D): READ routes are hard-authed and ALWAYS
        // token-scoped — `req.user.supabase` is the RLS-enforced per-request client.
        // Never the service-role client (that bypassed RLS → cross-tenant PII leak).
        const db = req.user.supabase;

        let query = db
            .from('candidates')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);

        // Filter by status if provided
        if (status) {
            query = query.eq('status', status);
        }

        // Filter by source if provided
        if (source) {
            query = query.eq('source', source);
        }

        // Full-text search on name, title, skills
        if (search) {
            query = query.or(`name.ilike.%${search}%,title.ilike.%${search}%,email.ilike.%${search}%`);
        }

        // SECURITY: always scope to the authenticated recruiter. Defence-in-depth
        // alongside RLS — never widen the result set to other tenants' rows.
        query = query.eq('recruiter_id', req.user.id);

        const { data: candidates, error, count } = await query;

        if (error) throw error;

        res.json({
            candidates,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error getting candidates:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/candidates/:id - Get a specific candidate
router.get('/:id', supabaseAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // SECURITY (REVIEW-2026-06 §D): hard-authed, always token-scoped (RLS-enforced).
        // Never the service-role client (that returned ANY candidate by id, cross-tenant).
        const db = req.user.supabase;

        const { data: candidate, error } = await db
            .from('candidates')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Candidate not found' });
            }
            throw error;
        }

        res.json(candidate);
    } catch (error) {
        console.error('Error getting candidate by id:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/candidates - Create a new candidate
router.post('/', optionalSupabaseAuth, async (req, res) => {
    try {
        const {
            name, email, phone, title, skills,
            experience, location, source, notes
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        // Parse skills if provided as string
        const parsedSkills = Array.isArray(skills)
            ? skills
            : skills?.split(',').map(s => s.trim()) || [];

        // SECURITY: fall back to the ANON (RLS-enforced) client for unauthenticated
        // requests — NEVER the service-role client (that bypassed RLS → cross-tenant PII).
        const db = req.user?.supabase || supabase;

        const { data: candidate, error } = await db
            .from('candidates')
            .insert({
                name,
                email,
                phone,
                title,
                skills: parsedSkills,
                experience,
                location,
                source: source || 'Manual',
                notes,
                recruiter_id: req.user?.id || null
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json(candidate);
    } catch (error) {
        console.error('Error creating candidate:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/candidates/:id - Update a candidate
router.put('/:id', optionalSupabaseAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // SECURITY: fall back to the ANON (RLS-enforced) client for unauthenticated
        // requests — NEVER the service-role client (that bypassed RLS → cross-tenant PII).
        const db = req.user?.supabase || supabase;
        const {
            name, email, phone, title, skills,
            experience, location, source, notes, status
        } = req.body;

        // Build updates object
        const updates = {};
        if (name) updates.name = name;
        if (email) updates.email = email;
        if (phone) updates.phone = phone;
        if (title) updates.title = title;
        if (skills) {
            updates.skills = Array.isArray(skills)
                ? skills
                : skills.split(',').map(s => s.trim());
        }
        if (experience) updates.experience = experience;
        if (location) updates.location = location;
        if (source) updates.source = source;
        if (notes) updates.notes = notes;
        if (status) updates.status = status;
        updates.updated_at = new Date().toISOString();

        const { data: candidate, error } = await db
            .from('candidates')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Candidate not found' });
            }
            throw error;
        }

        res.json(candidate);
    } catch (error) {
        console.error('Error updating candidate:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/candidates/:id - Delete a candidate
router.delete('/:id', supabaseAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // SECURITY: fall back to the ANON (RLS-enforced) client for unauthenticated
        // requests — NEVER the service-role client (that bypassed RLS → cross-tenant PII).
        const db = req.user?.supabase || supabase;

        const { error } = await db
            .from('candidates')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Candidate deleted successfully' });
    } catch (error) {
        console.error('Error deleting candidate:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/candidates/search - Get matching candidates for a job description
router.post('/search', supabaseAuth, async (req, res) => {
    try {
        const { jobDescription, jobId } = req.body;

        if (!jobDescription && !jobId) {
            return res.status(400).json({ error: 'Job description or job ID is required' });
        }

        // SECURITY (REVIEW-2026-06 §D): hard-authed search, always token-scoped (RLS).
        // Never the service-role client (that returned every tenant's candidate rows).
        const db = req.user.supabase;

        let description = jobDescription;

        // If jobId is provided, fetch the job description
        if (jobId) {
            const { data: job, error: jobError } = await db
                .from('jobs')
                .select('description')
                .eq('id', jobId)
                .single();

            if (!jobError && job) {
                description = job.description;
            }
        }

        if (!description) {
            return res.status(400).json({ error: 'Valid job description is required' });
        }

        // Return ONLY real, RLS-scoped DB candidates. (v2-hardening H1-1: previously this
        // merged a hardcoded mock array — "John Doe" / "Jane Smith" — into the live results,
        // serving fabricated people to an authenticated recruiter. Synthetic identities must
        // never blend into a live candidates response.)
        const { data: dbCandidates, error } = await db
            .from('candidates')
            .select('*')
            .limit(20);

        if (error) throw error;

        res.json({ candidates: dbCandidates || [] });
    } catch (error) {
        console.error('Error searching candidates:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
