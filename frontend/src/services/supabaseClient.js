import { createClient } from '@supabase/supabase-js'

// Browser Supabase client. Uses the ANON (publishable) key ONLY — never the
// service-role key. The anon key is safe to ship to the browser; Row-Level
// Security on the backend is what actually scopes data per tenant.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// `null` when env isn't configured, so the app still builds/loads in
// preview-only mode and screens can fail gracefully instead of crashing.
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null

export const isSupabaseConfigured = Boolean(supabase)

export default supabase
