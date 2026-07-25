import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Founder admin console — email-OTP gated (backend/src/routes/admin.js).
// One place to check the whole business: Overview KPIs (clickable), full Users list with
// per-user drill-down, Reach-outs, a merged Activity feed, Marketing sources, and the live
// email-delivery log (from Resend). Auto-refreshes the active tab every 60s.
// Direct URL only (/admin); the backend 404s everything unless ADMIN_DASHBOARD_ENABLED is set.

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const TOKEN_KEY = 'ts_admin_token'
const REFRESH_MS = 60_000

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status })
  return json
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const fmtAgo = (iso) => {
  if (!iso) return '—'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/* ---------------------------------------------------------------- pieces --- */

function Kpi({ label, value, hint, onClick }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      onClick={onClick}
      className={`rounded-2xl border border-stone-200 bg-white/70 p-4 text-left shadow-card ${
        onClick ? 'transition-colors hover:border-clay-300 focus:outline-none focus:ring-2 focus:ring-clay-300' : ''
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-1 font-serif text-3xl font-semibold text-ink">{value ?? '—'}</p>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
    </Cmp>
  )
}

function Section({ title, hint, children, right }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white/70 shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-canvas/70 px-5 py-3.5">
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
          {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
        </div>
        {right}
      </div>
      <div className="overflow-x-auto p-4">{children}</div>
    </section>
  )
}

function Table({ cols, rows, empty, onRowClick }) {
  if (!rows || rows.length === 0) return <p className="px-1 py-3 text-sm text-stone-400">{empty || 'Nothing yet.'}</p>
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-stone-400">
          {cols.map((c) => (
            <th key={c.key} className="px-2 py-1.5 font-semibold">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.id || i}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={`border-t border-stone-100 text-stone-700 ${onRowClick ? 'cursor-pointer transition-colors hover:bg-clay-50/60' : ''}`}
          >
            {cols.map((c) => (
              <td key={c.key} className="px-2 py-2 align-top">{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatusPill({ value }) {
  const tone =
    /delivered|verified|scored|active/.test(String(value)) ? 'bg-clay-50 text-clay-800 ring-clay-200'
      : /bounce|suppress|fail|reject|error/.test(String(value)) ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : 'bg-stone-100 text-stone-600 ring-stone-200'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone}`}>{String(value ?? '—')}</span>
}

const LINKS = [
  ['Amplitude (product analytics, visitors + funnels)', 'https://app.amplitude.com'],
  ['Google Analytics (marketing-site visitors)', 'https://analytics.google.com'],
  ['Sentry (errors)', 'https://touchstones.sentry.io'],
  ['Render (dev backend)', 'https://dashboard.render.com/web/srv-d8udsvdckfvc73f2qt7g'],
  ['Vercel (frontend deploys)', 'https://vercel.com/ayushjain10s-projects/touchstone'],
  ['Supabase (database)', 'https://supabase.com/dashboard/project/cjxgjqfdfdstdfxhtaho'],
  ['Stripe (billing)', 'https://dashboard.stripe.com'],
  ['Resend (email)', 'https://resend.com/emails'],
]

const TABS = ['Overview', 'Users', 'Reach-outs', 'Activity', 'Marketing', 'Email log']

/* ------------------------------------------------------------------ page --- */

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '')
  const [step, setStep] = useState(token ? 'dashboard' : 'request')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [tab, setTab] = useState('Overview')
  const [data, setData] = useState({}) // { overview, users, activity, marketing, emailLog }
  const [updatedAt, setUpdatedAt] = useState(null)
  const [userQuery, setUserQuery] = useState('')
  const [userType, setUserType] = useState('')
  const [selectedUser, setSelectedUser] = useState(null) // { id, loading, detail }
  const timerRef = useRef(null)

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
    setData({})
    setSelectedUser(null)
    setStep('request')
  }

  const requestCode = async () => {
    setBusy(true); setError(null)
    try {
      await api('/otp/request', { method: 'POST' })
      setStep('verify')
    } catch (e) {
      setError(e.status === 404 ? 'The admin dashboard is not enabled on this environment.' : e.message)
    } finally { setBusy(false) }
  }

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const { token: t } = await api('/otp/verify', { method: 'POST', body: { code } })
      sessionStorage.setItem(TOKEN_KEY, t)
      setToken(t)
      setStep('dashboard')
    } catch (e2) {
      setError(e2.message)
    } finally { setBusy(false) }
  }

  // Load whatever the active tab needs (overview always, for the KPI header).
  const load = useCallback(async (activeTab, t, { quiet = false } = {}) => {
    if (!t) return
    if (!quiet) setBusy(true)
    setError(null)
    try {
      const wants = { Overview: [], Users: ['users'], 'Reach-outs': [], Activity: ['activity'], Marketing: ['marketing'], 'Email log': ['emailLog'] }[activeTab] || []
      const [overview, ...rest] = await Promise.all([
        api('/overview', { token: t }),
        ...wants.map((w) =>
          w === 'users' ? api(`/users?${new URLSearchParams({ ...(userQuery ? { q: userQuery } : {}), ...(userType ? { type: userType } : {}) })}`, { token: t })
          : w === 'activity' ? api('/activity?days=30', { token: t })
          : w === 'marketing' ? api('/marketing', { token: t })
          : api('/email-log', { token: t }),
        ),
      ])
      setData((d) => {
        const next = { ...d, overview }
        wants.forEach((w, i) => { next[w] = rest[i] })
        return next
      })
      setUpdatedAt(new Date().toISOString())
    } catch (e) {
      if (e.status === 401) return signOut()
      setError(e.message)
    } finally {
      if (!quiet) setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userQuery, userType])

  useEffect(() => {
    if (token && step === 'dashboard') load(tab, token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab])

  // Always up to date: refresh the active tab every 60s (quietly).
  useEffect(() => {
    if (!token || step !== 'dashboard') return undefined
    timerRef.current = setInterval(() => load(tab, token, { quiet: true }), REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [token, step, tab, load])

  const openUser = async (u) => {
    setSelectedUser({ id: u.id, summary: u, loading: true, detail: null })
    try {
      const detail = await api(`/users/${u.id}`, { token })
      setSelectedUser((s) => (s && s.id === u.id ? { ...s, loading: false, detail } : s))
    } catch (e) {
      setSelectedUser((s) => (s && s.id === u.id ? { ...s, loading: false, error: e.message } : s))
    }
  }

  const d = data.overview || {}
  const kpis = useMemo(() => {
    const { users = {}, waitlist = {}, clients = {}, apiUsage = {}, product = {} } = d
    return [
      ['Users', users.total, `${users.recruiters ?? '—'} recruiters · ${users.candidates ?? '—'} candidates`, 'Users'],
      ['New (7d)', users.new7, `${users.new30 ?? '—'} in 30d`, 'Activity'],
      ['Waitlist', waitlist.waitlistOnly, `${waitlist.demoRequests ?? 0} messages/demos`, 'Reach-outs'],
      ['Clients (paid)', clients.total, Object.entries(clients.byPlan || {}).map(([p, n]) => `${p}: ${n}`).join(' · ') || 'none yet', 'Overview'],
      ['API calls (30d)', apiUsage.calls30d, `${apiUsage.activeKeys ?? 0} active keys`, 'Overview'],
      ['Screens', product.screens, `${product.screens14 ?? 0} in 14d`, 'Activity'],
      ['Submissions', product.submissions, `${product.scored ?? 0} scored`, 'Activity'],
      ['Pending requests', d.users?.pendingRecruiters, 'recruiter access', 'Reach-outs'],
    ]
  }, [d])

  /* ------------------------------------------------------------- gate --- */
  if (step !== 'dashboard') {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas bg-grain px-4">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white/80 p-8 shadow-card">
          <h1 className="font-serif text-2xl font-semibold text-ink">Admin access</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            A one-time verification code is sent to the owner's email. It expires in 10 minutes.
          </p>
          {error ? <p className="mt-4 rounded-xl border border-clay-200 bg-clay-50 px-3 py-2 text-sm text-clay-700">{error}</p> : null}
          {step === 'request' ? (
            <button onClick={requestCode} disabled={busy} className="btn-primary mt-6 w-full disabled:opacity-60">
              {busy ? 'Sending…' : 'Send verification code'}
            </button>
          ) : (
            <form onSubmit={verify} className="mt-6 space-y-3">
              <input
                autoFocus
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-ink outline-none focus:border-clay-500"
                aria-label="Verification code"
              />
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full disabled:opacity-60">
                {busy ? 'Checking…' : 'Enter'}
              </button>
              <button type="button" onClick={requestCode} disabled={busy} className="btn-quiet w-full">
                Resend code
              </button>
            </form>
          )}
        </div>
      </main>
    )
  }

  /* -------------------------------------------------------- dashboard --- */
  return (
    <main className="min-h-screen bg-canvas bg-grain pb-16">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <div>
            <h1 className="font-serif text-xl font-semibold text-ink">Touchstones — Admin</h1>
            <p className="text-xs text-stone-500">
              Updated {fmtAgo(updatedAt)} · auto-refreshes every 60s · shared DB (incl. production signups)
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => load(tab, token)} disabled={busy} className="btn-quiet">{busy ? 'Refreshing…' : 'Refresh'}</button>
            <button onClick={signOut} className="btn-quiet">Lock</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 pb-2" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelectedUser(null) }}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? 'bg-clay-600 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
              aria-current={tab === t ? 'page' : undefined}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-5 pt-6">
        {error ? <p className="rounded-xl border border-clay-200 bg-clay-50 px-3 py-2 text-sm text-clay-700">{error}</p> : null}

        {/* KPI header — every card is a shortcut into its tab. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map(([label, value, hint, target]) => (
            <Kpi key={label} label={label} value={value} hint={hint} onClick={() => setTab(target)} />
          ))}
        </div>

        {tab === 'Overview' && (
          <>
            <Section title="Clients (paid plans)" hint="Profiles with a non-free subscription">
              <Table
                empty="No paying clients yet — the $99 design-partner cohort changes this."
                cols={[
                  { key: 'email', label: 'Email' },
                  { key: 'company', label: 'Company' },
                  { key: 'subscription_plan', label: 'Plan' },
                  { key: 'subscription_status', label: 'Status', render: (r) => <StatusPill value={r.subscription_status} /> },
                  { key: 'current_period_end', label: 'Renews', render: (r) => fmtDate(r.current_period_end) },
                ]}
                rows={d.clients?.clients}
              />
            </Section>
            <Section title="API usage (Verify API)" hint={`${d.apiUsage?.calls30d ?? 0} calls in 30d · ${d.apiUsage?.activeKeys ?? 0} active keys`}>
              <div className="grid gap-4 md:grid-cols-2">
                <Table empty="No API calls in 30d." cols={[{ key: 'day', label: 'Day' }, { key: 'count', label: 'Calls' }]}
                  rows={Object.entries(d.apiUsage?.byDay || {}).map(([day, count]) => ({ day, count }))} />
                <Table empty="—" cols={[{ key: 'endpoint', label: 'Endpoint' }, { key: 'count', label: 'Calls' }]}
                  rows={Object.entries(d.apiUsage?.byEndpoint || {}).map(([endpoint, count]) => ({ endpoint, count }))} />
              </div>
            </Section>
            <Section title="Everything else" hint="Client-side analytics + infra — one click each">
              <ul className="grid gap-2 md:grid-cols-2">
                {LINKS.map(([label, href]) => (
                  <li key={href}><a href={href} target="_blank" rel="noreferrer" className="text-sm font-medium text-clay-700 underline">{label} ↗</a></li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {tab === 'Users' && !selectedUser && (
          <Section
            title={`Users (${data.users?.total ?? '…'})`}
            hint="Click any row for the full picture — signup, last sign-in, screens, submissions, keys"
            right={
              <div className="flex gap-2">
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && load('Users', token)}
                  placeholder="Search email / name / company"
                  className="w-56 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-clay-500"
                />
                <select
                  value={userType}
                  onChange={(e) => { setUserType(e.target.value) }}
                  className="rounded-xl border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none"
                >
                  <option value="">All types</option>
                  <option value="recruiter">Recruiters</option>
                  <option value="candidate">Candidates</option>
                </select>
                <button onClick={() => load('Users', token)} className="btn-quiet text-sm">Apply</button>
              </div>
            }
          >
            <Table
              empty="No users match."
              onRowClick={openUser}
              cols={[
                { key: 'email', label: 'Email' },
                { key: 'name', label: 'Name' },
                { key: 'company', label: 'Company' },
                { key: 'account_type', label: 'Type' },
                { key: 'recruiter_status', label: 'Recruiter', render: (r) => (r.recruiter_status ? <StatusPill value={r.recruiter_status} /> : '—') },
                { key: 'created_at', label: 'Signed up', render: (r) => fmtDate(r.created_at) },
                { key: 'last_sign_in_at', label: 'Last sign-in', render: (r) => fmtAgo(r.last_sign_in_at) },
                { key: 'screens', label: 'Screens' },
                { key: 'submissions', label: 'Subs', render: (r) => `${r.submissions}${r.scored ? ` (${r.scored} scored)` : ''}` },
              ]}
              rows={data.users?.users}
            />
          </Section>
        )}

        {tab === 'Users' && selectedUser && (
          <Section
            title={selectedUser.summary?.email || 'User'}
            hint={selectedUser.summary?.name || ''}
            right={<button onClick={() => setSelectedUser(null)} className="btn-quiet text-sm">← All users</button>}
          >
            {selectedUser.loading ? (
              <p className="px-1 py-3 text-sm text-stone-400">Loading…</p>
            ) : selectedUser.error ? (
              <p className="px-1 py-3 text-sm text-clay-700">{selectedUser.error}</p>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
                  {[
                    ['Email', selectedUser.detail?.profile?.email],
                    ['Name', [selectedUser.detail?.profile?.first_name, selectedUser.detail?.profile?.last_name].filter(Boolean).join(' ') || '—'],
                    ['Company', selectedUser.detail?.profile?.company || '—'],
                    ['Type', selectedUser.detail?.profile?.account_type],
                    ['Recruiter status', selectedUser.detail?.profile?.recruiter_status || '—'],
                    ['Plan', `${selectedUser.detail?.profile?.subscription_plan || 'free'} (${selectedUser.detail?.profile?.subscription_status || 'n/a'})`],
                    ['Signed up', fmtDate(selectedUser.detail?.profile?.created_at)],
                    ['Last sign-in', `${fmtDate(selectedUser.detail?.auth?.last_sign_in_at)} (${fmtAgo(selectedUser.detail?.auth?.last_sign_in_at)})`],
                    ['Email confirmed', String(selectedUser.detail?.auth?.confirmed ?? '—')],
                    ['Sign-in providers', (selectedUser.detail?.auth?.providers || []).join(', ') || 'email'],
                    ['Profile id', selectedUser.id],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-stone-100 py-1.5">
                      <span className="text-stone-500">{k}</span>
                      <span className="text-right font-medium text-ink">{String(v ?? '—')}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Screens they own ({(selectedUser.detail?.screens || []).length})</p>
                  <Table empty="None." cols={[
                    { key: 'title', label: 'Title' },
                    { key: 'role_family', label: 'Role' },
                    { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
                    { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) },
                  ]} rows={selectedUser.detail?.screens} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Their submissions ({(selectedUser.detail?.submissions || []).length})</p>
                  <Table empty="None." cols={[
                    { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
                    { key: 'created_at', label: 'Started', render: (r) => fmtDate(r.created_at) },
                    { key: 'submitted_at', label: 'Submitted', render: (r) => fmtDate(r.submitted_at) },
                  ]} rows={selectedUser.detail?.submissions} />
                </div>
                {(selectedUser.detail?.apiKeys || []).length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">API keys</p>
                    <Table empty="None." cols={[
                      { key: 'name', label: 'Name' },
                      { key: 'prefix', label: 'Prefix' },
                      { key: 'mode', label: 'Mode' },
                      { key: 'last_used_at', label: 'Last used', render: (r) => fmtAgo(r.last_used_at) },
                      { key: 'revoked_at', label: 'Revoked', render: (r) => (r.revoked_at ? fmtDate(r.revoked_at) : '—') },
                    ]} rows={selectedUser.detail?.apiKeys} />
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {tab === 'Reach-outs' && (
          <>
            <Section title="Messages & demo requests" hint="From /contact and the demo forms — you also get each of these by email">
              <Table
                empty="No messages yet."
                cols={[
                  { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at) },
                  { key: 'name', label: 'Name' },
                  { key: 'email', label: 'Email' },
                  { key: 'company', label: 'Company' },
                  { key: 'message', label: 'Message', render: (r) => <span className="line-clamp-3 max-w-md whitespace-pre-wrap">{r.message || '—'}</span> },
                ]}
                rows={d.reachouts?.demoRequests}
              />
            </Section>
            <Section title="Waitlist" hint={`${d.waitlist?.total ?? 0} total (incl. newsletter signups tagged resources-newsletter)`}>
              <Table
                empty="No waitlist signups yet."
                cols={[
                  { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at) },
                  { key: 'email', label: 'Email' },
                  { key: 'name', label: 'Name' },
                  { key: 'company', label: 'Company' },
                  { key: 'kind', label: 'Kind' },
                  { key: 'referral_source', label: 'Source' },
                ]}
                rows={d.waitlist?.recent}
              />
            </Section>
            <Section title="Pending recruiter requests" hint="Awaiting approval (auto-approve handles these on dev)">
              <Table
                empty="No pending requests."
                cols={[
                  { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at) },
                  { key: 'email', label: 'Email' },
                  { key: 'first_name', label: 'Name', render: (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || '—' },
                  { key: 'company', label: 'Company' },
                ]}
                rows={d.reachouts?.pendingRecruiterRequests}
              />
            </Section>
          </>
        )}

        {tab === 'Activity' && (
          <Section title="Activity (last 30 days)" hint="Everything that happened, newest first — signups, screens, submissions, messages, keys">
            <Table
              empty="Quiet — nothing in the window."
              cols={[
                { key: 'ts', label: 'When', render: (r) => `${fmtDate(r.ts)} · ${fmtAgo(r.ts)}` },
                { key: 'type', label: 'Type', render: (r) => <StatusPill value={r.type} /> },
                { key: 'label', label: 'What happened' },
              ]}
              rows={data.activity?.events}
            />
          </Section>
        )}

        {tab === 'Marketing' && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Signups (30d)" value={Object.values(data.marketing?.perDay || {}).reduce((a, b) => a + b, 0)} hint={`all-time ${data.marketing?.totalAllTime ?? '—'}`} />
              <Kpi label="Messages/demos (30d)" value={data.marketing?.byKind?.demo ?? 0} />
              <Kpi label="Welcomed" value={data.marketing?.welcomed} hint="auto-reply sent" />
              <Kpi label="Nurtured" value={data.marketing?.nurtured} hint="48h follow-up sent" />
            </div>
            <Section title="Where signups come from (30d)" hint="referral_source on each waitlist/demo/newsletter row">
              <div className="grid gap-4 md:grid-cols-2">
                <Table empty="No signups in 30d." cols={[{ key: 'source', label: 'Source' }, { key: 'count', label: 'Signups' }]}
                  rows={Object.entries(data.marketing?.bySource || {}).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }))} />
                <Table empty="—" cols={[{ key: 'day', label: 'Day' }, { key: 'count', label: 'Signups' }]}
                  rows={Object.entries(data.marketing?.perDay || {}).sort((a, b) => b[0].localeCompare(a[0])).map(([day, count]) => ({ day, count }))} />
              </div>
            </Section>
            <Section title="Campaign surfaces" hint="Owner-run — drafts live in docs/gtm/">
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
                <li>Wave-1 outreach drafts: <code className="text-xs">docs/gtm/wave1-drafts-2026-07-01.md</code> (30 verified leads, ready to send from your address)</li>
                <li>LinkedIn posts + investor pre-note: <code className="text-xs">docs/gtm/content/</code></li>
                <li>Visitor analytics: Amplitude (app) + Google Analytics (marketing) — links on the Overview tab</li>
              </ul>
            </Section>
          </>
        )}

        {tab === 'Email log' && (
          <Section
            title="Recent emails (from Resend — source of truth)"
            hint={Object.entries(data.emailLog?.statusCounts || {}).map(([s, n]) => `${s}: ${n}`).join(' · ') || 'last 25 sends'}
          >
            <Table
              empty={data.emailLog?.note || 'No emails yet.'}
              cols={[
                { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at) },
                { key: 'to', label: 'To' },
                { key: 'subject', label: 'Subject' },
                { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
              ]}
              rows={data.emailLog?.emails}
            />
          </Section>
        )}
      </div>
    </main>
  )
}
