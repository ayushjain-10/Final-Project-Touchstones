import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import Logo from './Logo.jsx'
import { Grid, Code, Sparkle, Clock, ArrowUpRight, ShieldCheck, Bolt, User, Eye, Link as NetworkIcon } from './icons.jsx'
import api from '../services/api.js'
import { isSupabaseConfigured } from '../services/supabaseClient.js'

const MVP_SKELETONS_ENABLED = import.meta.env.VITE_MVP_SKELETONS_ENABLED === 'true'
const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// In-app nav: 9 top-level items in four groups. Primary work sits up top; low-traffic surfaces
// (Live probe, Network, Developers) live under "Advanced" so the rail reads for the 80% case.
// "New screen" is intentionally NOT a nav item — the Overview and the Library both surface an
// authoring CTA, so a rail entry was redundant (/app/author still routes). The Library entry
// keeps the label "Assessments" (matching the Library page's own heading); the Overview's list is
// titled "Your screens" so the two never collide. Compliance is surfaced as "Trust & audit".
// Every item has a DISTINCT icon; "Preview as candidate" is the quiet action below.
const legacyGroups = [
  {
    heading: 'Screen & assess',
    items: [
      { to: '/app', label: 'Overview', icon: Grid, end: true },
      { to: '/app/library', label: 'Assessments', icon: Code },
      { to: '/app/activity', label: 'Activity', icon: Clock },
    ],
  },
  {
    heading: 'Measure',
    items: [
      { to: '/app/insights', label: 'Insights', icon: ArrowUpRight },
      { to: '/app/compliance', label: 'Trust & audit', icon: ShieldCheck },
    ],
  },
  {
    heading: 'Advanced',
    items: [
      ...(MVP_SKELETONS_ENABLED ? [{ to: '/app/mvp-buildout', label: 'MVP buildout', icon: Sparkle }] : []),
      { to: '/app/probe', label: 'Live probe', icon: Sparkle },
      { to: '/app/network', label: 'Network', icon: NetworkIcon },
      { to: '/app/developers', label: 'Developers', icon: Bolt },
    ],
  },
  {
    heading: 'Workspace',
    items: [{ to: '/app/team', label: 'Team & billing', icon: User }],
  },
]

const editorialGroups = [
  {
    heading: 'Workspace',
    items: [
      { to: '/app', label: 'Home', icon: Grid, end: true },
      { to: '/app/library', label: 'Screens', icon: Code },
      { to: '/app/activity', label: 'Candidates', icon: Clock },
      { to: '/app/insights', label: 'Insights', icon: ArrowUpRight },
    ],
  },
  {
    heading: 'Assurance',
    items: [
      { to: '/app/compliance', label: 'Trust & audit', icon: ShieldCheck },
      { to: '/app/probe', label: 'Live probe', icon: Sparkle },
      { to: '/app/network', label: 'Network', icon: NetworkIcon },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { to: '/app/team', label: 'Team & billing', icon: User },
      { to: '/app/developers', label: 'Developers', icon: Bolt },
      ...(MVP_SKELETONS_ENABLED ? [{ to: '/app/mvp-buildout', label: 'MVP buildout', icon: Sparkle }] : []),
    ],
  },
]

const groups = EDITORIAL_UI_ENABLED ? editorialGroups : legacyGroups

