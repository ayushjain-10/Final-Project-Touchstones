import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import Seo from '../../components/Seo.jsx'

// One in-app home for everything an account holder needs: edit profile, change email + password,
// sign out (this device or everywhere), manage billing, and delete the account. Each block keeps
// its own clear success / error state.
function Card({ title, desc, children }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-canvas p-6">
      <h2 className="font-serif text-xl font-semibold text-ink">{title}</h2>
      {desc && <p className="mt-1 text-sm leading-relaxed text-stone-600">{desc}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

const input =
  'w-full rounded-xl border border-stone-200 bg-paper px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100'
const btn = 'rounded-xl bg-clay-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-clay-600 disabled:opacity-50'
const btnGhost = 'rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:border-clay-300 hover:text-clay-700 disabled:opacity-50'

function Note({ state }) {
  if (!state) return null
  const ok = state.kind === 'ok'
  return (
    <p className={`mt-3 text-sm ${ok ? 'text-clay-700' : 'text-flag-700'}`}>{state.msg}</p>
  )
}

export default function Account() {
  const { user, updatePassword, updateEmail, signOut, signOutEverywhere } = useAuth()
  const navigate = useNavigate()

  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [profileNote, setProfileNote] = useState(null)
  const [profileSaving, setProfileSaving] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [emailNote, setEmailNote] = useState(null)

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwNote, setPwNote] = useState(null)

  const [busy, setBusy] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [deleteNote, setDeleteNote] = useState(null)

  useEffect(() => {
    let alive = true
    api.request('/auth/me').then((me) => {
      if (!alive || !me) return
      setFirst(me.first_name || me.firstName || '')
      setLast(me.last_name || me.lastName || '')
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  async function saveProfile(e) {
    e.preventDefault()
    setProfileSaving(true); setProfileNote(null)
    try {
      await api.request('/auth/me', { method: 'PUT', body: { firstName: first.trim(), lastName: last.trim() } })
      setProfileNote({ kind: 'ok', msg: 'Profile saved.' })
    } catch (err) {
      setProfileNote({ kind: 'err', msg: err.message || 'Could not save your profile.' })
    } finally {
      setProfileSaving(false)
    }
  }

  async function changeEmail(e) {
    e.preventDefault()
    setEmailNote(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setEmailNote({ kind: 'err', msg: 'Enter a valid email address.' }); return
    }
    try {
      await updateEmail(newEmail.trim())
      setEmailNote({ kind: 'ok', msg: `Confirmation sent to ${newEmail.trim()}. Click the link there to finish the change.` })
      setNewEmail('')
    } catch (err) {
      setEmailNote({ kind: 'err', msg: err.message || 'Could not start the email change.' })
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    setPwNote(null)
    if (pw.length < 8) { setPwNote({ kind: 'err', msg: 'Use at least 8 characters.' }); return }
    if (pw !== pw2) { setPwNote({ kind: 'err', msg: 'Passwords do not match.' }); return }
    try {
      await updatePassword(pw)
      setPw(''); setPw2('')
      setPwNote({ kind: 'ok', msg: 'Password updated.' })
    } catch (err) {
      setPwNote({ kind: 'err', msg: err.message || 'Could not update your password.' })
    }
  }

  async function manageBilling() {
    setBusy('billing')
    try {
      const r = await api.request('/auth/create-portal-session', { method: 'POST' })
      if (r?.url) window.location.href = r.url
      else setBusy('')
    } catch {
      setBusy('')
    }
  }

  async function deleteAccount() {
    setDeleteNote(null)
    if (confirmEmail.trim().toLowerCase() !== (user?.email || '').toLowerCase()) {
      setDeleteNote({ kind: 'err', msg: 'Type your account email exactly to confirm.' }); return
    }
    setBusy('delete')
    try {
      await api.request('/auth/account', { method: 'DELETE' })
      await signOut()
      navigate('/', { replace: true })
    } catch (err) {
      setBusy('')
      setDeleteNote({ kind: 'err', msg: err.message || 'Could not delete the account. Email support@touchstones.ai and we will action it.' })
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-1 py-2">
      <Seo title="Account settings" />
      <h1 className="font-serif text-3xl font-semibold text-ink">Account</h1>
      <p className="mt-1 text-stone-600">Manage your profile, security, billing, and data.</p>

      <div className="mt-8 space-y-6">
        <Card title="Profile" desc="Your name as it appears to your team.">
          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={input} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" aria-label="First name" />
              <input className={input} value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" aria-label="Last name" />
            </div>
            <button className={btn} disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save profile'}</button>
            <Note state={profileNote} />
          </form>
        </Card>

        <Card title="Email" desc={`Signed in as ${user?.email || ''}. Changing it sends a confirmation link to the new address.`}>
          <form onSubmit={changeEmail} className="flex flex-col gap-3 sm:flex-row">
            <input className={input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@email.com" aria-label="New email" />
            <button className={btnGhost}>Change email</button>
          </form>
          <Note state={emailNote} />
        </Card>

        <Card title="Password" desc="Set a new password for your account.">
          <form onSubmit={changePassword} className="space-y-3">
            <input className={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" aria-label="New password" autoComplete="new-password" />
            <input className={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" aria-label="Confirm new password" autoComplete="new-password" />
            <button className={btn}>Update password</button>
            <Note state={pwNote} />
          </form>
        </Card>

        <Card title="Sessions" desc="Sign out of this device, or revoke every active session.">
          <div className="flex flex-wrap gap-3">
            <button className={btnGhost} onClick={() => signOut().then(() => navigate('/login', { replace: true }))}>Sign out</button>
            <button className={btnGhost} onClick={() => signOutEverywhere().then(() => navigate('/login', { replace: true }))}>Sign out everywhere</button>
          </div>
        </Card>

        <Card title="Billing" desc="View your plan and invoices, update your card, or cancel — in the secure Stripe portal.">
          <button className={btn} onClick={manageBilling} disabled={busy === 'billing'}>{busy === 'billing' ? 'Opening…' : 'Manage billing'}</button>
        </Card>

        <section className="rounded-2xl border border-flag-100 bg-flag-50/40 p-6">
          <h2 className="font-serif text-xl font-semibold text-flag-700">Delete account</h2>
          <p className="mt-1 text-sm leading-relaxed text-stone-600">
            Permanently deletes your account and associated data. This cannot be undone. Type your
            email <span className="font-medium text-ink">{user?.email}</span> to confirm.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input className={input} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder="your@email.com" aria-label="Confirm email to delete account" />
            <button
              className="rounded-xl bg-flag-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-flag-700 disabled:opacity-50"
              onClick={deleteAccount}
              disabled={busy === 'delete'}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
          <Note state={deleteNote} />
        </section>
      </div>
    </div>
  )
}
