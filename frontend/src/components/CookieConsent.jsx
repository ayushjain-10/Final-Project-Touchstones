import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { initAnalytics } from '../services/analytics.js'

// Privacy-respecting cookie consent. We only set ONE non-essential cookie category: product
// analytics (Amplitude), and only when VITE_AMPLITUDE_API_KEY is configured. Analytics stay OFF until the
// visitor explicitly accepts (opt-in default). Choice is remembered in localStorage.
const KEY = 'ts_cookie_consent' // 'accepted' | 'declined'
// Non-essential cookies now come from TWO sources: Amplitude (when a key is set) and the marketing
// visitor trackers in index.html (GA/Apollo/Leadsy, which load only on the production hostnames via
// window.__loadTouchstonesTrackers). The banner must appear whenever EITHER applies, so consent can
// actually gate the trackers (S-7), not only when Amplitude is configured.
const ANALYTICS_CONFIGURED = !!import.meta.env.VITE_AMPLITUDE_API_KEY
const TRACKER_HOSTS = ['touchstones.ai', 'www.touchstones.ai', 'app.touchstones.ai', 'touchstone-app.vercel.app']
const TRACKERS_APPLICABLE =
  typeof window !== 'undefined' && TRACKER_HOSTS.includes(window.location.hostname)
const NEEDS_CONSENT = ANALYTICS_CONFIGURED || TRACKERS_APPLICABLE

export function hasAnalyticsConsent() {
  try {
    return localStorage.getItem(KEY) === 'accepted'
  } catch {
    return false
  }
}

// Focused full-screen flows where a fixed bottom banner would overlap the workspace.
const FOCUSED = ['/candidate', '/probe', '/apply', '/verify', '/passport', '/client-review', '/app/verified-sessions-preview']

export default function CookieConsent() {
  const { pathname } = useLocation()
  const [choice, setChoice] = useState('made') // 'made' until we read storage, then '' shows the banner

  useEffect(() => {
    if (!NEEDS_CONSENT) return // no non-essential cookies here -> no banner needed
    let stored = null
    try {
      stored = localStorage.getItem(KEY)
    } catch {
      stored = null
    }
    setChoice(stored || '')
  }, [])

  if (!NEEDS_CONSENT || choice !== '') return null
  if (FOCUSED.some((p) => pathname.startsWith(p))) return null

  const decide = (value) => {
    try {
      localStorage.setItem(KEY, value)
    } catch {
      /* ignore */
    }
    if (value === 'accepted') {
      initAnalytics() // Amplitude (no-ops without a key)
      try { window.__loadTouchstonesTrackers?.() } catch { /* trackers optional */ } // GA/Apollo/Leadsy
    }
    setChoice(value)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="mx-auto flex max-w-content flex-col gap-3 rounded-xl border border-stone-200 bg-canvas/95 p-3 shadow-card backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:rounded-2xl sm:p-5">
        <p className="text-xs leading-relaxed text-stone-600 sm:text-sm">
          <span className="sm:hidden">Analytics only with consent. No ads, no selling data.</span>
          <span className="hidden sm:inline">
            We use privacy-friendly product analytics to improve Touchstones — only with your
            consent. No ads, no selling your data.
          </span>{' '}
          <Link to="/privacy" className="font-medium text-clay-700 underline">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide('declined')}
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-clay-300 hover:text-clay-700 sm:flex-none sm:rounded-xl sm:px-4"
          >
            Decline
          </button>
          <button
            onClick={() => decide('accepted')}
            className="flex-1 rounded-lg bg-clay-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-clay-600 sm:flex-none sm:rounded-xl sm:px-4"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
