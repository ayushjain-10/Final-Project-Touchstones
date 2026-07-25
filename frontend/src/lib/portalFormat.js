// Small, dependency-free date/time formatters shared across the candidate portal
// (Dashboard / Results / Credentials / Profile / NotificationBell). Kept here so the
// pages don't each re-implement the same "2 days left" / "Jun 30" / "5m ago" logic.

const DAY_MS = 24 * 60 * 60 * 1000

// "Jun 30, 2026" — a calm absolute date. Returns '' for missing/invalid input.
export function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Relative "x ago" for past timestamps (notifications, submitted dates).
export function timeAgo(value) {
  if (!value) return ''
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return formatDate(value)
}

// Human deadline for an assignment: "2 days left" / "Due tomorrow" / "Due Jun 30" /
// "Overdue". Returns { text, urgent } so the card can color the urgent case.
export function deadlineLabel(value) {
  if (!value) return { text: '', urgent: false }
  const due = new Date(value).getTime()
  if (Number.isNaN(due)) return { text: '', urgent: false }
  const diff = due - Date.now()
  if (diff <= 0) return { text: 'Overdue', urgent: true }
  const days = Math.ceil(diff / DAY_MS)
  if (diff < DAY_MS) {
    const hrs = Math.max(1, Math.round(diff / (60 * 60 * 1000)))
    return { text: hrs <= 1 ? 'Due within the hour' : `${hrs} hours left`, urgent: true }
  }
  if (days === 1) return { text: 'Due tomorrow', urgent: true }
  if (days <= 7) return { text: `${days} days left`, urgent: days <= 2 }
  return { text: `Due ${formatDate(value)}`, urgent: false }
}
