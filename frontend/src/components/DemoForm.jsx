import { useState } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabaseClient.js'
import { ArrowRight, Check } from './icons.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Demo / contact form. Inserts a `kind:'demo'` row with the message body.
// Used by the home "Request a demo" band and the Contact page.
export default function DemoForm({ className = '', heading, subhead, cta = 'Request a demo' }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle') // idle | submitting | success | error | invalid

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
      kind: 'demo',
      email: email.trim().toLowerCase(),
      name: name.trim() || null,
      company: company.trim() || null,
      message: message.trim() || null,
      referral_source: typeof document !== 'undefined' ? document.referrer || null : null,
    })

    setStatus(error ? 'error' : 'success')
  }

  if (status === 'success') {
    return (
      <div className={`card flex items-start gap-4 p-6 ${className}`}>
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-clay-50 text-clay-600 ring-1 ring-clay-200">
          <Check size={20} />
        </span>
        <div>
          <p className="font-serif text-lg font-semibold text-ink">Thanks — we'll be in touch.</p>
          <p className="mt-1 text-sm leading-relaxed text-stone-600">
            We read every message. Expect a reply at the email you provided.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-card sm:p-6 ${className}`}
    >
      {heading && <h3 className="font-serif text-xl font-semibold text-ink">{heading}</h3>}
      {subhead && <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{subhead}</p>}

      <div className={`grid gap-3 ${heading || subhead ? 'mt-5' : ''} sm:grid-cols-2`}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Name"
          className="w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (status === 'invalid' || status === 'error') setStatus('idle')
          }}
          placeholder="Work email"
          aria-label="Work email"
          className="w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
        />
      </div>
      <input
        type="text"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="Company"
        aria-label="Company"
        className="mt-3 w-full rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What are you hoping to solve? (optional)"
        aria-label="Message"
        rows={4}
        className="mt-3 w-full resize-none rounded-xl border border-stone-200 bg-paper px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-stone-400 focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
      />

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="btn-primary w-full px-6 py-3 text-base sm:w-auto"
        >
          {status === 'submitting' ? 'Sending…' : cta}
          {status !== 'submitting' && <ArrowRight size={18} />}
        </button>
        {!isSupabaseConfigured && (
          <p className="text-sm text-stone-500">
            Or email{' '}
            <a href="mailto:help@touchstones.ai" className="font-medium underline">
              help@touchstones.ai
            </a>
          </p>
        )}
      </div>

      {status === 'invalid' && (
        <p className="mt-3 text-sm text-flag-700">Please enter a valid email address.</p>
      )}
      {status === 'error' && (
        <p className="mt-3 text-sm text-flag-700">
          Something went wrong. Please email us at{' '}
          <a href="mailto:help@touchstones.ai" className="font-medium underline">
            help@touchstones.ai
          </a>
          .
        </p>
      )}
    </form>
  )
}
