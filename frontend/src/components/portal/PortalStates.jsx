import { isRetryable } from '../../services/api.js'
import { RotateCcw } from '../icons.jsx'

// Shared loading / empty / error states for the candidate portal pages, so Dashboard,
// Results, and Credentials present a consistent, on-brand surface. Warm terracotta/sand,
// dark-mode variants matching CandidateLayout.

// A row of skeleton cards while data loads.
export function PortalSkeleton({ count = 3 }) {
  return (
    <div className="mt-6 space-y-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-stone-200 bg-canvas/60 p-5 dark:border-[#25304D] dark:bg-[#0D1426]"
        >
          <div className="h-4 w-1/2 rounded bg-stone-200/70 dark:bg-[#25304D]" />
          <div className="mt-3 h-3 w-2/3 rounded bg-stone-200/50 dark:bg-[#2a241d]" />
          <div className="mt-4 h-8 w-28 rounded-xl bg-stone-200/50 dark:bg-[#2a241d]" />
        </div>
      ))}
    </div>
  )
}

// Friendly empty state with an icon, title and supporting copy.
export function PortalEmpty({ icon: Icon, title, children }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-canvas/40 px-6 py-12 text-center dark:border-[#303C5C] dark:bg-[#0D1426]/60">
      {Icon && (
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-clay-50 text-clay-500 ring-1 ring-clay-200 dark:bg-clay-500/10 dark:text-[#9DA9EF] dark:ring-clay-500/30">
          <Icon size={22} />
        </span>
      )}
      <p className="mt-4 font-medium text-ink dark:text-[#F4F6FF]">{title}</p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-stone-600 dark:text-[#AEB7D0]">
          {children}
        </p>
      )}
    </div>
  )
}

// Error state with an optional retry. Hides the retry button for terminal 4xx
// (auth/validation) where retrying wouldn't help.
export function PortalError({ error, onRetry }) {
  const message =
    (error && (error.message || String(error))) || 'Something went wrong. Please try again.'
  const canRetry = onRetry && (!error || error.status == null || isRetryable(error))
  return (
    <div className="mt-6 rounded-2xl border border-flag-100 bg-flag-50/50 px-5 py-4 text-sm dark:border-flag-500/30 dark:bg-flag-500/10">
      <p className="font-medium text-flag-700 dark:text-[#F0846A]">Couldn’t load this</p>
      <p className="mt-1 text-stone-600 dark:text-[#AEB7D0]">{message}</p>
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
        >
          <RotateCcw size={14} /> Try again
        </button>
      )}
    </div>
  )
}
