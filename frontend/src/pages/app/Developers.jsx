import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pill } from '../../components/primitives.jsx'
import Reveal from '../../components/Reveal.jsx'
import { api } from '../../services/api.js'
import {
  Code, Plus, X, Check, Clock, ShieldCheck, ArrowUpRight, Bolt, FileText, Eye, Lock,
} from '../../components/icons.jsx'

const input =
  'w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100'
const mono = 'font-mono text-[13px]'

function timeAgo(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

// Small copy-to-clipboard control with transient "Copied" feedback.
function CopyButton({ text, className = '', label = 'Copy' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch { /* clipboard blocked — no-op */ }
      }}
      className={`btn-quiet shrink-0 px-2.5 py-1 text-xs ${done ? 'text-clay-700' : 'text-stone-500'} ${className}`}
    >
      {done ? (<><Check size={13} /> Copied</>) : label}
    </button>
  )
}

// A reveal-on-demand secret field (masked until the eye is clicked) with a copy button.
function SecretField({ value }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg bg-stone-100 px-2.5 py-1.5 ring-1 ring-stone-200">
      <code className={`${mono} min-w-0 flex-1 truncate text-stone-700`}>
        {shown ? value : `${value.slice(0, 9)}${'•'.repeat(18)}`}
      </code>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="shrink-0 text-stone-400 hover:text-ink"
        aria-label={shown ? 'Hide' : 'Reveal'}
        title={shown ? 'Hide' : 'Reveal'}
      >
        {shown ? <Lock size={14} /> : <Eye size={14} />}
      </button>
      <CopyButton text={value} />
    </div>
  )
}

const TABS = [
  { key: 'keys', label: 'API keys', Icon: Code },
  { key: 'webhooks', label: 'Webhooks', Icon: Bolt },
  { key: 'ashby', label: 'Ashby', Icon: ArrowUpRight },
  { key: 'greenhouse', label: 'Greenhouse', Icon: ArrowUpRight },
  { key: 'usage', label: 'Usage', Icon: ArrowUpRight },
  { key: 'logs', label: 'Logs', Icon: FileText },
]

// Ashby Assessments integration — capture the customer's OUTBOUND Ashby API key (needs the
// candidatesWrite permission). Stored encrypted at rest; the server never returns it (we only
// show "configured" + last 4). Inbound auth (Ashby → us) uses a Touchstones API key from the
// "API keys" tab, pasted into the Ashby marketplace tile.
function AshbyTab() {
  const [settings, setSettings] = useState(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(() => {
    setError(null)
    return api.getAshbySettings().then(setSettings).catch((e) => setError(e.message || 'Could not load Ashby settings.'))
  }, [])
  useEffect(() => { load() }, [load])

  async function save(e) {
    e?.preventDefault()
    setError(null); setNotice(null)
    if (!key.trim()) { setError('Paste your Ashby API key.'); return }
    setBusy(true)
    try {
      const r = await api.setAshbyKey(key.trim())
      setSettings(r); setKey(''); setNotice('Ashby API key saved (encrypted).')
    } catch (err) { setError(err.message || 'Could not save the key.') } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true); setError(null); setNotice(null)
    try { setSettings(await api.clearAshbyKey()); setNotice('Ashby API key removed.') }
    catch (err) { setError(err.message || 'Could not remove the key.') } finally { setBusy(false) }
  }

  const inputCls = 'w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100'

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="font-serif text-base font-semibold text-ink">Ashby Assessments</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
          Outbound key — Touchstones uses this to push scores, proof-of-human and the result link back
          onto the candidate in Ashby (<code>assessment.update</code>). It needs the{' '}
          <code>candidatesWrite</code> permission. Stored encrypted; we never show it again.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Inbound (Ashby → Touchstones) uses a Touchstones API key from the <strong>API keys</strong> tab —
          paste that into the Ashby marketplace tile.
        </p>

        {settings?.configured ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-clay-800">
              <Check size={15} /> Connected · key ending ••••{settings.last4}
            </span>
            <button onClick={remove} disabled={busy} className="btn-quiet px-2.5 py-1 text-xs text-stone-500 hover:text-flag-700 disabled:opacity-50">
              Remove
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-500">No Ashby key configured yet.</p>
        )}

        <form onSubmit={save} className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <input
            type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={settings?.configured ? 'Replace the Ashby API key…' : 'Paste your Ashby API key'}
            className={inputCls} disabled={busy}
          />
          <button type="submit" disabled={busy || !key.trim()} className="btn-primary shrink-0 disabled:opacity-50">
            {busy ? 'Saving…' : settings?.configured ? 'Replace key' : 'Save key'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-flag-700">{error}</p>}
        {notice && <p className="mt-2 text-sm text-clay-700">{notice}</p>}
      </div>
    </div>
  )
}

