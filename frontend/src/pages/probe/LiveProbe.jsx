import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Logo from '../../components/Logo.jsx'
import { Pill } from '../../components/primitives.jsx'
import { Sparkle, ShieldCheck, ArrowRight, Check } from '../../components/icons.jsx'
import { api } from '../../services/api.js'
import { useSpeechDictation } from '../../hooks/useSpeechDictation.js'

// Small inline mic glyph (no dependency on the shared icon set). Pulses while listening.
function MicIcon({ listening = false }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={listening ? 'animate-pulse' : ''} aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
    </svg>
  )
}

// Public candidate experience: a short, adaptive AI interview about the work the candidate just
// submitted. Honest framing, one question at a time, chat-style. No auth — the URL token is the key.
export default function LiveProbe() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | ready | sending | done | error
  const [error, setError] = useState(null)
  const [meta, setMeta] = useState({ turn_index: 0, max_turns: 4, task_title: null })
  const [messages, setMessages] = useState([]) // [{ role:'interviewer'|'candidate', content }]
  const [question, setQuestion] = useState(null)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)
  // Optional voice input: dictate the answer (browser streams mic → Azure directly; nothing is stored).
  // Hidden entirely unless the walkthrough flag + Speech creds are on (the token endpoint 404s otherwise).
  const dictation = useSpeechDictation(token, (text) => setDraft((d) => (d ? d.trimEnd() + ' ' : '') + text))

  const load = useCallback(() => {
    setState('loading'); setError(null)
    return api.getProbeByToken(token)
      .then((p) => {
        setMeta({ turn_index: p.turn_index || 0, max_turns: p.max_turns || 4, task_title: p.task_title })
        if (p.done) { setState('done'); return }
        setQuestion(p.question)
        setMessages((m) => (m.length ? m : (p.question ? [{ role: 'interviewer', content: p.question }] : [])))
        setState('ready')
      })
      .catch((e) => { setError(e?.message || 'This interview link could not be opened.'); setState('error') })
  }, [token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, state])

  async function send() {
    const answer = draft.trim()
    if (!answer || state === 'sending') return
    setState('sending'); setError(null)
    setMessages((m) => [...m, { role: 'candidate', content: answer }])
    setDraft('')
    try {
      const r = await api.answerProbe(token, answer)
      if (r.done) { setState('done'); setQuestion(null); return }
      setMeta((mm) => ({ ...mm, turn_index: r.turn_index || mm.turn_index + 1 }))
      setQuestion(r.question)
      setMessages((m) => [...m, { role: 'interviewer', content: r.question }])
      setState('ready')
    } catch (e) {
      setError(e?.message || 'Could not send your answer — please try again.')
      setState('ready')
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Logo />
          <Pill tone="clay"><ShieldCheck size={12} /> Private interview</Pill>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-8">
        {state === 'loading' && (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-200/50" />)}</div>
        )}

        {state === 'error' && (
          <div className="rounded-2xl border border-flag-100 bg-flag-50 p-6 text-center">
            <p className="font-medium text-flag-700">{error}</p>
            <button onClick={load} className="btn-quiet mt-3">Try again</button>
          </div>
        )}

        {state === 'done' && (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200">
              <Check size={22} />
            </span>
            <h1 className="mt-4 font-serif text-2xl font-semibold text-ink">Interview complete — thank you.</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-stone-600">
              Your answers are in. They're reviewed alongside your work — one explainable result, no black box.
              You answered in your own words, and that's the point.
            </p>
          </div>
        )}

        {(state === 'ready' || state === 'sending') && (
          <>
            <div className="mb-5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-clay-600">
                <Sparkle size={13} /> Live probe
              </span>
              <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-ink">
                A few questions about the work you just did
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
                Touchstones is asking you about your own submission{meta.task_title ? ` — “${meta.task_title}”` : ''}.
                Answer in your own words; how you reason about your work is part of the signal. AI was allowed on the task — this part is just you.
              </p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-clay-500 transition-all"
                  style={{ width: `${Math.min(100, ((meta.turn_index || 1) / (meta.max_turns || 4)) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-stone-400">Question {Math.min(meta.turn_index || 1, meta.max_turns)} of {meta.max_turns}</p>
            </div>

            <div ref={scrollRef} className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === 'candidate'
                      ? 'bg-stone-100 text-ink ring-1 ring-stone-200'
                      : 'bg-clay-50 text-ink ring-1 ring-clay-200'
                  }`}>
                    {m.role === 'interviewer' && (
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-clay-600">Interviewer</span>
                    )}
                    {m.content}
                  </div>
                </div>
              ))}
              {state === 'sending' && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-clay-50 px-4 py-3 ring-1 ring-clay-200">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-clay-400" style={{ animationDelay: `${i * 150}ms` }} />)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={state === 'sending'}
                rows={4}
                placeholder="Answer in your own words…  (⌘/Ctrl + Enter to send)"
                className="w-full rounded-xl border border-stone-200 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-clay-400 focus:bg-white focus:ring-2 focus:ring-clay-100"
              />
              {(error || dictation.error) && <p className="mt-1.5 text-sm text-flag-700">{error || dictation.error}</p>}
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-stone-400">
                  {dictation.listening ? 'Listening — speak your answer, then Send.' : 'Behavioral signals only — no biometrics.'}
                </p>
                <div className="flex items-center gap-2">
                  {dictation.available && (
                    <button
                      type="button"
                      onClick={dictation.toggle}
                      disabled={state === 'sending'}
                      aria-label={dictation.listening ? 'Stop voice input' : 'Answer by voice'}
                      className={`btn-quiet inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50 ${dictation.listening ? 'text-clay-700' : 'text-stone-500'}`}
                    >
                      <MicIcon listening={dictation.listening} /> {dictation.listening ? 'Stop' : 'Speak'}
                    </button>
                  )}
                  <button onClick={send} disabled={!draft.trim() || state === 'sending'} className="btn-primary disabled:opacity-50">
                    {state === 'sending' ? 'Sending…' : <>Send <ArrowRight size={15} /></>}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
