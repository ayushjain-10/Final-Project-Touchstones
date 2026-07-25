import { useState } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabaseClient.js'
import { ArrowRight, Check } from './icons.jsx'
import Magnetic from './Magnetic.jsx'

const ROLES = [
  { value: '', label: "What's your role?" },
  { value: 'founder_cto', label: 'Founder / CTO' },
  { value: 'recruiter', label: 'In-house recruiter' },
  { value: 'eng_lead', label: 'Engineering lead' },
  { value: 'other', label: 'Other' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The hero waitlist form. Inserts a `kind:'waitlist'` row via the Supabase anon
// client (no backend round-trip) and surfaces friendly success / duplicate /
// error states. Renders gracefully even when Supabase isn't configured.
export default function WaitlistForm({ id = 'waitlist', className = '' }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('idle') // idle | submitting | success | duplicate | error

  async function onSubmit(e) {
    e.preventDefault()
    if (status === 'submitting') return

    if (!EMAIL_RE.test(email.trim())) {
      setStatus('invalid')
      return
    }
    if (!isSupabaseConfigured) {
      setStatus('error')
      return
    }

    setStatus('submitting')
    const { error } = await supabase.from('waitlist').insert({
      kind: 'waitlist',
      email: email.trim().toLowerCase(),
      name: name.trim() || null,
      company: company.trim() || null,
      role: role || null,
      referral_source: typeof document !== 'undefined' ? document.referrer || null : null,
    })

    if (!error) {
      setStatus('success')
      return
    }
    // Postgres unique_violation — already on the list.
    if (error.code === '23505') {
      setStatus('duplicate')
      return
    }
    setStatus('error')
  }

  if (status === 'success' || status === 'duplicate') {
    return (
      <div id={id} className={`scroll-mt-24 ${className}`}>
        <div className="card flex items-start gap-4 p-6">
          <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
            <Check size={20} />
          </span>
          <div>
            <p className="font-serif text-lg font-semibold text-ink">
              {status === 'duplicate' ? "You're already on the list ✓" : "You're on the list ✓"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">
              {status === 'duplicate'
                ? "Good news — we already have you. We'll be in touch as we open up early access."
                : "Thanks for joining. We'll reach out as we open up early access to design partners."}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className={`scroll-mt-24 ${className}`}>
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-card sm:p-5"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (status === 'invalid' || status === 'error') setStatus('idle')
            }}
            placeholder="you@startup.com"
            aria-label="Work email"
            className="w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            aria-label="Name"
            className="w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
          />
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company (optional)"
            aria-label="Company"
            className="w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Your role"
            className={`w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100 ${
              role ? 'text-ink' : 'text-stone-400'
            }`}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value} className="text-ink">
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Magnetic strength={8} className="block w-full sm:inline-block sm:w-auto">
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="btn-primary w-full px-6 py-3 text-base sm:w-auto"
            >
              {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
              {status !== 'submitting' && <ArrowRight size={18} />}
            </button>
          </Magnetic>

          {!isSupabaseConfigured && (
            <p className="text-sm text-stone-500">Waitlist opens shortly — check back soon.</p>
          )}
        </div>

        {status === 'invalid' && (
          <p className="mt-3 text-sm text-flag-700">Please enter a valid email address.</p>
        )}
        {status === 'error' && (
          <p className="mt-3 text-sm text-flag-700">
            Something went wrong on our end. Email us at{' '}
            <a href="mailto:help@touchstones.ai" className="font-medium underline">
              help@touchstones.ai
            </a>{' '}
            and we'll add you.
          </p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          No spam. We'll only email you about early access. See our{' '}
          <a href="/privacy" className="underline hover:text-stone-600">
            Privacy Policy
          </a>
          .
        </p>
      </form>
    </div>
  )
}
