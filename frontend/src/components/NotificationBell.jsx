import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { timeAgo } from '../lib/portalFormat.js'
import { Check } from './icons.jsx'

// Bell icon (no dependency) — the portal header notification affordance.
function BellIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10.5 19a1.8 1.8 0 0 0 3 0" />
    </svg>
  )
}

const POLL_MS = 60000

// Read the unread count defensively. The backend's /unread-count returns { unreadCount },
// and the list endpoint also carries { unreadCount } — accept that plus a few fallbacks.
function readCount(payload) {
  if (payload == null) return 0
  if (typeof payload === 'number') return payload
  if (typeof payload.unreadCount === 'number') return payload.unreadCount
  if (typeof payload.count === 'number') return payload.count
  if (typeof payload.unread === 'number') return payload.unread
  return 0
}

// Normalize the list endpoint, which may return an array or { notifications: [] }.
function readList(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.notifications)) return payload.notifications
  return []
}

// Candidate portal notification bell. Polls the unread count on mount + every ~60s,
// fetches the list only when opened, marks read on click, supports "mark all read",
// and click-through to notification.data.link. Closes on outside-click / Escape
// (mirrors EditorThemeMenu).
export default function NotificationBell() {
  const { user, configured } = useAuth()
  const navigate = useNavigate()
  const ref = useRef(null)

  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const enabled = configured && !!user

  const refreshCount = useCallback(() => {
    if (!enabled) return
    api
      .getUnreadCount()
      .then((res) => setCount(readCount(res)))
      .catch(() => {})
  }, [enabled])

  // Poll the unread count on mount + on an interval. Pause polling while the tab
  // is hidden, and refresh immediately when it becomes visible again.
  useEffect(() => {
    if (!enabled) return
    refreshCount()
    let timer = null
    const start = () => {
      stop()
      timer = setInterval(() => {
        if (!document.hidden) refreshCount()
      }, POLL_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVis = () => {
      if (!document.hidden) refreshCount()
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [enabled, refreshCount])

  // Outside-click + Escape to close (mirror EditorThemeMenu).
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const loadList = useCallback(() => {
    if (!enabled) return
    setLoading(true)
    setError(false)
    api
      .getNotifications()
      .then((res) => setItems(readList(res)))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [enabled])

  function toggle() {
    setOpen((o) => {
      const next = !o
      if (next) loadList()
      return next
    })
  }

  async function onItemClick(n) {
    // Optimistically mark read.
    if (!n.read) {
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read: true } : it)))
      setCount((c) => Math.max(0, c - 1))
      api.markNotificationRead(n.id).catch(() => {})
    }
    const link = n?.data?.link
    setOpen(false)
    if (link) {
      // Internal app link → router; external → full navigation.
      if (/^https?:\/\//i.test(link)) window.location.href = link
      else navigate(link)
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((it) => ({ ...it, read: true })))
    setCount(0)
    try {
      await api.markAllNotificationsRead()
    } catch {
      // If it failed, re-sync the truth from the server.
      refreshCount()
    }
  }

  if (!enabled) return null

  const hasUnread = count > 0

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={hasUnread ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative grid h-9 w-9 place-items-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink dark:text-[#AEB7D0] dark:hover:bg-[#18213A] dark:hover:text-[#F4F6FF]"
      >
        <BellIcon />
        {hasUnread && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-clay-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-paper dark:ring-[#090E1C]">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-lift dark:border-[#25304D] dark:bg-[#11182B]">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 dark:border-[#25304D]">
            <span className="text-sm font-semibold text-ink dark:text-[#F4F6FF]">Notifications</span>
            {items.some((n) => !n.read) && (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-clay-700 hover:underline dark:text-[#9DA9EF]"
              >
                <Check size={13} /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-3" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg bg-stone-100 p-3 dark:bg-[#18213A]"
                  >
                    <div className="h-3 w-1/2 rounded bg-stone-200/80 dark:bg-[#25304D]" />
                    <div className="mt-2 h-2.5 w-2/3 rounded bg-stone-200/60 dark:bg-[#2a241d]" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-stone-600 dark:text-[#AEB7D0]">
                  Couldn’t load notifications.
                </p>
                <button
                  type="button"
                  onClick={loadList}
                  className="mt-2 text-xs font-medium text-clay-700 hover:underline dark:text-[#9DA9EF]"
                >
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-clay-50 text-clay-500 ring-1 ring-clay-200 dark:bg-clay-500/10 dark:text-[#9DA9EF] dark:ring-clay-500/30">
                  <BellIcon size={18} />
                </span>
                <p className="mt-3 text-sm text-stone-600 dark:text-[#AEB7D0]">You’re all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-[#25304D]">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onItemClick(n)}
                      className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-stone-50 dark:hover:bg-[#18213A] ${
                        n.read ? '' : 'bg-clay-50/40 dark:bg-clay-500/5'
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.read ? 'bg-transparent' : 'bg-clay-500'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        {n.title && (
                          <span className="block truncate text-sm font-medium text-ink dark:text-[#F4F6FF]">
                            {n.title}
                          </span>
                        )}
                        {n.message && (
                          <span className="mt-0.5 block text-sm leading-snug text-stone-600 dark:text-[#AEB7D0]">
                            {n.message}
                          </span>
                        )}
                        <span className="mt-1 block text-xs text-stone-400 dark:text-[#8490AE]">
                          {timeAgo(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
