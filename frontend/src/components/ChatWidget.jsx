import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkle } from './icons.jsx'
import { api } from '../services/api.js'

// "Ask Touchstones" — a floating bottom-right AI assistant for the marketing site (Karat-style).
// Public: talks to POST /api/assistant/chat (no auth). Mounted only inside MarketingLayout, so it
// never appears on the candidate assessment or the recruiter app. Terracotta/ink, no green.

const BOOKING_URL = import.meta.env.VITE_BOOKING_URL || 'https://calendar.app.google/Fr1H7C4647vCU1mf6'

const STARTERS = [
  'What is Touchstones?',
  'How much does it cost?',
  'How is this different from a take-home?',
  'Is AI allowed during the screen?',
  'How does session integrity work?',
]

const GREETING =
  "Hi, I'm the Touchstones assistant. Ask me about role-specific work evidence, pricing, AI policy, or session integrity. I can point you to the right page or help you book a quick call."

// Links the assistant may reference as bare paths (in addition to markdown links) — kept clickable.
const INTERNAL_RE =
  /(?:\/(?:pricing|sample-report|candidate|trust|trust-center|threat-model|product|platforms|faq|about|contact|resources|privacy|terms|accessibility))\b/

function ChatGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H9l-4 3.5V15H6.5"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

// Only allow safe link targets: http(s), mailto, or a SAME-ORIGIN relative path (/x, not //host).
// Anything else (javascript:, data:, protocol-relative //evil.com, etc.) is rejected → the label is
// rendered as plain text. The assistant reply is model-generated and can be steered by user input,
// so its hrefs are untrusted — this is the XSS/open-redirect guard.
function safeHref(href) {
  const h = String(href || '').trim()
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h
  if (/^\/[^/]/.test(h)) return h // relative path, not protocol-relative "//"
  return null
}

// Renders assistant text with clickable links: markdown [label](href), bare URLs, and known
// internal /paths. Internal links navigate in-app (the widget persists across marketing routes);
// external links open in a new tab. Unsafe schemes are rendered as plain text (see safeHref).
function RichText({ text, onNavigate }) {
  const re = new RegExp(
    '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)' + // [label](href)
      '|(https?:\\/\\/[^\\s)]+)' + // bare url
      '|(' + INTERNAL_RE.source + ')', // bare internal path
    'g',
  )
  const nodes = []
  let last = 0
  let key = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const label = m[1] || m[3] || m[4]
    const href = safeHref(m[2] || m[3] || m[4])
    if (!href) {
      // Unsafe/unknown scheme — never render as a link; show the label as plain text.
      nodes.push(label)
      last = re.lastIndex
      continue
    }
    const isHttp = /^https?:\/\//i.test(href)
    const isInternal = href.startsWith('/')
    nodes.push(
      <a
        key={key++}
        href={href}
        target={isHttp ? '_blank' : undefined}
        rel={isHttp ? 'noopener noreferrer' : undefined}
        onClick={(e) => {
          if (isInternal) {
            e.preventDefault()
            onNavigate(href)
          }
        }}
        className="font-medium text-clay-700 underline underline-offset-2 hover:text-clay-800"
      >
        {label}
      </a>,
    )
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes}</>
}

export default function ChatWidget() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // { role: 'user' | 'assistant', content }
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [showStarters, setShowStarters] = useState(true)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, sending, showStarters])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = async (text) => {
    const message = (text ?? input).trim()
    if (!message || sending) return
    setError(null)
    setInput('')
    setShowStarters(false)
    const history = messages.slice(-12)
    setMessages((m) => [...m, { role: 'user', content: message }])
    setSending(true)
    try {
      const { reply } = await api.assistantChat(message, history)
      setMessages((m) => [...m, { role: 'assistant', content: reply || "Sorry, I didn't catch that." }])
    } catch {
      setError("The assistant is briefly unavailable. You can email help@touchstones.ai or book a call below.")
    } finally {
      setSending(false)
    }
  }

  const goTo = (href) => {
    navigate(href)
    // keep the widget open so they can keep chatting after navigating
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const Starters = () => (
    <div className="flex flex-wrap gap-2 pt-1">
      {STARTERS.map((s) => (
        <button
          key={s}
          onClick={() => send(s)}
          className="rounded-full border border-clay-200 bg-clay-50/60 px-3 py-1.5 text-xs font-medium text-clay-700 transition-colors hover:bg-clay-100"
        >
          {s}
        </button>
      ))}
    </div>
  )

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask Touchstones, open the AI assistant"
          className="group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-clay-600 py-3 pl-4 pr-5 text-white shadow-lift transition-all hover:bg-clay-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-clay-300 focus:ring-offset-2"
        >
          <ChatGlyph />
          <span className="text-sm font-semibold">Ask Touchstones</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Touchstones assistant"
          className="fixed bottom-5 right-5 z-50 flex h-[560px] max-h-[calc(100vh-2.5rem)] w-[384px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-canvas shadow-lift animate-fade-up"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-clay-50 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-clay-600 text-white">
                <Sparkle size={16} />
              </span>
              <div className="leading-tight">
                <p className="font-serif text-sm font-semibold text-ink">Ask Touchstones</p>
                <p className="text-[11px] text-stone-500">AI · answers about the product</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div className="flex gap-2">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-clay-100 text-clay-700">
                <Sparkle size={13} />
              </span>
              <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-stone-700 ring-1 ring-stone-200">
                {GREETING}
              </p>
            </div>

            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-clay-600 px-3.5 py-2.5 text-sm leading-relaxed text-white">
                    {m.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-clay-100 text-clay-700">
                    <Sparkle size={13} />
                  </span>
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-stone-700 ring-1 ring-stone-200">
                    <RichText text={m.content} onNavigate={goTo} />
                  </p>
                </div>
              ),
            )}

            {sending && (
              <div className="flex gap-2">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-clay-100 text-clay-700">
                  <Sparkle size={13} />
                </span>
                <p className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 ring-1 ring-stone-200">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" />
                  </span>
                </p>
              </div>
            )}

            {/* Suggested questions, shown on open and re-openable anytime via the toggle below */}
            {showStarters && !sending && <Starters />}

            {error && <p className="px-1 text-xs text-clay-700">{error}</p>}
          </div>

          {/* Quick actions: bring back the suggested questions, or book a call */}
          <div className="flex items-center gap-2 border-t border-stone-200 bg-white/60 px-3 pt-2.5">
            <button
              onClick={() => setShowStarters((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-clay-300 hover:text-clay-700"
              aria-expanded={showStarters}
            >
              <Sparkle size={12} />
              {showStarters ? 'Hide questions' : 'Suggested questions'}
            </button>
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-clay-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-clay-700"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Book a meeting
            </a>
          </div>

          {/* Input */}
          <div className="bg-white/60 px-3 pb-3 pt-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about Touchstones…"
                className="max-h-28 flex-1 resize-none rounded-xl border border-stone-300 bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-stone-400 focus:border-clay-500"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || sending}
                aria-label="Send"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-clay-600 text-white transition-colors hover:bg-clay-700 disabled:opacity-40"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 8h10M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <p className="mt-2 px-1 text-[10.5px] leading-tight text-stone-400">
              AI assistant, may be imperfect. For anything specific, book a call above.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
