import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import { Pill } from '../../components/primitives.jsx'
import { api } from '../../services/api.js'
import { ShieldCheck, Bolt, Play, Check, ArrowUpRight, Lock } from '../../components/icons.jsx'

const mono = 'font-mono text-[13px]'

// Minimal inline-markdown renderer for OpenAPI descriptions (which are markdown by spec):
// **bold** → <strong>, `code` → <code>. Splits on the two tokens, leaves the rest as text.
function Md({ children }) {
  const text = String(children || '')
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className={`${mono} rounded bg-stone-100 px-1 py-0.5 text-stone-700`}>{p.slice(1, -1)}</code>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

// Resolve a local JSON-Schema $ref (e.g. '#/components/schemas/Verification') against the spec.
function resolveRef(spec, node) {
  if (node && node.$ref && typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let o = spec
    for (const p of node.$ref.slice(2).split('/')) o = o && o[p]
    return o || {}
  }
  return node || {}
}

function typeLabel(schema) {
  if (!schema) return ''
  if (schema.$ref) return schema.$ref.split('/').pop()
  let t = schema.type
  if (Array.isArray(t)) t = t.filter((x) => x !== 'null').join(' | ') + (t.includes('null') ? '?' : '')
  if (t === 'array' && schema.items) return `${typeLabel(schema.items)}[]`
  if (schema.enum) return schema.enum.map((e) => `"${e}"`).join(' | ')
  return t || 'object'
}

// One level of a schema's properties (resolving a $ref first). Nested objects show their type only.
function SchemaTable({ spec, schema }) {
  const resolved = resolveRef(spec, schema)
  const props = resolved.properties || {}
  const required = new Set(resolved.required || [])
  const keys = Object.keys(props)
  if (!keys.length) {
    return <p className="text-sm text-stone-500">{typeLabel(resolved) || 'object'}</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200">
      {keys.map((k, i) => {
        const p = props[k]
        return (
          <div key={k} className={`flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:gap-4 ${i ? 'border-t border-stone-100' : ''}`}>
            <div className="flex w-56 shrink-0 items-baseline gap-2">
              <code className={`${mono} text-ink`}>{k}</code>
              {required.has(k) && <span className="text-[10px] font-semibold uppercase text-clay-600">req</span>}
            </div>
            <div className="min-w-0 flex-1">
              <code className={`${mono} text-stone-500`}>{typeLabel(p)}</code>
              {(p.description || resolveRef(spec, p).description) && (
                <p className="mt-0.5 text-sm text-stone-600">{p.description || resolveRef(spec, p).description}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const METHOD_TONE = { post: 'bg-clay-100 text-clay-700', get: 'bg-stone-200 text-stone-700' }

function Operation({ spec, path, method, op }) {
  const [open, setOpen] = useState(method === 'post') // expand the create endpoint by default
  const reqSchema = op.requestBody?.content?.['application/json']?.schema
  const params = op.parameters?.map((p) => resolveRef(spec, p)) || []
  const responses = op.responses || {}
  return (
    <div id={op.operationId} className="card overflow-hidden scroll-mt-24">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${METHOD_TONE[method] || 'bg-stone-200 text-stone-700'}`}>{method}</span>
        <code className={`${mono} text-ink`}>{path}</code>
        <span className="hidden flex-1 truncate text-sm text-stone-500 sm:block">{op.summary}</span>
        <span className="ml-auto text-stone-400 sm:ml-0">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-stone-100 px-4 py-4">
          {op.description && <p className="text-sm leading-relaxed text-stone-600"><Md>{op.description}</Md></p>}
          {params.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Parameters</h4>
              <div className="mt-2 space-y-1.5">
                {params.map((p) => (
                  <div key={p.name} className="flex items-baseline gap-2 text-sm">
                    <code className={`${mono} text-ink`}>{p.name}</code>
                    <span className="text-xs text-stone-400">{p.in}{p.required ? ' · required' : ''}</span>
                    {p.description && <span className="text-stone-600">— {p.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {reqSchema && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Request body</h4>
              <div className="mt-2"><SchemaTable spec={spec} schema={reqSchema} /></div>
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Responses</h4>
            <div className="mt-2 space-y-1.5">
              {Object.entries(responses).map(([code, r]) => {
                const rr = resolveRef(spec, r)
                return (
                  <div key={code} className="flex items-baseline gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${code.startsWith('2') ? 'bg-clay-50 text-clay-700' : 'bg-stone-100 text-stone-500'}`}>{code}</span>
                    <span className="text-stone-600">{rr.description}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SANDBOX_DEFAULT = JSON.stringify({
  candidate_ref: 'cand-001',
  rubric: { criteria: [{ id: 'correctness', requirement: 'Implements add(a, b) returning the sum', points_possible: 100, weight: 1 }] },
  work: { response_code: 'module.exports = (a, b) => a + b;' },
  events: [{ type: 'session_submit', category: 'behavior', meta: { typed_chars: 200, paste_chars: 5, final_chars: 205 }, client_ts: '2026-06-25T10:00:00.000Z' }],
}, null, 2)

function Sandbox() {
  const [key, setKey] = useState('')
  const [body, setBody] = useState(SANDBOX_DEFAULT)
  const [resp, setResp] = useState(null)
  const [status, setStatus] = useState(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)

  const curl = useMemo(() => {
    const k = key.trim() || 'tsk_test_•••'
    return `curl ${api.verifyBaseUrl}/verifications \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body.replace(/\n\s*/g, ' ')}'`
  }, [key, body])

  async function send() {
    setErr(null); setResp(null); setStatus(null)
    let parsed
    try { parsed = JSON.parse(body) } catch { setErr('Request body is not valid JSON.'); return }
    if (!key.trim().startsWith('tsk_')) { setErr('Enter a test key (tsk_test_…) from your developer console.'); return }
    setSending(true)
    try {
      const res = await fetch(`${api.verifyBaseUrl}/verifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
        body: JSON.stringify(parsed),
      })
      setStatus(res.status)
      const text = await res.text()
      try { setResp(JSON.stringify(JSON.parse(text), null, 2)) } catch { setResp(text) }
    } catch (e) {
      setErr(e.message || 'Request failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200"><Play size={15} /></span>
        <h3 className="font-serif text-xl font-semibold text-ink">Try it live</h3>
      </div>
      <p className="mt-1.5 text-sm text-stone-600">
        Paste a <strong className="font-semibold">test</strong> key and send a real request to the sandbox. Test keys never make live decisions.{' '}
        <Link to="/app/developers" className="font-semibold text-clay-700 hover:text-clay-800">Get a key →</Link>
      </p>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Test API key</label>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-stone-200 bg-paper px-3 py-2">
        <Lock size={14} className="text-stone-400" />
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="tsk_test_…"
          className={`${mono} w-full bg-transparent text-ink outline-none placeholder:text-stone-400`}
          autoComplete="off" spellCheck={false}
        />
      </div>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Request body</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        spellCheck={false}
        className={`${mono} mt-1.5 w-full rounded-xl border border-stone-200 bg-paper p-3 text-stone-700 outline-none focus:border-clay-400 focus:ring-2 focus:ring-clay-100`}
      />

      <div className="mt-3 flex items-center gap-3">
        <button onClick={send} disabled={sending} className="btn-primary disabled:opacity-50">
          <Play size={15} /> {sending ? 'Sending…' : 'POST /v1/verifications'}
        </button>
        {status != null && (
          <Pill tone={status >= 200 && status < 300 ? 'clay' : 'flag'}>
            {status >= 200 && status < 300 ? <Check size={12} /> : null} HTTP {status}
          </Pill>
        )}
      </div>
      {err && <p className="mt-2 text-sm text-flag-700">{err}</p>}

      {resp && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">Response</h4>
          <pre className={`${mono} mt-1.5 max-h-96 overflow-auto rounded-xl bg-ink/95 p-4 text-stone-100`}>{resp}</pre>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.12em] text-stone-400 hover:text-stone-600">cURL</summary>
        <pre className={`${mono} mt-2 overflow-auto rounded-xl bg-stone-100 p-3.5 text-stone-700`}>{curl}</pre>
      </details>
    </div>
  )
}

export default function DocsApi() {
  const [spec, setSpec] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    api.getOpenApiSpec()
      .then((s) => active && setSpec(s))
      .catch((e) => active && setError(e.message || 'Could not load the API spec.'))
    return () => { active = false }
  }, [])

  const operations = useMemo(() => {
    if (!spec) return []
    const out = []
    for (const [path, item] of Object.entries(spec.paths || {})) {
      for (const [method, op] of Object.entries(item)) {
        out.push({ path, method, op })
      }
    }
    return out
  }, [spec])

  return (
    <div className="min-h-screen bg-canvas">
      {/* Minimal top bar */}
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link to="/"><Logo /></Link>
          <div className="flex items-center gap-2">
            <Link to="/platforms" className="btn-quiet text-sm">For platforms</Link>
            <Link to="/app/developers" className="btn-primary text-sm">Dashboard <ArrowUpRight size={15} /></Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        {error && <div className="rounded-xl bg-flag-50 px-4 py-3 text-sm text-flag-700 ring-1 ring-flag-100">{error}</div>}
        {!spec && !error && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-stone-200/50" />)}</div>}

        {spec && (
          <div className="grid gap-10 lg:grid-cols-[1fr_minmax(380px,440px)]">
            {/* Left: reference */}
            <div className="min-w-0 space-y-8">
              <div>
                <Pill tone="clay"><ShieldCheck size={12} /> {spec.info.title} v{spec.info.version}</Pill>
                <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-ink">API reference</h1>
                <p className="mt-3 max-w-2xl leading-relaxed text-stone-600"><Md>{spec.info.description}</Md></p>
              </div>

              <section>
                <h2 className="font-serif text-2xl font-semibold text-ink">Authentication</h2>
                <p className="mt-2 leading-relaxed text-stone-600">
                  Authenticate every request with an API key in the <code className={mono}>Authorization</code> header.
                  Every request is strictly scoped to your account.
                </p>
                <pre className={`${mono} mt-3 overflow-auto rounded-xl bg-stone-100 p-3.5 text-stone-700`}>{`Authorization: Bearer tsk_live_…`}</pre>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-stone-600">
                  <span><strong className="font-semibold text-ink">Base URL</strong> <code className={mono}>{spec.servers?.[0]?.url}</code></span>
                </div>
              </section>

              <section>
                <h2 className="font-serif text-2xl font-semibold text-ink">Endpoints</h2>
                <div className="mt-3 space-y-2.5">
                  {operations.map(({ path, method, op }) => (
                    <Operation key={`${method} ${path}`} spec={spec} path={path} method={method} op={op} />
                  ))}
                </div>
              </section>

              {spec.webhooks && (
                <section>
                  <h2 className="font-serif text-2xl font-semibold text-ink">Webhooks</h2>
                  <p className="mt-2 leading-relaxed text-stone-600">
                    Register an endpoint in your dashboard to receive these events. Each delivery is signed
                    with <code className={mono}>Touchstones-Signature: t=&lt;ts&gt;,v1=&lt;hmac&gt;</code> — verify it
                    by recomputing HMAC-SHA256 over <code className={mono}>{'`${t}.${rawBody}`'}</code> with your endpoint secret.
                  </p>
                  <div className="mt-3 space-y-2">
                    {Object.entries(spec.webhooks).map(([name, item]) => (
                      <div key={name} className="card flex items-start gap-3 p-4">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-clay-200"><Bolt size={15} /></span>
                        <div>
                          <code className={`${mono} text-ink`}>{name}</code>
                          <p className="mt-0.5 text-sm text-stone-600"><Md>{item.post?.description || item.post?.summary}</Md></p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Right: sticky sandbox */}
            <div className="lg:sticky lg:top-20 lg:self-start">
              <Sandbox />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
