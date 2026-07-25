import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Compact avatar + dropdown (Sign out) for the candidate chrome — the assessment runner and the
// candidate portal both use CandidateLayout, so mounting this in that header gives both a visible
// user icon and a logout. The recruiter app (AppLayout) has its own menu.
export default function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
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

  if (!user) return null
  const email = user.email || ''
  const initial = (email[0] || 'U').toUpperCase()

  async function handleSignOut() {
    setOpen(false)
    try {
      await signOut()
    } catch {
      /* ignore */
    }
    navigate('/login')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid h-8 w-8 place-items-center rounded-full bg-clay-600 text-sm font-semibold text-white ring-1 ring-clay-700/20 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-clay-300"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lift dark:border-[#25304D] dark:bg-[#11182B]"
        >
          <div className="border-b border-stone-100 px-4 py-3 dark:border-[#25304D]">
            <p className="truncate text-sm font-medium text-ink dark:text-[#F4F6FF]">{email}</p>
            <p className="text-xs text-stone-400 dark:text-[#8490AE]">Candidate</p>
          </div>
          <Link
            to="/candidate/home"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 dark:text-[#D4D9E8] dark:hover:bg-[#18213A]"
          >
            Dashboard
          </Link>
          <Link
            to="/candidate/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 dark:text-[#D4D9E8] dark:hover:bg-[#18213A]"
          >
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="block w-full border-t border-stone-100 px-4 py-2.5 text-left text-sm text-stone-700 hover:bg-stone-50 dark:border-[#25304D] dark:text-[#D4D9E8] dark:hover:bg-[#18213A]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
