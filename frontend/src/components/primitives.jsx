// Small layout + typographic primitives shared across every page.

export function Container({ className = '', children }) {
  return <div className={`mx-auto w-full max-w-content px-5 sm:px-8 ${className}`}>{children}</div>
}

// Small brand label that sits above a section heading.
export function Kicker({ children, className = '' }) {
  return (
    <span className={`kicker ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
      {children}
    </span>
  )
}

// Rounded pill used for tags, states, and metadata.
export function Pill({ children, tone = 'neutral', className = '' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-[#18213A] dark:text-[#AEB7D0] dark:border-[#25304D]',
    brand: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:border-brand-500/30',
    success: 'bg-success-50 text-success-700 border-success-200',
    warning: 'bg-warning-50 text-warning-700 border-warning-100',
    danger: 'bg-danger-50 text-danger-700 border-danger-100',
    clay: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:border-brand-500/30',
    amber: 'bg-warning-50 text-warning-700 border-warning-100',
    flag: 'bg-danger-50 text-danger-700 border-danger-100',
    white: 'bg-white text-stone-700 border-stone-200',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// Section heading block: kicker + serif title + optional lede.
// `size` modulates the display scale so the page has hierarchy between
// narrative landmark sections ('lg') and utility sections ('md', default).
export function SectionHeading({ kicker, title, lede, align = 'left', size = 'md', className = '' }) {
  const titleCls =
    size === 'lg'
      ? 'text-4xl leading-[1.05] sm:text-[2.85rem] md:text-5xl'
      : 'text-3xl leading-[1.1] sm:text-4xl'
  return (
    <div
      className={`${align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'} ${className}`}
    >
      {kicker && <Kicker className="mb-4">{kicker}</Kicker>}
      <h2 className={`text-balance font-semibold ${titleCls}`}>{title}</h2>
      {lede && <p className="mt-4 text-lg leading-relaxed text-stone-600">{lede}</p>}
    </div>
  )
}

// Big editorial stat.
export function Stat({ value, label, source, tone = 'ink' }) {
  return (
    <div>
      <div
        className={`font-serif text-4xl font-semibold tracking-tight sm:text-5xl ${
          tone === 'clay' || tone === 'brand' ? 'text-brand-600' : 'text-ink'
        }`}
      >
        {value}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">{label}</p>
      {source && <p className="mt-1 text-xs text-stone-400">{source}</p>}
    </div>
  )
}
