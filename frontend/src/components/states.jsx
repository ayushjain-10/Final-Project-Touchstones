// Shared data-view states — so every screen shows a consistent, on-palette
// loading / empty / error treatment instead of bare spinners or dead ends.
//
//   <Skeleton className="h-4 w-32" />            — a pulsing placeholder block
//   <ErrorState message={…} onRetry={load} />    — warm error card + Try again
//   <EmptyState title hint cta ctaTo|onCta />     — dashed card + one next action
//
// Palette only: clay (accent), stone (neutral), flag (error), canvas/paper
// surfaces. No green/blue/purple. Headings inherit Fraunces via the global rule.

import { Link } from 'react-router-dom'

// A single pulsing placeholder. Compose several to mirror real layout.
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-stone-200/70 ${className}`} aria-hidden="true" />
}

// Error card with an optional Retry. `onRetry` should re-run the failed load.
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  className = '',
}) {
  return (
    <div
      role="alert"
      className={`rounded-2xl border border-flag-100 bg-flag-50 p-6 ${className}`}
    >
      <p className="font-serif text-base font-semibold text-flag-700">{title}</p>
      {message && <p className="mt-1 text-sm leading-relaxed text-flag-700/90">{message}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost mt-4 px-4 py-2 text-xs">
          {retryLabel}
        </button>
      )}
    </div>
  )
}

// Cold-start hint — shown when an initial fetch has been slow for a while (the dev
// backend spins down when idle). Keeps a long load from looking like a silent
// forever-skeleton. Dark-aware so it reads in both the recruiter app and the
// candidate portal. Pair with the `useSlowLoading` hook.
export function WakingNote({ className = '' }) {
  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-2xl border border-stone-200 bg-canvas/60 px-4 py-3 text-sm text-stone-600 dark:border-[#25304D] dark:bg-[#0D1426] dark:text-[#AEB7D0] ${className}`}
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-clay-500" aria-hidden="true" />
      Waking the server — it spins down when idle, so the first load can take up to a minute.
    </div>
  )
}

// Honest empty state: a dashed card with a headline, a hint, and one CTA.
// Pass `ctaTo` for a route link, or `onCta` for a click handler (not both).
export function EmptyState({
  icon = null,
  title,
  hint,
  cta,
  ctaTo,
  onCta,
  children,
  className = '',
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-stone-300 bg-canvas/50 p-10 text-center ${className}`}
    >
      {icon && <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-clay-50 text-clay-500">{icon}</div>}
      {title && <p className="font-serif text-lg font-semibold text-ink">{title}</p>}
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-stone-500">{hint}</p>}
      {cta && ctaTo && (
        <Link to={ctaTo} className="btn-primary mt-5">
          {cta}
        </Link>
      )}
      {cta && onCta && !ctaTo && (
        <button type="button" onClick={onCta} className="btn-primary mt-5">
          {cta}
        </button>
      )}
      {children}
    </div>
  )
}
