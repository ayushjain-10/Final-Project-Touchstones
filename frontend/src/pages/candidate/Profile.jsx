import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import { User, ShieldCheck, FileText, Lock } from '../../components/icons.jsx'

// Candidate portal — profile & settings. Identity (read-only), change password, data export, and
// the privacy promise: self-serve account deletion.
function Section({ icon: Icon, title, children }) {
  return (
    <section className="mt-4 rounded-2xl border border-stone-200 bg-canvas/60 p-5 dark:border-[#25304D] dark:bg-[#0D1426]">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-clay-500" />
        <h2 className="font-medium text-ink dark:text-[#F4F6FF]">{title}</h2>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function Profile() {
  const { user, profile, updatePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const email = user?.email || ''
  const firstName = user?.user_metadata?.first_name || profile?.first_name || ''

  const [pw, setPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState(null)

  const [confirmText, setConfirmText] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState(null)

  async function changePassword(e) {
    e.preventDefault()
    setPwMsg(null)
    if (pw.length < 8) {
      setPwMsg({ ok: false, text: 'Use at least 8 characters.' })
      return
    }
    setPwBusy(true)
    try {
      await updatePassword(pw)
      setPw('')
      setPwMsg({ ok: true, text: 'Password updated.' })
    } catch (err) {
      setPwMsg({ ok: false, text: err?.message || 'Could not update your password.' })
    } finally {
      setPwBusy(false)
    }
  }

  async function exportData() {
    try {
      const data = await api.getMyData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'touchstones-my-data.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      /* surfaced rarely; the button can be retried */
    }
  }

  async function deleteAccount() {
    if (confirmText !== 'DELETE') return
    setDeleting(true)
    setDeleteErr(null)
    try {
      await api.deleteMyAccount()
      await signOut()
      navigate('/', { replace: true })
    } catch (err) {
      setDeleteErr(err?.message || 'Could not delete your account.')
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-serif text-3xl font-semibold text-ink dark:text-[#F4F6FF]">Profile &amp; settings</h1>

      <Section icon={User} title="Your account">
        <dl className="grid grid-cols-[88px,1fr] gap-y-2 text-sm">
          <dt className="text-stone-500 dark:text-[#8490AE]">Name</dt>
          <dd className="text-ink dark:text-[#F4F6FF]">{firstName || 'Not set'}</dd>
          <dt className="text-stone-500 dark:text-[#8490AE]">Email</dt>
          <dd className="text-ink dark:text-[#F4F6FF]">{email}</dd>
        </dl>
      </Section>

      <Section icon={Lock} title="Change password">
        <form onSubmit={changePassword} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            className="flex-1 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-ink outline-none transition-colors focus:border-clay-400 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF]"
          />
          <button type="submit" disabled={pwBusy} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
            {pwBusy ? 'Saving…' : 'Update'}
          </button>
        </form>
        {pwMsg && (
          <p className={`mt-2 text-sm ${pwMsg.ok ? 'text-clay-700 dark:text-[#9DA9EF]' : 'text-flag-700 dark:text-[#F0846A]'}`}>
            {pwMsg.text}
          </p>
        )}
      </Section>

      <Section icon={FileText} title="Your data">
        <p className="text-sm text-stone-600 dark:text-[#AEB7D0]">
          Download everything we hold for your account — your profile, submissions, and credentials.
        </p>
        <button
          type="button"
          onClick={exportData}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
        >
          Export my data (JSON)
        </button>
      </Section>

      <Section icon={ShieldCheck} title="Delete account">
        <p className="text-sm text-stone-600 dark:text-[#AEB7D0]">
          Permanently delete your account and all your data. This can’t be undone.
        </p>
        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="mt-3 inline-flex rounded-xl border border-flag-200 bg-flag-50 px-4 py-2 text-sm font-medium text-flag-700 transition-colors hover:border-flag-300 dark:border-flag-500/30 dark:bg-flag-500/10 dark:text-[#F0846A]"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-3 rounded-xl border border-flag-200 bg-flag-50/60 p-4 dark:border-flag-500/30 dark:bg-flag-500/10">
            <p className="text-sm text-flag-800 dark:text-[#F0846A]">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm. This erases your
              profile, submissions, and credentials forever.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-2 w-40 rounded-lg border border-flag-200 bg-white px-3 py-1.5 text-sm font-mono text-ink outline-none dark:border-flag-500/40 dark:bg-[#090E1C] dark:text-[#F4F6FF]"
            />
            {deleteErr && <p className="mt-2 text-sm text-flag-700 dark:text-[#F0846A]">{deleteErr}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={deleteAccount}
                disabled={confirmText !== 'DELETE' || deleting}
                className="rounded-xl bg-flag-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-flag-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDelete(false)
                  setConfirmText('')
                  setDeleteErr(null)
                }}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
