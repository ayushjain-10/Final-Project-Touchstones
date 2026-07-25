import { useEffect, useRef, useState } from 'react'
import { Check, Code } from './icons.jsx'

// Language picker for the candidate IDE — pick the language you want to solve a problem in
// (LeetCode-style). Controlled: the parent owns `value` + persistence and swaps the editor's
// solution file on change. Mirrors EditorThemeMenu's trigger-pill + listbox-popover pattern.
export default function LanguagePicker({ value, options = [], onChange }) {
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

  const current = options.find((o) => o.key === value) || options[0]
  if (!current) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Language"
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-clay-300 dark:border-[#25304D] dark:bg-[#090E1C] dark:text-[#DDE2FF] dark:hover:border-clay-500/50"
      >
        <Code size={13} className="text-stone-400 dark:text-[#8490AE]" />
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-1.5 max-h-72 w-44 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lift dark:border-[#25304D] dark:bg-[#11182B]"
        >
          {options.map((o) => {
            const active = o.key === value
            return (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.key)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'text-clay-700 dark:text-[#9DA9EF]'
                    : 'text-stone-700 hover:bg-stone-50 dark:text-[#DDE2FF] dark:hover:bg-[#18213A]'
                }`}
              >
                <span>{o.label}</span>
                {active && <Check size={15} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