// Greenhouse Assessments integration (flag-gated server-side; the tab explains itself when the
// backend 404s). Two halves:
//   1. The org Assessment API key we MINT for the customer to hand to Greenhouse (inbound auth +
//      our completion PATCH). Raw key shown exactly once.
//   2. "Connect with Greenhouse" - Harvest v3 Partner OAuth for the score note write-back.
function GreenhouseTab() {
  const [keySettings, setKeySettings] = useState(null)
  const [mintedKey, setMintedKey] = useState(null)
  const [oauth, setOauth] = useState(null)
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [k, o] = await Promise.all([api.getGreenhouseAssessmentKey(), api.getGreenhouseOAuthStatus()])
      setKeySettings(k)
      setOauth(o)
      setEnabled(true)
    } catch (e) {
      if (e.status === 404) setEnabled(false)
      else setError(e.message || 'Could not load Greenhouse settings.')
    }
  }, [])
  useEffect(() => { load() }, [load])

  // The OAuth callback redirects back here with ?greenhouse=connected|error.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('greenhouse')
    if (outcome === 'connected') setNotice('Greenhouse connected.')
    if (outcome === 'error') setError('Greenhouse connection failed. Please try again.')
  }, [])

  async function mintKey() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await api.mintGreenhouseAssessmentKey()
      setMintedKey(r.key)
      setKeySettings({ configured: r.configured, last4: r.last4 })
      setNotice('Key created. Copy it now: it is shown only once.')
    } catch (e) { setError(e.message || 'Could not create the key.') } finally { setBusy(false) }
  }
  async function removeKey() {
    setBusy(true); setError(null); setNotice(null)
    try {
      setKeySettings(await api.clearGreenhouseAssessmentKey())
      setMintedKey(null)
      setNotice('Greenhouse key revoked.')
    } catch (e) { setError(e.message || 'Could not revoke the key.') } finally { setBusy(false) }
  }
  async function connect() {
    setBusy(true); setError(null)
    try {
      const { url } = await api.startGreenhouseOAuth()
      window.location = url
    } catch (e) { setError(e.message || 'Could not start the Greenhouse connection.'); setBusy(false) }
  }
  async function disconnect() {
    setBusy(true); setError(null); setNotice(null)
    try {
      setOauth(await api.disconnectGreenhouseOAuth())
      setNotice('Disconnected. Also remove the integration in Greenhouse under Configure, Dev Center, Connected Integrations.')
    } catch (e) { setError(e.message || 'Could not disconnect.') } finally { setBusy(false) }
  }

  if (!enabled) {
    return (
      <div className="card p-5">
        <h3 className="font-serif text-base font-semibold text-ink">Greenhouse Assessments</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
          The Greenhouse integration is not enabled on this deployment yet. It ships once our
          Greenhouse partner review completes.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="font-serif text-base font-semibold text-ink">Assessment API key</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
          Greenhouse authenticates to Touchstones with this org key, and Touchstones uses the same
          key to confirm completed tests back to Greenhouse. Create it here, then give it to your
          Greenhouse contact to enable the Touchstones take-home test stage.
        </p>

        {mintedKey ? (
          <div className="mt-4 space-y-2">
            <SecretField value={mintedKey} />
            <p className="text-xs text-stone-500">
              This is the only time the full key is shown. Store it somewhere safe and hand it to
              Greenhouse; you can rotate it here at any time.
            </p>
          </div>
        ) : keySettings?.configured ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-clay-800">
              <Check size={15} /> Key active · ending ••••{keySettings.last4}
            </span>
            <button onClick={removeKey} disabled={busy} className="btn-quiet px-2.5 py-1 text-xs text-stone-500 hover:text-flag-700 disabled:opacity-50">
              Revoke
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-500">No Greenhouse key yet.</p>
        )}

        <button onClick={mintKey} disabled={busy} className="btn-primary mt-4 disabled:opacity-50">
          {busy ? 'Working…' : keySettings?.configured ? 'Rotate key' : 'Create key'}
        </button>
      </div>

      <div className="card p-5">
        <h3 className="font-serif text-base font-semibold text-ink">Connect with Greenhouse</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
          Connecting lets Touchstones attach the score summary and report link to the candidate in
          Greenhouse. A Site Admin should connect and pick the <strong>service account</strong>{' '}
          option on the Greenhouse consent screen so the connection survives team changes.
        </p>

        {oauth?.connected ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-clay-200 bg-clay-50 px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-clay-800">
              <Check size={15} /> Connected{oauth.last_refreshed_at ? ` · refreshed ${timeAgo(oauth.last_refreshed_at)}` : ''}
            </span>
            <button onClick={disconnect} disabled={busy} className="btn-quiet px-2.5 py-1 text-xs text-stone-500 hover:text-flag-700 disabled:opacity-50">
              Disconnect
            </button>
          </div>
        ) : oauth?.status === 'needs_reauth' ? (
          <div className="mt-4 rounded-xl border border-flag-200 bg-flag-50 px-4 py-3 text-sm text-flag-800">
            The connection expired. Reconnect to resume score write-back.
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-500">Not connected yet.</p>
        )}

        {!oauth?.connected && (
          <button onClick={connect} disabled={busy} className="btn-primary mt-4 disabled:opacity-50">
            {busy ? 'Redirecting…' : oauth?.status === 'needs_reauth' ? 'Reconnect Greenhouse' : 'Connect with Greenhouse'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-flag-700">{error}</p>}
      {notice && <p className="text-sm text-clay-700">{notice}</p>}
    </div>
  )
}

export default function Developers() {
  // The Greenhouse OAuth callback redirects back with ?greenhouse=connected|error; open the
  // Greenhouse tab on arrival so GreenhouseTab (which reads that param) actually mounts and can
  // surface the outcome. Without this the user lands on the default keys tab and sees nothing.
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).has('greenhouse') ? 'greenhouse' : 'keys')
  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">Developers</h1>
            <p className="mt-1 text-sm text-stone-600">
              Embed Touchstones verification into your own platform with the Verify API.
            </p>
          </div>
          <Link to="/docs/api" className="btn-quiet" target="_blank" rel="noreferrer">
            <FileText size={16} /> API docs & sandbox
          </Link>
        </div>
      </Reveal>

      {/* Tab bar */}
      <Reveal delay={50}>
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-stone-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-clay-500 text-clay-700'
                  : 'border-transparent text-stone-500 hover:text-ink'
              }`}
            >
              <t.Icon size={15} /> {t.label}
            </button>
          ))}
        </div>
      </Reveal>

      <div className="mt-6">
        {tab === 'keys' && <KeysTab />}
        {tab === 'webhooks' && <WebhooksTab />}
        {tab === 'ashby' && <AshbyTab />}
        {tab === 'greenhouse' && <GreenhouseTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'logs' && <LogsTab />}
      </div>
    </div>
  )
}

// ── API keys ──────────────────────────────────────────────────────────────────────────
function KeysTab() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState('test')
  const [creating, setCreating] = useState(false)
  const [freshKey, setFreshKey] = useState(null) // full plaintext shown ONCE
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return api.listApiKeys()
      .then((res) => setKeys(Array.isArray(res?.api_keys) ? res.api_keys : []))
      .catch((e) => setError(e.message || 'Could not load your API keys.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  async function create(e) {
    e?.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await api.createApiKey(name.trim() || null, mode)
      setFreshKey({ key: res.key, mode })
      setName('')
      await load()
    } catch (err) {
      setError(err.message || 'Could not create the key.')
    } finally {
      setCreating(false)
    }
  }

  async function rotate(k) {
    if (!window.confirm('Rotate this key? The current key stops working immediately.')) return
    setBusyId(k.id)
    try {
      const res = await api.rotateApiKey(k.id)
      setFreshKey({ key: res.key, mode: k.mode })
      await load()
    } catch (err) { setError(err.message || 'Could not rotate the key.') }
    finally { setBusyId(null) }
  }

  async function revoke(k) {
    if (!window.confirm('Revoke this key? Calls using it will start failing immediately.')) return
    setBusyId(k.id)
    try { await api.deleteApiKey(k.id); await load() }
    catch (err) { setError(err.message || 'Could not revoke the key.') }
    finally { setBusyId(null) }
  }

  const active = keys.filter((k) => !k.revoked_at)
  const revoked = keys.filter((k) => k.revoked_at)

  return (
    <div className="space-y-6">
      {/* Fresh-key reveal banner (shown once) */}
      {freshKey && (
        <div className="rounded-2xl border border-clay-200 bg-clay-50 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-clay-600 ring-1 ring-clay-200">
              <ShieldCheck size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Your new {freshKey.mode} key</p>
              <p className="mt-0.5 text-sm text-stone-600">
                Copy it now — for your security, we never show the full key again.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-clay-200">
                <code className={`${mono} min-w-0 flex-1 truncate text-ink`}>{freshKey.key}</code>
                <CopyButton text={freshKey.key} />
              </div>
            </div>
            <button onClick={() => setFreshKey(null)} className="shrink-0 text-stone-400 hover:text-ink" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={create} className="card p-5">
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Create a key</label>
        <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. Production server)"
            className={`${input} flex-1`}
            disabled={creating}
          />
          <div className="flex shrink-0 rounded-xl border border-stone-200 bg-paper p-0.5">
            {['test', 'live'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium capitalize transition-colors ${
                  mode === m ? 'bg-white text-ink shadow-sm ring-1 ring-stone-200' : 'text-stone-500'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button type="submit" disabled={creating} className="btn-primary shrink-0 disabled:opacity-50">
            <Plus size={16} /> {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          <strong className="font-semibold text-stone-600">test</strong> keys hit the sandbox (no live decisions);{' '}
          <strong className="font-semibold text-stone-600">live</strong> keys run real verifications.
        </p>
      </form>

      {error && (
        <div className="rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">
          {error} <button onClick={load} className="font-semibold underline underline-offset-2">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-200/50" />)}</div>
      ) : active.length === 0 && !error ? (
        <EmptyState Icon={Code} title="No API keys yet" hint="Create a test key above to start calling the Verify API." />
      ) : (
        <ul className="space-y-2.5">
          {active.map((k) => (
            <li key={k.id} className="card flex items-center gap-4 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-500 ring-1 ring-stone-200">
                <Code size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-ink">{k.name || 'Untitled key'}</p>
                  <Pill tone={k.mode === 'live' ? 'clay' : 'neutral'} className="shrink-0 capitalize">{k.mode}</Pill>
                </div>
                <code className={`${mono} mt-0.5 block truncate text-stone-500`}>{k.masked_key}</code>
                <p className="mt-0.5 text-xs text-stone-400">
                  Created {timeAgo(k.created_at)}{k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : ' · never used'}
                </p>
              </div>
              <button onClick={() => rotate(k)} disabled={busyId === k.id} className="btn-quiet shrink-0 px-2.5 py-1 text-xs disabled:opacity-50">Rotate</button>
              <button
                onClick={() => revoke(k)}
                disabled={busyId === k.id}
                className="btn-quiet shrink-0 px-2 text-stone-400 hover:text-flag-700 disabled:opacity-50"
                aria-label="Revoke key"
                title="Revoke key"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 && (
        <details className="text-sm text-stone-500">
          <summary className="cursor-pointer select-none font-medium hover:text-ink">{revoked.length} revoked key{revoked.length > 1 ? 's' : ''}</summary>
          <ul className="mt-2 space-y-1.5">
            {revoked.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-1 text-xs text-stone-400">
                <code className={mono}>{k.masked_key}</code>
                <span>· revoked {timeAgo(k.revoked_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ── Webhooks ──────────────────────────────────────────────────────────────────────────
function WebhooksTab() {
  const [endpoints, setEndpoints] = useState([])
  const [validEvents, setValidEvents] = useState([])
  const [deliveries, setDeliveries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState([])
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [testResult, setTestResult] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return Promise.all([api.listWebhookEndpoints(), api.getWebhookDeliveries(25)])
      .then(([eps, dels]) => {
        setEndpoints(Array.isArray(eps?.webhook_endpoints) ? eps.webhook_endpoints : [])
        const valid = Array.isArray(eps?.valid_events) ? eps.valid_events : []
        setValidEvents(valid)
        setEvents((prev) => (prev.length ? prev : valid))
        setDeliveries(Array.isArray(dels?.deliveries) ? dels.deliveries : [])
      })
      .catch((e) => setError(e.message || 'Could not load webhooks.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  function toggleEvent(ev) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]))
  }

  async function create(e) {
    e?.preventDefault()
    setCreating(true)
    setError(null)
    try {
      await api.createWebhookEndpoint({ url: url.trim(), enabled_events: events })
      setUrl('')
      await load()
    } catch (err) { setError(err.message || 'Could not create the endpoint.') }
    finally { setCreating(false) }
  }

  async function runAction(id, fn, msg) {
    setBusyId(id)
    setError(null)
    setTestResult(null)
    try { const r = await fn(); if (msg) setTestResult({ id, ...msg(r) }); await load() }
    catch (err) { setError(err.message || 'Action failed.') }
    finally { setBusyId(null) }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="card p-5">
        <label className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Add an endpoint</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.yourapp.com/webhooks/touchstones"
          className={`${input} mt-2`}
          disabled={creating}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {validEvents.map((ev) => (
            <button
              key={ev}
              type="button"
              onClick={() => toggleEvent(ev)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                events.includes(ev)
                  ? 'border-clay-200 bg-clay-50 text-clay-700'
                  : 'border-stone-200 bg-paper text-stone-500 hover:text-ink'
              }`}
            >
              {events.includes(ev) ? '✓ ' : ''}{ev}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={creating || !url.trim() || !events.length} className="btn-primary disabled:opacity-50">
            <Plus size={16} /> {creating ? 'Adding…' : 'Add endpoint'}
          </button>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          Each delivery is signed: <code className={mono}>Touchstones-Signature: t=&lt;ts&gt;,v1=&lt;hmac&gt;</code> over <code className={mono}>{'`${t}.${body}`'}</code>.
        </p>
      </form>

      {error && (
        <div className="rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">{error} <button onClick={load} className="font-semibold underline underline-offset-2">Retry</button></div>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-xl bg-stone-200/50" />
      ) : endpoints.length === 0 ? (
        <EmptyState Icon={Bolt} title="No webhook endpoints" hint="Add an HTTPS endpoint to receive verification.completed events." />
      ) : (
        <ul className="space-y-3">
          {endpoints.map((ep) => (
            <li key={ep.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${ep.status === 'active' ? 'bg-clay-50 text-clay-600 ring-clay-200' : 'bg-stone-100 text-stone-400 ring-stone-200'}`}>
                  <Bolt size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className={`${mono} min-w-0 truncate text-ink`}>{ep.url}</code>
                    <Pill tone={ep.status === 'active' ? 'clay' : 'neutral'} className="shrink-0 capitalize">{ep.status}</Pill>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ep.enabled_events.map((ev) => (
                      <span key={ev} className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500">{ev}</span>
                    ))}
                  </div>
                  <div className="mt-2 max-w-md">
                    <SecretField value={ep.signing_secret} />
                  </div>
                  {ep.last_delivery_at && <p className="mt-1.5 text-xs text-stone-400">Last delivery {timeAgo(ep.last_delivery_at)}</p>}
                  {testResult?.id === ep.id && (
                    <p className={`mt-1.5 text-xs ${testResult.ok ? 'text-clay-700' : 'text-flag-700'}`}>{testResult.text}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                <button onClick={() => runAction(ep.id, () => api.testWebhookEndpoint(ep.id), (r) => ({ ok: r?.test?.ok, text: r?.test?.ok ? `Test delivered (HTTP ${r.test.response_status ?? '2xx'}).` : `Test failed: ${r?.test?.error || 'no 2xx'}.` }))} disabled={busyId === ep.id} className="btn-quiet px-2.5 py-1 text-xs disabled:opacity-50">Send test</button>
                <button onClick={() => runAction(ep.id, () => api.updateWebhookEndpoint(ep.id, { status: ep.status === 'active' ? 'disabled' : 'active' }))} disabled={busyId === ep.id} className="btn-quiet px-2.5 py-1 text-xs disabled:opacity-50">{ep.status === 'active' ? 'Disable' : 'Enable'}</button>
                <button onClick={() => { if (window.confirm('Rotate the signing secret? Update your receiver to the new secret.')) runAction(ep.id, () => api.rotateWebhookSecret(ep.id)) }} disabled={busyId === ep.id} className="btn-quiet px-2.5 py-1 text-xs disabled:opacity-50">Rotate secret</button>
                <button onClick={() => { if (window.confirm('Delete this endpoint?')) runAction(ep.id, () => api.deleteWebhookEndpoint(ep.id)) }} disabled={busyId === ep.id} className="btn-quiet px-2.5 py-1 text-xs text-stone-400 hover:text-flag-700 disabled:opacity-50">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Recent deliveries */}
      {deliveries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Recent deliveries</h3>
          <div className="card mt-2 divide-y divide-stone-100 overflow-hidden">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <DeliveryDot status={d.status} />
                <code className={`${mono} shrink-0 text-stone-600`}>{d.event_type}</code>
                <span className="min-w-0 flex-1 truncate text-xs text-stone-400">
                  {d.response_status ? `HTTP ${d.response_status}` : (d.error || '—')}{d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}
                </span>
                <span className="shrink-0 text-xs text-stone-400">{timeAgo(d.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DeliveryDot({ status }) {
  const tone = status === 'success' ? 'bg-clay-500' : status === 'failed' ? 'bg-flag-500' : 'bg-amber-400'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} title={status} />
}

// ── Usage ─────────────────────────────────────────────────────────────────────────────
function UsageTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getApiUsage(30)
      .then((res) => setData(res))
      .catch((e) => setError(e.message || 'Could not load usage.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  // Aggregate per-day totals across endpoints.
  const byDay = useMemo(() => {
    const rows = data?.usage || []
    const map = new Map()
    for (const r of rows) map.set(r.day, (map.get(r.day) || 0) + (r.count || 0))
    const days = [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    const peak = Math.max(1, ...days.map(([, c]) => c))
    return { days, peak }
  }, [data])

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-stone-200/50" />
  if (error) return <div className="rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">{error} <button onClick={load} className="font-semibold underline underline-offset-2">Retry</button></div>
  if (!data || (data.total ?? 0) === 0) return <EmptyState Icon={ArrowUpRight} title="No usage yet" hint="Verification calls will appear here, counted per day." />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard value={data.total} label={`calls · last ${data.days} days`} />
        <StatCard value={byDay.peak} label="busiest day" />
        <StatCard value={byDay.days.length} label="active days" />
      </div>
      <div className="card p-5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Daily verification calls</h3>
        <div className="mt-4 space-y-1.5">
          {byDay.days.map(([day, count]) => (
            <div key={day} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-stone-400">{day.slice(5)}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-stone-100">
                <div className="h-full rounded bg-clay-400" style={{ width: `${Math.max(4, (count / byDay.peak) * 100)}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-medium text-stone-600">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ value, label }) {
  return (
    <div className="card p-4">
      <div className="font-serif text-3xl font-semibold tracking-tight text-ink">{value}</div>
      <p className="mt-1 text-xs leading-snug text-stone-500">{label}</p>
    </div>
  )
}

// ── Logs (recent verifications) ─────────────────────────────────────────────────────────
const PROOF_TONE = { verified: 'clay', needs_review: 'amber', flagged: 'flag' }
const STATUS_TONE = { completed: 'clay', needs_review: 'amber', failed: 'flag', queued: 'neutral', processing: 'neutral' }

function LogsTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getApiVerifications(50)
      .then((res) => setRows(Array.isArray(res?.verifications) ? res.verifications : []))
      .catch((e) => setError(e.message || 'Could not load logs.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-stone-200/50" />)}</div>
  if (error) return <div className="rounded-xl bg-flag-50 px-3.5 py-2.5 text-sm text-flag-700 ring-1 ring-flag-100">{error} <button onClick={load} className="font-semibold underline underline-offset-2">Retry</button></div>
  if (!rows.length) return <EmptyState Icon={FileText} title="No verifications yet" hint="Verifications you create via POST /v1/verifications will appear here." />

  return (
    <div className="card divide-y divide-stone-100 overflow-hidden">
      {rows.map((v) => (
        <div key={v.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-ink">{v.candidate_ref || '—'}</p>
              <Pill tone={v.mode === 'live' ? 'clay' : 'neutral'} className="shrink-0 capitalize">{v.mode}</Pill>
            </div>
            <code className={`${mono} mt-0.5 block truncate text-[11px] text-stone-400`}>{v.id}</code>
          </div>
          {v.score != null && <span className="shrink-0 font-serif text-lg font-semibold text-ink">{v.score}</span>}
          {v.proof_state && <Pill tone={PROOF_TONE[v.proof_state] || 'neutral'} className="shrink-0">{v.proof_state.replace('_', ' ')}</Pill>}
          <Pill tone={STATUS_TONE[v.status] || 'neutral'} className="shrink-0">{v.status.replace('_', ' ')}</Pill>
          <span className="hidden shrink-0 text-xs text-stone-400 sm:block">{timeAgo(v.created_at)}</span>
        </div>
      ))}
    </div>
  )
}

// ── shared ────────────────────────────────────────────────────────────────────────────
function EmptyState({ Icon, title, hint }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-400">
        <Icon size={22} />
      </span>
      <p className="mt-4 font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">{hint}</p>
    </div>
  )
}
