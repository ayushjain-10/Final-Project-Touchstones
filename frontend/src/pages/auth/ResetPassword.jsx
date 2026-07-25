import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import Button from '../../components/Button.jsx'
import Logo from '../../components/Logo.jsx'
import AuthShell from '../../components/AuthShell.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Landing page for the Supabase password-recovery email link. Supabase establishes a temporary
// recovery session from the URL (detectSessionInUrl is on), which surfaces as `session` here; we
// then let the user set a new password via supabase.auth.updateUser (AuthContext.updatePassword).
export default function ResetPassword() {
  const { updatePassword, session, loading, configured } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Use at least 6 characters.'); return }
    if (password !== confirm) { setError('Those passwords don’t match.'); return }
    setBusy(true)
    try {
      await updatePassword(password)
      setDone(true)
      setTimeout(() => navigate('/app'), 1400)
    } catch (err) {
      setError(err.message || 'Could not update your password. The link may have expired — request a new one.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    `w-full ${EDITORIAL_UI_ENABLED ? 'rounded-lg' : 'rounded-xl'} border border-stone-200 bg-white px-4 py-2.5 text-sm text-ink ` +
    'placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

  // A valid recovery link establishes a session. No session (and not still loading) → the link is
  // missing/expired, so we can't reset anything.
  const noLink = configured && !loading && !session

  return (
    <AuthShell
      eyebrow="Secure account recovery"
      title="Reset access. Keep the work trail intact."
      body="Account recovery changes your credentials, not the evidence, audit history, or review context already attached to your workspace."
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
          <h1 className="text-center font-serif text-2xl font-semibold text-ink">Set a new password</h1>

          {done ? (
            <p className="mt-5 rounded-xl bg-clay-50 px-4 py-3 text-center text-sm text-clay-700">
              Password updated — signing you in…
            </p>
          ) : noLink ? (
            <>
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                This reset link is missing or has expired. Request a new one from the sign-in page.
              </p>
              <Link to="/login" className="mt-5 block text-center text-sm font-medium text-clay-700 hover:underline">
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-center text-sm text-stone-500">Choose a new password for your account.</p>
              <form onSubmit={onSubmit} className="mt-6 space-y-3">
                <label className="block text-xs font-medium text-stone-600" htmlFor="new-password">
                  New password
                  <input
                    id="new-password" type="password" required placeholder="At least 6 characters" minLength={6} autoComplete="new-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1.5 ${inputCls}`}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-600" htmlFor="confirm-password">
                  Confirm new password
                  <input
                    id="confirm-password" type="password" required placeholder="Repeat password" minLength={6} autoComplete="new-password"
                    value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`mt-1.5 ${inputCls}`}
                  />
                </label>
                <div aria-live="polite" aria-atomic="true">
                  {error && <p className="text-sm text-flag-700">{error}</p>}
                </div>
                <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy || loading || !configured}>
                  {busy ? 'Updating…' : 'Update password'}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          <Link to="/login" className="hover:text-stone-600">← Back to sign in</Link>
        </p>
      </div>
    </AuthShell>
  )
}
