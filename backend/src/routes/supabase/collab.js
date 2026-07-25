/**
 * Collaboration Routes - Supabase Version
 * Migrated from MongoDB/Mongoose to Supabase/PostgreSQL
 * Recruiter collaboration system for shared candidate access
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { supabaseAdmin } = require('../../config/supabase');
const { supabaseAuth, requireRecruiter } = require('../../middleware/supabaseAuth');
const emailService = require('../../services/emailService');
const emailTemplates = require('../../services/emailTemplates');

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Apply auth middleware to all routes
router.use(supabaseAuth);

/**
 * @route POST /api/collab/share
 * @desc Share a candidate with another recruiter
 * @access Private
 */
router.post('/share', requireRecruiter, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { candidateId, recruiterEmail, message } = req.body;

        // Validate input
        if (!candidateId || !recruiterEmail) {
            return res.status(400).json({
                message: 'Candidate ID and recruiter email are required'
            });
        }

        // Find the target recruiter by email
        const { data: targetRecruiter, error: recruiterError } = await supabaseAdmin
            .from('profiles')
            .select('id, email, first_name, last_name')
            .eq('email', recruiterEmail.toLowerCase().trim())
            .single();

        if (recruiterError || !targetRecruiter) {
            return res.status(404).json({
                message: 'Recruiter not found with this email'
            });
        }

        // Prevent sharing with self
        if (targetRecruiter.id === req.user.id) {
            return res.status(400).json({
                message: 'You cannot share a candidate with yourself'
            });
        }

        // Find the candidate and verify ownership or access
        const { data: candidate, error: candidateError } = await db
            .from('candidate_submissions')
            .select('*')
            .eq('id', candidateId)
            .single();

        if (candidateError || !candidate) {
            return res.status(404).json({
                message: 'Candidate not found'
            });
        }

        // Check if user has permission to share (owner or already shared with)
        const isOwner = candidate.user_id === req.user.id;
        const sharedWith = candidate.shared_with || [];
        const isSharedWithUser = sharedWith.includes(req.user.id);

        if (!isOwner && !isSharedWithUser) {
            return res.status(403).json({
                message: 'You do not have permission to share this candidate'
            });
        }

        // Check if already shared with this recruiter
        if (sharedWith.includes(targetRecruiter.id)) {
            return res.status(400).json({
                message: 'Candidate is already shared with this recruiter'
            });
        }

        // Dual-write: update shared_with array AND insert into junction table
        const updatedSharedWith = [...sharedWith, targetRecruiter.id];

        const { error: updateError } = await db
            .from('candidate_submissions')
            .update({ shared_with: updatedSharedWith })
            .eq('id', candidateId);

        if (updateError) throw updateError;

        // Insert into normalized junction table
        await supabaseAdmin
            .from('submission_shares')
            .upsert({
                submission_id: candidateId,
                shared_with_user_id: targetRecruiter.id,
                shared_by: req.user.id
            }, { onConflict: 'submission_id,shared_with_user_id' });

        // Create notification for target recruiter
        try {
            await supabaseAdmin
                .from('notifications')
                .insert({
                    user_id: targetRecruiter.id,
                    type: 'candidate_shared',
                    title: 'Candidate Shared With You',
                    message: message || `${req.user.email} shared a candidate with you: ${candidate.full_name}`,
                    data: {
                        candidateId: candidate.id,
                        candidateName: candidate.full_name,
                        sharedBy: req.user.id,
                        sharedByEmail: req.user.email
                    }
                });
        } catch (notifError) {
            console.error('Failed to create notification:', notifError.message);
            // Continue even if notification fails
        }

        const recruiterName = `${targetRecruiter.first_name || ''} ${targetRecruiter.last_name || ''}`.trim() || targetRecruiter.email;

        res.json({
            message: 'Candidate shared successfully',
            candidate: {
                id: candidate.id,
                fullName: candidate.full_name,
                sharedWith: updatedSharedWith
            },
            sharedWithRecruiter: {
                id: targetRecruiter.id,
                email: targetRecruiter.email,
                name: recruiterName
            }
        });

    } catch (error) {
        console.error('Error sharing candidate:', error);
        res.status(500).json({ message: 'Server error sharing candidate' });
    }
});

/**
 * @route POST /api/collab/unshare
 * @desc Remove sharing for a candidate with a specific recruiter
 * @access Private
 */
