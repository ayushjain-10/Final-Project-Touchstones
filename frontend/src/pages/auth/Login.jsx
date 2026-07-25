import { useState } from 'react'
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Logo from '../../components/Logo.jsx'
import AuthShell from '../../components/AuthShell.jsx'
import { track, getFirstTouch, identify } from '../../services/analytics.js'
import { User, ShieldCheck, ArrowRight } from '../../components/icons.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Focused auth surface (no marketing chrome): email/password + Google, backed by
// Supabase. Google requires the Supabase Google provider to be enabled in the project.
//
// Two audiences, one clean card:
//   • CANDIDATES — taking a screen. Just sign up; lands on /candidate/home.
//   • HIRING TEAMS — recruiters. Access is granted by invite or approval, so they
//     sign up as a candidate first and then request access at /recruiter-access.
export default function Login() {
  const { signIn, signUp, signInWithGoogle, resetPassword, configured } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Where to go after auth — back to the page that bounced us here (e.g. an invite link), else /app.
  // RequireRecruiter then routes a candidate/pending user on to /candidate/home as appropriate.
  const from = location.state?.from || '/app'
  // Open directly in signup when the caller asked for it (e.g. a candidate creating an account to
  // start a screen). Values: signin | signup | forgot.
  const [mode, setMode] = useState(location.state?.mode === 'signup' ? 'signup' : 'signin')
  const [searchParams] = useSearchParams()
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // AuthContext lands here with ?reason=password-account after unlinking a Google identity
  // that Supabase auto-linked onto an email/password account (see unlink-mislinked).
  const [notice, setNotice] = useState(() =>
    searchParams.get('reason') === 'password-account'
      ? 'This email signed up with a password. Please sign in with your email and password.'
      : '',
  )
  const [busy, setBusy] = useState(false)
  // Set when a password signup hits a Google-only account: the error tells them to use
  // Google, and this draws the eye to the button itself.
  const [highlightGoogle, setHighlightGoogle] = useState(false)

  function switchMode(next) {
    setMode(next)
    setError('')
    setNotice('')
    setHighlightGoogle(false)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(''); setNotice(''); setHighlightGoogle(false); setBusy(true)
    try {
      if (mode === 'forgot') {
        await resetPassword(email)
        // Don't reveal whether the address has an account.
        setNotice('If an account exists for that email, a password-reset link is on its way.')
      } else if (mode === 'signin') {
        await signIn(email, password)
        navigate(from)
      } else {
        // Provider separation: a password signup on a Google-only account would make Supabase
        // silently attach a second identity to it. Precheck the providers and route the person
        // to Google instead. Best-effort: if the precheck itself fails we fall through to the
        // normal signup, which still enforces uniqueness.
        try {
          const pre = await api.providerPrecheck(email)
          if (pre?.exists && pre.providers?.includes('google') && !pre.providers.includes('email')) {
            setHighlightGoogle(true)
            setError('User already signed up with Google. Please sign in with Google.')
            return
          }
        } catch {
          /* advisory only */
        }
        // Funnel: signup form submitted → account created. Both carry first-touch
        // acquisition context (UTM + referrer) so signups attribute to a source.
        track('sign_up_started', { ...getFirstTouch(), sign_up_method: 'email', platform: 'web' })
        const data = await signUp(email, password, { firstName: firstName.trim() || undefined })
        if (data?.user) identify(data.user)
        track('sign_up_completed', {
          ...getFirstTouch(),
          sign_up_method: 'email',
          platform: 'web',
          needs_confirmation: !data?.session,
        })
        if (data?.session) navigate(from)
        else setNotice('Check your email to confirm your account, then sign in.')
      }
    } catch (err) {
      // Supabase auth errors can carry an empty or object-ish message (e.g. "{}" when the
      // auth service fails without a response body) — never render that to a person.
      const msg = typeof err?.message === 'string' ? err.message.trim() : ''
      setError(msg && !msg.startsWith('{') ? msg : 'Something went wrong on our side. Please try again in a minute.')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    setError(''); setHighlightGoogle(false); setBusy(true)
    try {
      await signInWithGoogle(from) // redirects away on success, back to where the user started
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setBusy(false)
    }
  }

  const inputCls =
    `w-full ${EDITORIAL_UI_ENABLED ? 'rounded-lg' : 'rounded-xl'} border border-stone-200 bg-white px-4 py-2.5 text-sm text-ink ` +
    'placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

  return (
    <AuthShell
      eyebrow="Evidence workspace"
      title="Review the work behind the answer."
      body="Create role-specific screens, inspect the work trail, and make hiring decisions from rubric-linked evidence."
    >
      <div className="w-full">
        <div className={`mb-8 justify-center ${EDITORIAL_UI_ENABLED ? 'flex lg:hidden' : 'flex'}`}>
          <Logo />
        </div>

        <div
          className={`relative overflow-hidden border border-stone-200 bg-white/95 p-7 shadow-lift ${
            EDITORIAL_UI_ENABLED ? 'rounded-none sm:p-9' : 'rounded-2xl'
          }`}
        >
          {EDITORIAL_UI_ENABLED && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700"
            />
          )}
          <h1 className="text-center font-serif text-2xl font-semibold text-ink">
            {mode === 'signin' ? 'Sign in to Touchstones' : mode === 'forgot' ? 'Reset your password' : 'Create your account'}
          </h1>
          <p className="mt-1.5 text-center text-sm text-stone-500">
            {mode === 'forgot'
              ? 'Enter your email and we’ll send a secure reset link.'
              : 'Secure access for candidate and reviewer workspaces.'}
          </p>

          {!configured && (
            <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-700">
              Auth isn’t configured in this environment yet.
            </p>
          )}

          {/* Sign-up: a brief, friendly explainer of the two account types so neither
              audience feels lost. Candidates just continue; hiring teams get a path. */}
          {mode === 'signup' && (
            <div className="mt-5 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3 text-xs leading-relaxed text-clay-800">
              <p className="inline-flex items-center gap-1.5 font-semibold text-clay-900">
                <User size={13} /> Taking a screen?
              </p>
              <p className="mt-1">
                You’re in the right place. Sign up below, then review the role owner’s AI policy
                and task instructions before you begin.
              </p>
              <p className="mt-2">
                <span className="font-semibold">Hiring team?</span> Sign up first, then{' '}
                <Link to="/recruiter-access" className="font-semibold underline underline-offset-2">
                  request recruiter access
                </Link>{' '}
                — granted by invite or approval.
              </p>
            </div>
          )}

          {mode !== 'forgot' && (
            <>
              <button
                type="button"
                onClick={onGoogle}
                disabled={busy || !configured}
                className={`mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-stone-50 disabled:opacity-50 ${
                  highlightGoogle
                    ? 'border-brand-400 ring-2 ring-brand-200'
                    : 'border-stone-200'
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                  <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
                </svg>
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3 text-xs text-stone-400">
                <span className="h-px flex-1 bg-stone-200" />
                or
                <span className="h-px flex-1 bg-stone-200" />
              </div>
            </>
          )}

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === 'signup' && (
              <label className="block text-xs font-medium text-stone-600" htmlFor="first-name">
                First name
                <input
                  id="first-name" type="text" placeholder="Ada" autoComplete="given-name"
                  value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`mt-1.5 ${inputCls}`}
                />
              </label>
            )}
            <label className="block text-xs font-medium text-stone-600" htmlFor="email">
              Email
              <input
                id="email" type="email" required placeholder="you@company.com" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1.5 ${inputCls}`}
              />
            </label>
            {mode !== 'forgot' && (
              <label className="block text-xs font-medium text-stone-600" htmlFor="password">
                Password
                <input
                  id="password" type="password" required placeholder="At least 6 characters" minLength={6}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1.5 ${inputCls}`}
                />
              </label>
            )}
            {mode === 'signin' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-xs font-medium text-clay-700 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
            <div aria-live="polite" aria-atomic="true">
              {error && <p className="text-sm text-flag-700">{error}</p>}
              {notice && <p className="text-sm text-stone-600">{notice}</p>}
            </div>
            <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy || !configured}>
              {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-stone-500">
            {mode === 'signin' ? "Don’t have an account? " : mode === 'forgot' ? 'Remembered it? ' : 'Already have an account? '}
            <button
              type="button"
              onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
              className="font-medium text-clay-700 hover:underline"
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </div>

        {/* Secondary audience path — visible on sign-in/sign-up so a hiring-team
            visitor always has an obvious way in. */}
        {mode !== 'forgot' && (
          <Link
            to="/recruiter-access"
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-clay-300"
          >
            <span className="inline-flex items-center gap-2.5 text-sm text-stone-700">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200">
                <ShieldCheck size={16} />
              </span>
              <span>
                <span className="font-medium text-ink">I’m a hiring team</span>
                <span className="block text-xs text-stone-500">Request recruiter access</span>
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-clay-500" />
          </Link>
        )}

        <p className="mt-6 text-center text-xs text-stone-400">
          <Link to="/" className="hover:text-stone-600">← Back to touchstones.ai</Link>
        </p>
      </div>
    </AuthShell>
  )
}
