const { createClient } = require('@supabase/supabase-js');

// Supabase configuration.
// Fall back to harmless localhost placeholders when env is unset so the app
// (and the test suite, which runs in mock mode and never hits a real server)
// can load without throwing on createClient(''). Production MUST set real values.
const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'anon-key-not-set';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key-not-set';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('Warning: Supabase env vars not set — using non-functional placeholders. Set SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in production.');
}

// Public client (respects RLS policies)
const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false
    }
});

// Admin client (bypasses RLS - use carefully!)
const supabaseAdmin = createClient(supabaseUrl || '', supabaseServiceKey || '', {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// Helper to create authenticated client for a specific user
const createAuthenticatedClient = (accessToken) => {
    return createClient(supabaseUrl || '', supabaseAnonKey || '', {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
};

// Helper function to handle Supabase errors
const handleSupabaseError = (error, context = '') => {
    if (error) {
        console.error(`Supabase error${context ? ` in ${context}` : ''}:`, error.message);
        throw new Error(error.message);
    }
};

// Helper to convert MongoDB ObjectId patterns to UUID patterns
const toUUID = (id) => {
    if (!id) return null;
    // If already a valid UUID, return as-is
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return id;
    }
    // If it's a MongoDB ObjectId string, we can't convert it - return null
    // This is a migration helper; old ObjectIds won't work with Supabase
    return null;
};

module.exports = {
    supabase,
    supabaseAdmin,
    createAuthenticatedClient,
    handleSupabaseError,
    toUUID
};