router.post('/unshare', requireRecruiter, async (req, res) => {
    try {
        const db = req.user.supabase;
        const { candidateId, recruiterId } = req.body;

        if (!candidateId || !recruiterId) {
            return res.status(400).json({
                message: 'Candidate ID and recruiter ID are required'
            });
        }

        const { data: candidate, error: fetchError } = await db
            .from('candidate_submissions')
            .select('*')
            .eq('id', candidateId)
            .single();

        if (fetchError || !candidate) {
            return res.status(404).json({ message: 'Candidate not found' });
        }

        // Only owner can remove sharing
        if (candidate.user_id !== req.user.id) {
            return res.status(403).json({
                message: 'Only the owner can remove sharing access'
            });
        }

        // Dual-write: remove from shared_with array AND delete from junction table
        const updatedSharedWith = (candidate.shared_with || []).filter(
            id => id !== recruiterId
        );

        const { error: updateError } = await db
            .from('candidate_submissions')
            .update({ shared_with: updatedSharedWith })
            .eq('id', candidateId);

        if (updateError) throw updateError;

        // Delete from normalized junction table
        await supabaseAdmin
            .from('submission_shares')
            .delete()
            .eq('submission_id', candidateId)
            .eq('shared_with_user_id', recruiterId);

        res.json({
            message: 'Sharing removed successfully',
            candidate: {
                id: candidate.id,
                fullName: candidate.full_name,
                sharedWith: updatedSharedWith
            }
        });

    } catch (error) {
        console.error('Error removing share:', error);
        res.status(500).json({ message: 'Server error removing share' });
    }
});

/**
 * @route GET /api/collab/shared
 * @desc Get candidates shared with current user
 * @access Private
 */
router.get('/shared', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Query junction table for submissions shared with current user
        const { data: shares, error: sharesError, count } = await supabaseAdmin
            .from('submission_shares')
            .select('submission_id, shared_by, shared_at', { count: 'exact' })
            .eq('shared_with_user_id', req.user.id)
            .order('shared_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);

        if (sharesError) throw sharesError;

        if (!shares || shares.length === 0) {
            return res.json({
                candidates: [],
                currentPage: parseInt(page),
                totalPages: 0,
                totalCandidates: 0
            });
        }

        const submissionIds = shares.map(s => s.submission_id);

        // Fetch candidate details
        const db = req.user.supabase;
        const { data: candidates, error } = await db
            .from('candidate_submissions')
            .select('*')
            .in('id', submissionIds);

        if (error) throw error;

        // Get owner details for each candidate
        const ownerIds = [...new Set((candidates || []).map(c => c.user_id).filter(Boolean))];
        let ownersMap = {};

        if (ownerIds.length > 0) {
            const { data: owners } = await supabaseAdmin
                .from('profiles')
                .select('id, email, first_name, last_name')
                .in('id', ownerIds);

            if (owners) {
                owners.forEach(owner => {
                    ownersMap[owner.id] = owner;
                });
            }
        }

        // Enrich with owner info
        const enrichedCandidates = (candidates || []).map(c => {
            const owner = ownersMap[c.user_id];
            return {
                ...c,
                isShared: true,
                sharedBy: owner ? {
                    email: owner.email,
                    name: `${owner.first_name || ''} ${owner.last_name || ''}`.trim() || owner.email
                } : null
            };
        });

        res.json({
            candidates: enrichedCandidates,
            currentPage: parseInt(page),
            totalPages: Math.ceil((count || 0) / parseInt(limit)),
            totalCandidates: count || 0
        });

    } catch (error) {
        console.error('Error fetching shared candidates:', error);
        res.status(500).json({ message: 'Server error fetching shared candidates' });
    }
});

/**
 * @route GET /api/collab/shared-by-me
 * @desc Get candidates the current user has shared with others
 * @access Private
 */
