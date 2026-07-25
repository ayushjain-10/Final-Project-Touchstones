import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import { ShieldCheck, User, Clock, ArrowRight, Check } from '../../components/icons.jsx'

// "Request recruiter access" — the candidate → hiring-team upgrade path.
//
// Self-promotion is DB-blocked, so the request goes through the backend
// (POST /api/portal/request-recruiter), which moves recruiter_status none→pending
// (or returns 'verified' if an invite already cleared the account). The caller MUST
// be signed in; a signed-out visitor is prompted to sign up (as a candidate) first.
export default function RecruiterAccess() {
  const { user, profile, roleLoaded, isRecruiter } = useAuth()
  const navigate = useNavigate()

  const [company, setCompany] = useState('')
  const [workEmail, setWorkEmail] = useState('')
  const [roleTitle, setRoleTitle] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Local pending flag for the just-submitted case (the cached profile won't
  // reflect the new status until it's refetched).
  const [submitted, setSubmitted] = useState(false)

  const status = profile?.recruiter_status
  const alreadyPending = status === 'pending'

  const inputCls =
    'w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-ink ' +
    'placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100 ' +
    'dark:border-[#25304D] dark:bg-[#0D1426] dark:text-[#F4F6FF]'

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { recruiter_status } = await api.requestRecruiterAccess({
        company: company.trim() || undefined,
        work_email: workEmail.trim() || undefined,
        role_title: roleTitle.trim() || undefined,
        note: note.trim() || undefined,
      })
      // An invite may have already cleared them — drop them straight into the app.
      if (recruiter_status === 'verified') {
        navigate('/app')
        return
      }
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Could not submit your request. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // --- A verified recruiter doesn't need this page → send them home to the app.
  if (isRecruiter) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center dark:text-[#F4F6FF]">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200">
          <Check size={26} />
        </span>
        <h1 className="mt-5 font-serif text-2xl font-semibold text-ink dark:text-[#F4F6FF]">
          You already have recruiter access.
        </h1>
        <p className="mt-3 text-stone-600 dark:text-[#AEB7D0]">Head to your hiring dashboard.</p>
        <Link to="/app" className="btn-primary mt-6 inline-flex">
          Open dashboard <ArrowRight size={16} />
        </Link>
      </div>
    )
  }

  // --- Not signed in → must create a (candidate) account first.
  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-3 py-1 text-xs font-medium text-clay-700 dark:border-clay-500/30 dark:bg-clay-500/10 dark:text-[#9DA9EF]">
          <ShieldCheck size={13} /> Hiring teams
        </span>
        <h1 className="mt-4 font-serif text-3xl font-semibold text-ink dark:text-[#F4F6FF]">
          Request recruiter access
        </h1>
        <p className="mt-3 text-stone-600 dark:text-[#AEB7D0]">
          Recruiter access is granted by invite or approval. To request it, first create your
          Touchstones account — it takes a moment — then come back here to send your request.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link to="/login" state={{ from: '/recruiter-access', mode: 'signup' }} className="btn-primary">
            Create an account <ArrowRight size={16} />
          </Link>
          <Link to="/login" state={{ from: '/recruiter-access' }} className="btn-ghost dark:border-[#303C5C] dark:text-[#F4F6FF]">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  // --- Already submitted (this session) or already pending on the profile.
  if (submitted || alreadyPending) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200 dark:bg-clay-500/10 dark:ring-clay-500/30">
          <Clock size={24} />
        </span>
        <h1 className="mt-5 font-serif text-2xl font-semibold text-ink dark:text-[#F4F6FF]">
          Your recruiter access is pending review
        </h1>
        <p className="mx-auto mt-3 max-w-md text-stone-600 dark:text-[#AEB7D0]">
          Thanks — we’ve got your request. We’ll email you as soon as you’re approved. In the
          meantime, your candidate dashboard is ready to use.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link to="/candidate/home" className="btn-primary">
            Go to my dashboard <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  // --- Signed-in candidate: the request form (all fields optional).
  return (
    <div className="mx-auto max-w-xl px-5 py-14">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-3 py-1 text-xs font-medium text-clay-700 dark:border-clay-500/30 dark:bg-clay-500/10 dark:text-[#9DA9EF]">
        <ShieldCheck size={13} /> Hiring teams
      </span>
      <h1 className="mt-4 font-serif text-3xl font-semibold text-ink dark:text-[#F4F6FF]">
        Request recruiter access
      </h1>
      <p className="mt-3 text-stone-600 dark:text-[#AEB7D0]">
        Tell us a little about your team. We grant recruiter access by approval (or instantly if your
        company already invited you). Everything below is optional — it just helps us approve faster.
      </p>

      {!roleLoaded && (
        <p className="mt-5 text-sm text-stone-400 dark:text-[#8490AE]">Loading your account…</p>
      )}

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink dark:text-[#F4F6FF]">Company</label>
          <input
            type="text" placeholder="Acme Inc." autoComplete="organization"
            value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink dark:text-[#F4F6FF]">Work email</label>
          <input
            type="email" placeholder="you@company.com" autoComplete="email"
            value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink dark:text-[#F4F6FF]">Role / title</label>
          <input
            type="text" placeholder="Head of Talent, Engineering Manager…" autoComplete="organization-title"
            value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink dark:text-[#F4F6FF]">
            Anything else? <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <textarea
            rows={3} placeholder="What you’re hiring for, your team size, how you heard about us…"
            value={note} onChange={(e) => setNote(e.target.value)}
            className={`${inputCls} resize-y`}
          />
        </div>

        {error && <p className="text-sm text-flag-700 dark:text-[#F0846A]">{error}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Request access'} <ArrowRight size={16} />
          </Button>
          <Link
            to="/candidate/home"
            className="text-sm font-medium text-stone-500 hover:text-stone-700 dark:text-[#AEB7D0] dark:hover:text-[#F4F6FF]"
          >
            Maybe later
          </Link>
        </div>
      </form>

      <div className="mt-8 flex items-start gap-2.5 rounded-2xl border border-stone-200 bg-canvas/60 p-4 text-sm text-stone-600 dark:border-[#25304D] dark:bg-[#0D1426] dark:text-[#AEB7D0]">
        <User size={16} className="mt-0.5 shrink-0 text-clay-500" />
        <span>
          You’re signed in as <span className="font-medium text-ink dark:text-[#F4F6FF]">{user.email}</span>.
          Until you’re approved, you can keep using your{' '}
          <Link to="/candidate/home" className="font-medium text-clay-700 underline-offset-2 hover:underline dark:text-[#9DA9EF]">
            candidate dashboard
          </Link>
          .
        </span>
      </div>
    </div>
  )
}
