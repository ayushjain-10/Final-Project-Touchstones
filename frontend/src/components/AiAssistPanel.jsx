import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import { Sparkle, ArrowRight, ShieldCheck } from './icons.jsx'
import Markdown from './Markdown.jsx'

// The candidate's in-app AI. "AI is allowed — direct it, then verify it" is the
// whole point of the screen, so this panel is a first-class tool, not a footnote.
//
// Every prompt the candidate sends (POST /ai-assist) is logged server-side along
// with the assistant's reply, forming the replay the recruiter later scores. We
// render the running conversation as TEXT only — model/candidate strings are
// never injected as HTML (security requirement).
//
// Props:
//   submissionId — required to talk to the backend; until present we self-explain.
//   configured   — Supabase configured (auth available)
//   signedIn     — the candidate has a session (the endpoint requires their token)
//   onActivity   — optional callback fired on each successful exchange (lets the
//                  parent treat AI use as behavioral activity if it wishes)
// Pull the first fenced code block out of an assistant reply (the suggested edit). Returns the inner
// code, or null if the reply has no code block.
function extractCode(content) {
  const m = String(content || '').match(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/)
  return m ? m[1].replace(/\n$/, '') : null
}

export default function AiAssistPanel({
  submissionId,
  configured = false,
  signedIn = false,
  onActivity,
  getCode, // () => current editor code (so the AI can read it)
  getLanguage, // () => current language key (optional)
  onApplyCode, // (code, seq) => apply the AI's suggested edit to the editor (accept). Absent → no Apply button.
  onReviewCode, // (code, seq) => open a Cursor-style diff review of the suggestion. Present → replaces instant Apply.
  fill = false, // when true, fills the parent height (IDE right pane) instead of a bounded card
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const scrollRef = useRef(null)
  const abortRef = useRef(null)

  const ready = Boolean(submissionId) && configured && signedIn

  // Hydrate any prior transcript so a returning candidate sees their history.
  useEffect(() => {
    if (!ready) return
    let active = true
    setLoadingHistory(true)
    api
      .getAiInteractions(submissionId)
      .then((res) => {
        if (!active) return
        const rows = Array.isArray(res?.interactions) ? res.interactions : []
        setMessages(
          rows
            .filter((r) => r.role === 'user' || r.role === 'assistant')
            .map((r) => ({ role: r.role, content: r.content, seq: r.seq })),
        )
      })
      .catch(() => {
        /* No history yet (or not reachable) is fine — start fresh. */
      })
      .finally(() => {
        if (active) setLoadingHistory(false)
      })
    return () => {
      active = false
    }
  }, [ready, submissionId])

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function send() {
    const text = input.trim()
    if (!text || sending || !ready) return
    setError(null)
    setInput('')
    const optimistic = { role: 'user', content: text }
    setMessages((m) => [...m, optimistic])
    setSending(true)

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { reply, seq } = await api.aiAssist(submissionId, text, {
        signal: controller.signal,
        code: getCode?.(),
        language: getLanguage?.(),
      })
      setMessages((m) => [...m, { role: 'assistant', content: reply ?? '', seq }])
      onActivity?.()
    } catch (e) {
      if (e?.name === 'AbortError') return
      // Surface a real error and let the candidate retry their prompt.
      setError(e?.message || 'The AI assistant could not be reached. Try again.')
      setMessages((m) => m.filter((msg) => msg !== optimistic))
      setInput(text)
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  function onKeyDown(e) {
    // Enter sends; Shift+Enter inserts a newline (it's a multi-line prompt box).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      className={`flex flex-col overflow-hidden bg-white dark:bg-[#11182B] ${
        fill ? 'h-full min-h-0' : 'rounded-2xl border border-stone-200 shadow-card'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-200 bg-canvas/70 px-4 py-2.5 dark:border-[#25304D] dark:bg-[#090E1C]">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink dark:text-[#F4F6FF]">
          <Sparkle size={16} className="text-clay-500" /> AI assistant
        </span>
        <span className="text-xs text-stone-400 dark:text-[#8490AE]">Logged with your work</span>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className={`flex-1 space-y-3 overflow-y-auto px-4 py-4 ${
          fill ? 'min-h-0' : 'max-h-[340px] min-h-[180px]'
        }`}
      >
        {messages.length === 0 && !loadingHistory && (
          <div className="flex h-full min-h-[140px] flex-col items-center justify-center px-4 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-clay-50 text-clay-600 ring-1 ring-clay-200">
              <Sparkle size={18} />
            </span>
            <p className="mt-3 text-sm font-medium text-ink dark:text-[#F4F6FF]">Direct the AI</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-stone-500 dark:text-[#AEB7D0]">
              Ask for a plan, draft code, or a sanity check — then verify what it gives you.
              How you prompt and catch its mistakes is part of the signal.
            </p>
          </div>
        )}

        {loadingHistory && (
          <p className="py-6 text-center text-xs text-stone-400">Loading your conversation…</p>
        )}

        {messages.map((m, i) => (
          <Bubble
            key={m.seq ?? `local-${i}`}
            role={m.role}
            content={m.content}
            seq={m.seq}
            onApplyCode={onApplyCode}
            onReviewCode={onReviewCode}
          />
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-stone-100 px-3.5 py-2.5 text-stone-400 dark:bg-[#18213A]">
              <Dot /> <Dot delay={140} /> <Dot delay={280} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-flag-50 px-3 py-2 text-xs text-flag-700 ring-1 ring-flag-100">
          {error}
        </p>
      )}

      {/* Composer */}
      <div className="border-t border-stone-200 bg-canvas/40 p-3 dark:border-[#25304D] dark:bg-[#090E1C]">
        {!ready && (
          <p className="mb-2 inline-flex items-center gap-1.5 px-1 text-xs text-stone-500 dark:text-[#AEB7D0]">
            <ShieldCheck size={13} className="text-clay-500" />
            {!configured || !signedIn
              ? 'Sign in to use the AI assistant on this screen.'
              : 'The AI assistant activates once your screen is loaded.'}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!ready || sending}
            rows={2}
            placeholder={ready ? 'Ask the AI to help — then verify it…' : 'AI assistant unavailable'}
            spellCheck={false}
            className="block w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-stone-400 focus:border-clay-400 focus:outline-none focus:ring-2 focus:ring-clay-100 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#F4F6FF] dark:placeholder:text-[#8490AE] dark:focus:border-clay-500 dark:focus:ring-clay-500/20 dark:disabled:bg-[#0D1426] dark:disabled:text-[#8490AE]"
          />
          <button
            onClick={send}
            disabled={!ready || sending || !input.trim()}
            aria-label="Send to AI assistant"
            className="btn-primary shrink-0 px-3.5 py-2.5 disabled:opacity-50"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// A single message bubble. User prompts sit right in terracotta; assistant replies sit left on
// stone. Content is always rendered as plain text. When an assistant reply contains a suggested
// code edit (a fenced block), we surface Review (diff + accept/deny) or Apply (instant accept)
// plus Copy (modify yourself); doing nothing is an implicit deny.
function Bubble({ role, content, seq, onApplyCode, onReviewCode }) {
  const isUser = role === 'user'
  const [applied, setApplied] = useState(false)
  const [copied, setCopied] = useState(false)
  const suggestion = !isUser ? extractCode(content) : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(suggestion)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        <div
          className={`break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'whitespace-pre-wrap rounded-br-md bg-clay-500 text-white'
              : 'rounded-bl-md bg-stone-100 text-ink dark:bg-[#18213A] dark:text-[#F4F6FF]'
          }`}
        >
          {isUser ? content : <Markdown source={content} className="text-inherit" />}
        </div>
        {suggestion && (
          <div className="mt-1.5 flex items-center gap-2">
            {onReviewCode ? (
              <button
                type="button"
                onClick={() => onReviewCode(suggestion, seq)}
                className="inline-flex items-center gap-1 rounded-lg bg-clay-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-clay-600"
              >
                Review edit
              </button>
            ) : onApplyCode ? (
              <button
                type="button"
                onClick={() => {
                  onApplyCode(suggestion, seq)
                  setApplied(true)
                  setTimeout(() => setApplied(false), 1800)
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-clay-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-clay-600"
              >
                {applied ? 'Applied ✓' : 'Apply to editor'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#AEB7D0]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <span className="text-[11px] text-stone-400 dark:text-[#8490AE]">Review before you accept</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Dot({ delay = 0 }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-stone-400"
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}
