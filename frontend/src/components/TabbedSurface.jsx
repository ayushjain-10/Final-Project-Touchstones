import { useSearchParams } from 'react-router-dom'

// A thin page-level tab bar that hosts EXISTING page components as tabs — the consolidation pattern
// for the prod-prep IA merge. Each tab's `el` is a full existing page (reused as-is, not rewritten),
// so every merged capability still works. The active tab is read from / written to `?tab=` so that
// deep links and the redirected old routes (e.g. /app/author-ai → /app/author?tab=ai) land on the
// right tab and survive a refresh. Terracotta active state only (no green/blue/purple).
export default function TabbedSurface({ tabs, defaultTab }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const active = tabs.some((t) => t.key === requested) ? requested : defaultTab || tabs[0].key

  function setTab(key) {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  const activeTab = tabs.find((t) => t.key === active) || tabs[0]

  return (
    <div>
      <div className="border-b border-stone-200 bg-canvas/40">
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-5">
          {tabs.map((t) => {
            const on = active === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-medium transition-colors ${
                  on ? 'border-clay-500 text-clay-700' : 'border-transparent text-stone-500 hover:text-ink'
                }`}
              >
                {t.icon ? <t.icon size={15} /> : null}
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      {activeTab.el}
    </div>
  )
}