// Real plan + free-tier meter. Loads /payments/usage; shows a skeleton while
// loading and HIDES itself on error/unconfigured rather than ever showing a
// fabricated quota. "Upgrade" opens Stripe Checkout, falling back to /pricing.
function UsageWidget() {
  const [usage, setUsage] = useState(null)
  const [state, setState] = useState(isSupabaseConfigured ? 'loading' : 'hidden') // 'loading' | 'ok' | 'hidden'
  const [upgrading, setUpgrading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    let active = true
    api
      .getPaymentsUsage()
      .then((u) => {
        if (!active) return
        setUsage(u)
        setState('ok')
      })
      .catch(() => {
        if (active) setState('hidden')
      })
    return () => {
      active = false
    }
  }, [])

  async function upgrade() {
    setUpgrading(true)
    try {
      const { url } = await api.createCheckoutSession('startup')
      window.location.assign(url || '/pricing')
    } catch {
      window.location.assign('/pricing')
    }
  }

  async function manageBilling() {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const { url } = await api.createPortalSession()
      if (!url) throw new Error('no url')
      window.location.assign(url) // navigates away
    } catch (e) {
      const s = e?.status
      setPortalError(
        s === 404 || s === 503
          ? 'Billing management is coming online.'
          : s === 400
            ? 'No billing account yet.'
            : 'Couldn’t open billing.',
      )
      setPortalLoading(false)
    }
  }

  if (state === 'hidden') return null

  if (state === 'loading') {
    return (
      <div className="mt-auto rounded-2xl border border-stone-200 bg-white p-4">
        <div className="h-4 w-20 animate-pulse rounded bg-stone-200/70" />
        <div className="mt-2 h-3 w-32 animate-pulse rounded bg-stone-200/60" />
        <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-stone-200" />
      </div>
    )
  }

  const limit = Number(usage?.limit) || 0
  const used = Number(usage?.used) || 0
  const plan = usage?.plan || 'free'
  const isFree = plan === 'free'
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const atLimit = isFree && limit > 0 && used >= limit
  const planLabel = `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`

  return (
    <div className="mt-auto rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-sm font-semibold text-ink">{planLabel}</p>
      {isFree ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            {atLimit
              ? `You've used all ${limit} verified screens this month.`
              : `${used} of ${limit} verified screens used this month.`}
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full ${atLimit ? 'bg-flag-500' : 'bg-clay-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            type="button"
            onClick={upgrade}
            disabled={upgrading}
            className="mt-3 inline-block text-xs font-semibold text-clay-700 hover:text-clay-800 disabled:opacity-50"
          >
            {upgrading ? 'Opening checkout…' : 'Upgrade →'}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            {used} verified screen{used === 1 ? '' : 's'} this month.
          </p>
          <button
            type="button"
            onClick={manageBilling}
            disabled={portalLoading}
            className="mt-3 inline-block text-xs font-semibold text-clay-700 hover:text-clay-800 disabled:opacity-50"
          >
            {portalLoading ? 'Opening…' : 'Manage billing →'}
          </button>
          {portalError && <p className="mt-1.5 text-[0.7rem] text-stone-400">{portalError}</p>}
        </>
      )}
    </div>
  )
}

// Left rail for the in-app screens. Quiet, warm, hairline-bordered.
// `mobile` renders it as a full-height drawer panel (no sticky/hidden), and
// `onNavigate` is called on link clicks so the drawer can close itself.
export default function AppSidebar({ mobile = false, onNavigate }) {
  const item = ({ isActive }) =>
    EDITORIAL_UI_ENABLED
      ? `relative flex items-center gap-3 border-l px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? 'border-brand-500 bg-brand-50/70 text-brand-800'
            : 'border-transparent text-stone-600 hover:border-stone-300 hover:bg-stone-100/70 hover:text-ink'
        }`
      : `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive ? 'bg-clay-50 text-clay-700 ring-1 ring-clay-200' : 'text-stone-600 hover:bg-stone-100 hover:text-ink'
        }`

  const handleClick = () => {
    if (onNavigate) onNavigate()
  }

  const content = (
    <>
      <div className="px-2">
        <Logo />
      </div>

      <div className="mt-8 flex flex-col gap-6">
        {groups.map((g) => (
          <div key={g.heading}>
            <div className="px-3 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{g.heading}</div>
            <nav className="mt-2 flex flex-col gap-1">
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={item} onClick={handleClick}>
                  <n.icon size={18} />
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </div>

      {/* Quiet "preview as candidate" action — not a primary destination. */}
      <NavLink
        to="/candidate"
        onClick={handleClick}
        className="mt-6 inline-flex items-center gap-2 px-3 text-xs font-medium text-stone-400 transition-colors hover:text-stone-600"
      >
        <Eye size={14} /> Preview as candidate
      </NavLink>

      <UsageWidget />
    </>
  )

  if (mobile) {
    return <aside className="flex h-full w-full flex-col overflow-y-auto bg-canvas px-3 py-5">{content}</aside>
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-stone-200 bg-canvas/60 px-3 py-5 lg:flex">
      {content}
    </aside>
  )
}
