/**
 * userProvisioning — find-or-create a Supabase auth user (and thus a profiles row) by email.
 *
 * Extracted from routes/supabase/auth.js so services (e.g. the Ashby Assessments integration,
 * which must mint a candidate profile by email to create a real work_sample_submissions row —
 * candidate_id is NOT NULL and FKs profiles(id)) can reuse it WITHOUT a route→service import cycle.
 *
 * Returns the auth user's UUID that is also profiles.id. Creates the user (email_confirm: true)
 * if missing, repairs an orphaned profile, or finds an existing auth user with no profile.
 */
const { supabaseAdmin } = require('../config/supabase');

async function ensureAuthUser(email, metadata = {}, password = undefined) {
  // Step 1: Check if a profile already exists for this email
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (existingProfile?.id) {
    // Profile exists - verify it has a matching auth.users entry
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(existingProfile.id);
    if (authUser?.user) {
      return existingProfile.id;
    }

    // Orphaned profile (no matching auth.users entry) - try to repair with the SAME id
    const repairParams = { id: existingProfile.id, email, email_confirm: true, user_metadata: metadata };
    if (password) repairParams.password = password;
    const { data: repairedUser, error: repairError } = await supabaseAdmin.auth.admin.createUser(repairParams);
    if (!repairError && repairedUser?.user) {
      return repairedUser.user.id;
    }
    // Repair failed (a different auth user already holds this email) - drop the orphan, recreate.
    console.warn('Could not repair orphaned profile, recreating:', repairError?.message);
    await supabaseAdmin.from('profiles').delete().eq('id', existingProfile.id);
  }

  // Step 2: No valid profile - create a new auth user
  const createParams = { email, email_confirm: true, user_metadata: metadata };
  if (password) createParams.password = password;
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser(createParams);
  if (!created?.user && !createError) {
    // unexpected: no user and no error
  }
  if (!createError && created?.user) {
    return created.user.id;
  }

  // Step 3: createUser failed because an auth user already exists with no profile - find it.
  let page = 1;
  while (page <= 10) {
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
    if (!listData?.users?.length) break;
    const found = listData.users.find((u) => u.email === email);
    if (found) return found.id;
    if (listData.users.length < 100) break;
    page++;
  }

  throw new Error(`Failed to ensure auth user for ${email}: ${createError?.message}`);
}

module.exports = { ensureAuthUser };
