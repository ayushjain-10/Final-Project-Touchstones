export default function CandidatePortalPage({
  label,
  title,
  description,
  asideTitle,
  asideItems = [],
  children,
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-9 sm:px-8 sm:py-12">
      <header className="grid gap-7 border-b border-stone-300 pb-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end lg:gap-14">
        <div>
          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-brand-700">
            {label}
          </p>
          <h1 className="mt-4 max-w-2xl text-balance font-serif text-[2.55rem] font-semibold leading-[0.98] text-ink sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
            {description}
          </p>
        </div>

        <aside className="border border-brand-200 border-t-2 border-t-brand-500 bg-white/85 p-5 shadow-card backdrop-blur-sm">
          <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-brand-700">
            {asideTitle}
          </p>
          <ol className="mt-4 divide-y divide-stone-200">
            {asideItems.map((item, index) => (
              <li key={item.title} className="grid grid-cols-[1.7rem_1fr] gap-2 py-3 first:pt-0 last:pb-0">
                <span className="pt-0.5 font-mono text-[0.66rem] tabular-nums text-brand-500">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </header>

      {children}
    </div>
  )
}
