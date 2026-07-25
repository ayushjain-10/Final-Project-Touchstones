import { useEffect, useRef, useState } from 'react'
import { EDITOR_THEMES } from '../lib/editorThemes.js'
import { Check } from './icons.jsx'

// Little dark/light dot so each theme is scannable at a glance.
function Swatch({ dark }) {
  return (
    <span
      className={`inline-block h-3 w-3 shrink-0 rounded-full border ${
        dark ? 'border-stone-600 bg-[#11182B]' : 'border-stone-300 bg-[#FCF9F3]'
      }`}
    />
  )
}

// Editor-theme picker for the candidate IDE top bar. Lists the presets (Touchstones + the popular
// published themes), persists nothing itself — the parent owns the value + onChange.
export default function EditorThemeMenu({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

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

  const current = EDITOR_THEMES.find((t) => t.key === value) || EDITOR_THEMES[0]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Editor theme"
        className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
      >
        <Swatch dark={current.dark} />
        <span className="hidden sm:inline">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lift dark:border-[#25304D] dark:bg-[#11182B]"
        >
          {EDITOR_THEMES.map((t) => {
            const active = t.key === value
            return (
              <button
                key={t.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(t.key)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? 'text-clay-700 dark:text-[#9DA9EF]'
                    : 'text-stone-700 hover:bg-stone-50 dark:text-[#DDE2FF] dark:hover:bg-[#18213A]'
                }`}
              >
                <Swatch dark={t.dark} />
                <span className="flex-1">{t.label}</span>
                {active && <Check size={15} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
