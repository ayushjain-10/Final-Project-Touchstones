// Lightweight analytics wrapper around Amplitude for the activation funnel
// (author → send → complete → score → advance). It NO-OPS entirely when
// VITE_AMPLITUDE_API_KEY is unset, so the instrumentation ships now and turns on the
// moment a key is provided. It never blocks the app and never invents data.
import * as amplitude from '@amplitude/analytics-browser'

let enabled = false

// Global event properties (platform + first-touch), the Amplitude equivalent of
// Mixpanel super properties. Amplitude has no register(); we attach these to every
// event via a single enrichment plugin (see initAnalytics). Snapshotted at init,
// after first-touch is captured, so the value is stable for the session.
let globalEventProps = {}
const globalPropsPlugin = {
  name: 'ts-global-props',
  type: 'enrichment',
  execute: async (event) => {
    // Explicit per-event props win over globals on any key collision.
    event.event_properties = { ...globalEventProps, ...event.event_properties }
    return event
  },
}

// First-touch acquisition context (UTM params + external referrer), captured
// ONCE on the first analytics-enabled load and persisted so it survives the
// signup that happens screens later. First touch wins — a later internal
// navigation never overwrites where the visitor actually came from.
const FIRST_TOUCH_KEY = 'ts_first_touch'
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

function captureFirstTouch() {
  if (typeof window === 'undefined') return
  try {
    if (localStorage.getItem(FIRST_TOUCH_KEY)) return // first touch wins
    const params = new URLSearchParams(window.location.search)
    const data = {}
    for (const k of UTM_KEYS) {
      const v = params.get(k)
      if (v) data[k] = v.slice(0, 200)
    }
    const ref = document.referrer
    if (ref && !ref.startsWith(window.location.origin)) data.referrer = ref.slice(0, 300)
    data.landing_path = window.location.pathname
    // Always persist (even a bare landing) so a later internal referrer can't be
    // mistaken for first touch.
    localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(data))
  } catch {
    /* private mode / storage unavailable: degrade to no attribution */
  }
}

// The stored first-touch properties (or {}), for attaching to signup events.
export function getFirstTouch() {
  try {
    const raw = localStorage.getItem(FIRST_TOUCH_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function initAnalytics() {
  const apiKey = import.meta.env.VITE_AMPLITUDE_API_KEY
  if (enabled || !apiKey || typeof window === 'undefined') return
  try {
    amplitude.init(apiKey, {
      // Disable ALL autocapture: no page views, no session events, no form/file
      // interactions, no marketing attribution. We capture first-touch ourselves.
      autocapture: false,
      // Persist identity in localStorage (not a cookie), matching the prior wrapper.
      identityStorage: 'localStorage',
      // Data residency: set VITE_AMPLITUDE_SERVER_ZONE=EU if the Amplitude project
      // lives in the EU region, else events silently drop. Defaults to US.
      serverZone: import.meta.env.VITE_AMPLITUDE_SERVER_ZONE === 'EU' ? 'EU' : 'US',
    })
    enabled = true
    captureFirstTouch()
    globalEventProps = { platform: 'web', ...getFirstTouch() }
    amplitude.add(globalPropsPlugin)
    // One heartbeat per load (post-consent) so the pipe is observable in Amplitude
    // even before the visitor takes a funnel action. Autocapture stays off.
    amplitude.track('app_opened')
  } catch {
    enabled = false
  }
}

export function identify(user) {
  if (!enabled || !user || !user.id) return
  try {
    // Attach first-touch acquisition context as user properties so every
    // identified user carries where they came from. Email is a plain user
    // property (Amplitude has no special email field) and is never the identity.
    const firstTouch = getFirstTouch()
    const id = new amplitude.Identify()
    for (const [k, v] of Object.entries(firstTouch)) id.set(k, v)
    if (user.email) id.set('email', user.email)
    amplitude.setUserId(user.id)
    amplitude.identify(id)
  } catch {
    /* never throw from analytics */
  }
}

export function track(event, props = {}) {
  if (!enabled) return
  try {
    amplitude.track(event, props)
  } catch {
    /* never throw from analytics */
  }
}

// Fire an event at most once per browser. Used for "first"-style aha metrics
// (e.g. first_score_viewed) so the funnel can measure time-to-first-value
// without every repeat view inflating the count.
const ONCE_KEY = 'ts_analytics_once'
export function trackOnce(event, props = {}) {
  if (!enabled) return
  try {
    let fired = []
    try {
      fired = JSON.parse(localStorage.getItem(ONCE_KEY) || '[]')
    } catch {
      fired = []
    }
    if (fired.includes(event)) return
    amplitude.track(event, props)
    fired.push(event)
    try {
      localStorage.setItem(ONCE_KEY, JSON.stringify(fired))
    } catch {
      /* ignore persistence failure: worst case the event fires again */
    }
  } catch {
    /* never throw from analytics */
  }
}

export function resetAnalytics() {
  if (!enabled) return
  try {
    amplitude.reset()
  } catch {
    /* never throw from analytics */
  }
}