router.get('/shared-by-me', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Query junction table for shares made by current user (as owner)
        const { data: shares, error: sharesError } = await supabaseAdmin
            .from('submission_shares')
            .select('submission_id, shared_with_user_id, shared_at')
            .eq('shared_by', req.user.id)
            .order('shared_at', { ascending: false });

        if (sharesError) throw sharesError;

        if (!shares || shares.length === 0) {
            return res.json({
                candidates: [],
                currentPage: parseInt(page),
                totalPages: 0,
                totalCandidates: 0
            });
        }

        // Group shares by submission
        const sharesBySubmission = {};
        shares.forEach(s => {
            if (!sharesBySubmission[s.submission_id]) {
                sharesBySubmission[s.submission_id] = [];
            }
            sharesBySubmission[s.submission_id].push(s.shared_with_user_id);
        });

        const submissionIds = Object.keys(sharesBySubmission);

        // Paginate submission IDs
        const paginatedIds = submissionIds.slice(offset, offset + parseInt(limit));

        // Fetch candidate details
        const db = req.user.supabase;
        const { data: candidates, error } = await db
            .from('candidate_submissions')
            .select('*')
            .in('id', paginatedIds);

        if (error) throw error;

        // Get shared user details
        const sharedUserIds = [...new Set(shares.map(s => s.shared_with_user_id))];

        let usersMap = {};
        if (sharedUserIds.length > 0) {
            const { data: users } = await supabaseAdmin
                .from('profiles')
                .select('id, email, first_name, last_name')
                .in('id', sharedUserIds);

            if (users) {
                users.forEach(user => {
                    usersMap[user.id] = user;
                });
            }
        }

        // Format shared with info
        const enrichedCandidates = (candidates || []).map(c => ({
            ...c,
            sharedWithRecruiters: (sharesBySubmission[c.id] || []).map(userId => {
                const user = usersMap[userId];
                return user ? {
                    id: user.id,
                    email: user.email,
                    name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
                } : { id: userId, email: 'Unknown', name: 'Unknown User' };
            })
        }));

        res.json({
            candidates: enrichedCandidates,
            currentPage: parseInt(page),
            totalPages: Math.ceil(submissionIds.length / parseInt(limit)),
            totalCandidates: submissionIds.length
        });

    } catch (error) {
        console.error('Error fetching shared-by-me candidates:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * @route GET /api/collab/recruiters
 * @desc Search for recruiters to share with
 * @access Private
 */
router.get('/recruiters', async (req, res) => {
    try {
        const db = req.user.supabase;
        const { search } = req.query;

        if (!search || search.length < 2) {
            return res.json({ recruiters: [] });
        }

        // S-4 (codebase-scan): strip PostgREST-.or() control chars (`,()`) so the raw search string
        // can't inject extra filter conditions (a PII-enumeration oracle), then wrap as an ilike.
        const safeSearch = String(search).replace(/[,()]/g, ' ').trim();
        if (safeSearch.length < 2) {
            return res.json({ recruiters: [] });
        }
        const searchPattern = `%${safeSearch}%`;

        // Find VERIFIED RECRUITERS matching search, excluding current user. Restricting to
        // account_type='recruiter' + recruiter_status='verified' stops any signed-in user (e.g. a
        // candidate) from enumerating every profile's email/name/company via this collab endpoint.
        const { data: recruiters, error } = await supabaseAdmin
            .from('profiles')
            .select('id, email, first_name, last_name, company')
            .eq('account_type', 'recruiter')
            .eq('recruiter_status', 'verified')
            .neq('id', req.user.id)
            .or(`email.ilike.${searchPattern},first_name.ilike.${searchPattern},last_name.ilike.${searchPattern}`)
            .limit(10);

        if (error) throw error;

        const formattedRecruiters = (recruiters || []).map(r => ({
            id: r.id,
            email: r.email,
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email,
            company: r.company
        }));

        res.json({ recruiters: formattedRecruiters });

    } catch (error) {
        console.error('Error searching recruiters:', error);
        res.status(500).json({ message: 'Server error searching recruiters' });
    }
});

// ===========================================================================
// Phase 4 — Team seats / invite (MVP: membership management)
//
// A workspace OWNER (the signed-in user) invites teammates by email, lists their
// members + pending invites, and removes members. A teammate ACCEPTS a one-time
// token link (FRONTEND_URL/app/team?invite=<token>), binding their account to the
// workspace. Backed by public.workspace_members (migration 037).
//
// SECURITY: owner-gated reads/writes go through the token-scoped client
// (req.user.supabase) so RLS (037) is the tenant boundary — the owner only ever
// sees/edits rows where owner_id = auth.uid(). The ACCEPT step is the one
// exception: at accept time member_id is still NULL so neither RLS policy matches,
// so the bind is performed with supabaseAdmin gated solely on possession of the
// random invite_token (the token IS the capability — same pattern as a
// password-reset token). See migration 037 for the rationale.
// ===========================================================================

// GET /api/collab/team — the caller's WORKSPACE: its owner + members (+ pending invites for the
// owner). Works for BOTH the owner AND a joined member — previously this was owner-only
// (.eq('owner_id', me)), so an invited teammate saw an empty list and never the workspace they
// joined.
router.get('/team', async (req, res) => {
    try {
        const me = req.user.id;

        // Which workspace does the caller belong to? The one they OWN, or — if they're an active
        // member — the one they JOINED. Default: they own their own (possibly solo) workspace.
        const { data: membership } = await supabaseAdmin
            .from('workspace_members')
            .select('owner_id')
            .eq('member_id', me)
            .eq('status', 'active')
            .order('accepted_at', { ascending: true })
            .limit(1);
        const ownerId = (Array.isArray(membership) && membership[0]?.owner_id) || me;
        const callerIsOwner = ownerId === me;

        // All membership rows for that workspace. Service-role read is safe: we've authorized the
        // caller as the owner or an active member of THIS workspace, so there is no cross-tenant leak.
        const { data: rows, error } = await supabaseAdmin
            .from('workspace_members')
            .select('id, owner_id, member_id, member_email, role, status, invited_at, accepted_at')
            .eq('owner_id', ownerId)
            .order('invited_at', { ascending: false });
        if (error) throw error;

        // Members only see ACTIVE teammates; pending invites (other people's emails) are the
        // owner's to manage.
        let memberRows = rows || [];
        if (!callerIsOwner) memberRows = memberRows.filter((m) => m.status === 'active');

        // Names/emails for the owner + active members.
        const ids = [ownerId, ...memberRows.map((m) => m.member_id)].filter(Boolean);
        const profiles = {};
        if (ids.length) {
            const { data: profs } = await supabaseAdmin
                .from('profiles')
                .select('id, email, first_name, last_name')
                .in('id', ids);
            (profs || []).forEach((p) => {
                profiles[p.id] = { name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || null, email: p.email };
            });
        }

        // The OWNER isn't a workspace_members row — synthesize an entry so everyone in the
        // workspace can see who owns it.
        const ownerEntry = {
            id: `owner:${ownerId}`,
            email: profiles[ownerId]?.email || null,
            name: profiles[ownerId]?.name || null,
            role: 'owner',
            status: 'active',
            invited_at: null,
            accepted_at: null,
            is_owner: true,
            is_self: ownerId === me,
        };

        const team = memberRows.map((m) => ({
            id: m.id,
            email: m.member_email,
            name: m.member_id ? (profiles[m.member_id]?.name || null) : null,
            role: m.role,
            status: m.status,
            invited_at: m.invited_at,
            accepted_at: m.accepted_at,
            is_owner: false,
            is_self: m.member_id === me,
        }));

        res.json({ members: [ownerEntry, ...team], is_owner: callerIsOwner, owner_id: ownerId });
    } catch (error) {
        console.error('Error listing team:', error.message);
        res.status(500).json({ message: 'Server error listing team' });
    }
});

// POST /api/collab/team/invite { email } — invite a teammate by email.
router.post('/team/invite', requireRecruiter, async (req, res) => {
    try {
        const email = (req.body?.email || '').toLowerCase().trim();
        if (!isEmail(email)) {
            return res.status(400).json({ message: 'A valid email is required' });
        }
        if (email === (req.user.email || '').toLowerCase()) {
            return res.status(400).json({ message: 'You cannot invite yourself' });
        }

        const token = crypto.randomBytes(24).toString('hex');

        const { data: row, error } = await req.user.supabase
            .from('workspace_members')
            .insert({
                owner_id: req.user.id,
                member_email: email,
                status: 'invited',
                invite_token: token,
            })
            .select('id, member_email, role, status, invited_at')
            .single();

        if (error) {
            // unique(owner_id, member_email) violation -> already invited.
            if (error.code === '23505') {
                return res.status(409).json({ message: 'That teammate is already invited' });
            }
            throw error;
        }

        // Invite email — await the RESULT so we report real delivery (sendEmail RETURNS an
        // error object on a config/provider failure; the old .catch only saw thrown errors,
        // so a misconfigured provider looked like success). The link is always returned so the
        // owner can copy/share it manually when email can't be delivered.
        const frontendUrl = process.env.FRONTEND_URL || '';
        const link = frontendUrl ? `${frontendUrl}/app/team?invite=${token}` : null;
        let emailed = false;
        let email_error = null;
        if (link) {
            const from = req.user.first_name
                ? `${req.user.first_name} ${req.user.last_name || ''}`.trim()
                : (req.user.company || req.user.email || 'A teammate');
            const body = [
                'Hi,',
                '',
                `${from} invited you to join their team workspace on Touchstones.`,
                'Accept the invite to share screens, candidates, and activity.',
                `\nAccept here: ${link}`,
                '',
                '— Touchstones',
            ].join('\n');
            try {
                // Branded HTML from the shared design system (emails/). null => emailService falls back to text(body).
                const html = emailTemplates.teamInvite({ from, invitedEmail: email, link });
                const r = await emailService.sendEmail({ to: email, subject: "You're invited to a Touchstones workspace", body, html, fromName: 'Touchstones' });
                emailed = !!(r && r.success);
                email_error = (r && r.error) || null;
                if (!emailed) console.warn('team invite email not sent:', email_error);
            } catch (e) {
                email_error = e.message;
                console.warn('team invite email failed:', e.message);
            }
        }

        res.status(201).json({
            member: {
                id: row.id,
                email: row.member_email,
                name: null,
                role: row.role,
                status: row.status,
                invited_at: row.invited_at,
            },
            emailed,
            email_error,
            link,
        });
    } catch (error) {
        console.error('Error inviting teammate:', error.message);
        res.status(500).json({ message: 'Server error inviting teammate' });
    }
});

// POST /api/collab/team/accept { token } — the invitee binds their account.
router.post('/team/accept', async (req, res) => {
    try {
        const token = (req.body?.token || '').trim();
        if (!token) {
            return res.status(400).json({ message: 'An invite token is required' });
        }

        // Service-role lookup gated solely on the random token (the capability).
        // At this point member_id is NULL so the invitee cannot see/update the row
        // under their own RLS — the token is what authorizes the bind.
        const { data: invite, error: lookupError } = await supabaseAdmin
            .from('workspace_members')
            .select('id, owner_id, member_id, member_email, status')
            .eq('invite_token', token)
            .single();

        if (lookupError || !invite) {
            return res.status(404).json({ message: 'Invite not found or already used' });
        }
        if (invite.owner_id === req.user.id) {
            return res.status(400).json({ message: 'You cannot accept your own invite' });
        }
        if (invite.status === 'active' && invite.member_id) {
            return res.status(409).json({ message: 'This invite was already accepted' });
        }
        // Bind only if the signed-in user IS the invited address. The token alone is not enough:
        // a forwarded or leaked invite link must not let an arbitrary account join the workspace
        // and gain read access to its screens, candidates and scores.
        if ((invite.member_email || '').toLowerCase() !== (req.user.email || '').toLowerCase()) {
            return res.status(403).json({ message: 'This invite was sent to a different email address. Sign in as the invited address to accept it.' });
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('workspace_members')
            .update({
                member_id: req.user.id,
                status: 'active',
                accepted_at: new Date().toISOString(),
                invite_token: null,
            })
            .eq('id', invite.id)
            .select('id, owner_id, status, accepted_at')
            .single();

        if (updateError) throw updateError;

        res.json({ member: updated });
    } catch (error) {
        console.error('Error accepting invite:', error.message);
        res.status(500).json({ message: 'Server error accepting invite' });
    }
});

// DELETE /api/collab/team/:id — owner removes a member or pending invite.
router.delete('/team/:id', requireRecruiter, async (req, res) => {
    try {
        if (!isUUID(req.params.id)) {
            return res.status(400).json({ message: 'Invalid member id' });
        }

        // RLS scopes deletes to owner_id = auth.uid(); confirm the row existed so we
        // can return a clean 404 rather than a silent success on a foreign/missing id.
        const { data: deleted, error } = await req.user.supabase
            .from('workspace_members')
            .delete()
            .eq('id', req.params.id)
            .eq('owner_id', req.user.id)
            .select('id')
            .maybeSingle();

        if (error) throw error;
        if (!deleted) {
            return res.status(404).json({ message: 'Member not found' });
        }

        res.json({ ok: true, id: deleted.id });
    } catch (error) {
        console.error('Error removing teammate:', error.message);
        res.status(500).json({ message: 'Server error removing teammate' });
    }
});

module.exports = router;
