import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabaseClient.js'
import { api, setAuthTokenGetter, setAuthTokenRefresher } from '../services/api.js'
import { identify, resetAnalytics } from '../services/analytics.js'

// Auth context. Exposes the live Supabase session/user plus sign-in/out helpers.
// The api.js client reads the access token through a registered getter so it
// always sends the current token without importing the auth store directly.
const AuthContext = createContext({
  session: null,
  user: null,
  accessToken: null,
  loading: true,
  configured: false,
  profile: null,
  roleLoaded: false,
  isRecruiter: false,
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  // The candidate/recruiter role (profiles.account_type) — loaded once we have a user. This drives
  // route guards + post-login routing. It's a UX layer only; the real boundary is backend RLS +
  // requireRecruiter, which reject a candidate regardless of what the client believes.
  const [profile, setProfile] = useState(null)
  // Which user id the loaded `profile` reflects. `roleLoaded` is DERIVED from this (below)
  // instead of being an effect-set boolean. The old boolean could be briefly `true` for a
  // PREVIOUS auth state: on a hard load the session resolves null → signed-in, and for one
  // render `roleLoaded` stayed true with a stale null profile — so RequireRecruiter saw
  // roleLoaded===true && isRecruiter===false and bounced a recruiter to /candidate/home
  // before the profile fetch returned. Tracking the id the profile was loaded for makes
  // roleLoaded flip to false the instant userId changes, and never traps a null-profile user.
  const [profileForUserId, setProfileForUserId] = useState(null)

  const userId = session?.user?.id || null
  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      setProfile(null)
      setProfileForUserId(userId) // null when signed out → a resolved state
      return
    }
    let active = true
    supabase
      .from('profiles')
      .select('account_type, recruiter_status, subscription_plan')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!active) return
        setProfile(data || null)
        setProfileForUserId(userId)
      })
      .catch(() => {
        if (!active) return
        setProfile(null)
        setProfileForUserId(userId)
      })
    return () => {
      active = false
    }
  }, [userId])

  // The current user's role has resolved only when the loaded profile reflects the CURRENT
  // userId (or there is no user — signed-out is itself a resolved state). Derived, so it can
  // never lag a render behind an auth transition the way an effect-set boolean did.
  const roleLoaded = profileForUserId === userId

  // Keep api.js pointed at the freshest token WITHOUT a re-registration race. The getter
  // reads the latest session through a ref (updated synchronously on every render) and is
  // registered ONCE. Re-registering on [session] was racy: on the commit that mounts the
  // protected app, a child's fetch effect can run BEFORE the provider's re-registration
  // effect, so it sent the request with the previous null-session closure → a spurious 401
  // "No authorization token". Reading via the ref means the token is always current.
  const sessionRef = useRef(session)
  sessionRef.current = session
  useEffect(() => {
    setAuthTokenGetter(() => sessionRef.current?.access_token || null)
    // 401 rail: api.js calls this to force a refresh when the access token has expired
    // (e.g. tab resumed after sleep, before the auto-refresh timer catches up). The
    // onAuthStateChange listener below keeps sessionRef in sync with the result.
    setAuthTokenRefresher(async () => {
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data?.session) return null
      return data.session.access_token || null
    })
  }, [])

  // Provider separation: during the Google OAuth callback Supabase silently AUTO-LINKS the
  // Google identity onto an existing account with the same email. For an email/password
  // account that is a mislink: the person meant to sign in, not to merge providers. Detect
  // the fingerprint (both identities present, the Google one minted minutes ago, the account
  // itself older than the link), ask the server to unlink, then sign out toward the login
  // page with a plain-words notice. Checked at most once per user per page lifetime, so a
  // re-emitted SIGNED_IN (tab focus) can never loop; a long-standing google+email pairing is
  // untouched because its google identity created_at is old.
  const mislinkCheckedRef = useRef(new Set())
  async function maybeUnlinkMislinked(next) {
    const u = next?.user
    if (!u || mislinkCheckedRef.current.has(u.id)) return
    mislinkCheckedRef.current.add(u.id)
    const identities = u.identities || []
    const google = identities.find((i) => i.provider === 'google')
    const emailIdentity = identities.find((i) => i.provider === 'email')
    if (!google || !emailIdentity) return
    const googleLinkedAt = new Date(google.created_at).getTime()
    const accountCreatedAt = new Date(u.created_at).getTime()
    if (!Number.isFinite(googleLinkedAt) || !Number.isFinite(accountCreatedAt)) return
    const linkIsFresh = Date.now() - googleLinkedAt < 5 * 60 * 1000
    const accountPredatesLink = googleLinkedAt - accountCreatedAt > 60 * 1000
    if (!linkIsFresh || !accountPredatesLink) return
    try {
      // The api token getter reads sessionRef, which normally syncs on render; sync it here
      // so this call (made straight from the auth callback) carries the new session's token.
      sessionRef.current = next
      const res = await api.unlinkMislinked()
      if (res?.unlinked) {
        await supabase.auth.signOut()
        resetAnalytics()
        setSession(null)
        // Full navigation on purpose: AuthContext stays router-free, and a clean reload
        // drops every trace of the unlinked session. Login turns the reason into a notice.
        window.location.replace('/login?reason=password-account')
      }
    } catch {
      // Server unreachable or declined: leave the session alone rather than strand the user.
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    let active = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session ?? null)
        if (data.session?.user) identify(data.session.user)
        setLoading(false)
      })
      .catch(() => {
        // A failed initial session fetch must not leave the app stuck on the
        // boot skeleton forever — clear loading and fall through to signed-out.
        if (!active) return
        setSession(null)
        setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next ?? null)
      if (next?.user) identify(next.user)
      // Only a real sign-in can have just auto-linked a Google identity; token refreshes
      // and other events never re-run the check.
      if (event === 'SIGNED_IN') maybeUnlinkMislinked(next)
    })

    return () => {
      active = false
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      accessToken: session?.access_token ?? null,
      loading,
      configured: isSupabaseConfigured,
      profile,
      roleLoaded,
      isRecruiter:
        profile?.account_type === 'recruiter' && profile?.recruiter_status === 'verified',
      async signIn(email, password) {
        if (!isSupabaseConfigured) throw new Error('Auth is not configured')
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        return data
      },
      // Every signup is a candidate by default (account_type set server-side). An
      // optional first name rides along as user metadata so the welcome email +
      // profile pick it up. Return shape is unchanged.
      async signUp(email, password, { firstName } = {}) {
        if (!isSupabaseConfigured) throw new Error('Auth is not configured')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: firstName ? { first_name: firstName } : {} },
        })
        if (error) throw error
        return data
      },
      async signInWithGoogle(returnTo) {
        if (!isSupabaseConfigured) throw new Error('Auth is not configured')
        // Return to the page the user started from (e.g. a /candidate?ws= invite link) instead of
        // hardcoding /app — an invited candidate signing in with Google used to lose the link
        // context entirely. Same-origin relative paths only, so a crafted link can't bounce the
        // OAuth return off-site. NOTE: the origin must also be in the Supabase Auth redirect
        // allow-list, or GoTrue silently falls back to the project site URL (the homepage).
        const safe =
          typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
            ? returnTo
            : '/app'
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin + safe },
        })
        if (error) throw error
        return data
      },
      async signOut() {
        if (!isSupabaseConfigured) return
        await supabase.auth.signOut()
        resetAnalytics()
        setSession(null)
      },
      // Revoke ALL active sessions for this user (every device), not just this one.
      async signOutEverywhere() {
        if (!isSupabaseConfigured) return
        await supabase.auth.signOut({ scope: 'global' })
        resetAnalytics()
        setSession(null)
      },
      // Change the account email — Supabase sends a confirmation link to the new address
      // (using the "Change Email Address" auth template) before the change takes effect.
      async updateEmail(email) {
        if (!isSupabaseConfigured) throw new Error('Auth is not configured')
        const { data, error } = await supabase.auth.updateUser(
          { email },
          { emailRedirectTo: window.location.origin + '/app' },
        )
        if (error) throw error
        return data
      },
      // Password recovery — Supabase native. resetPassword emails a recovery link that lands on
      // /reset-password (Supabase establishes a temporary recovery session from the URL); the
      // reset page then calls updatePassword to set the new password.
      async resetPassword(email) {
        if (!isSupabaseConfigured) throw new Error('Auth is not configured')
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/reset-password',
        })
        if (error) throw error
      },
      async updatePassword(password) {
        if (!isSupabaseConfigured) throw new Error('Auth is not configured')
        const { data, error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        return data
      },
    }),
    [session, loading, profile, roleLoaded],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export default AuthContext
