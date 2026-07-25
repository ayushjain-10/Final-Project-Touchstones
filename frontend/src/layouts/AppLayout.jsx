import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppSidebar from '../components/AppSidebar.jsx'
import { ArrowUpRight, Plus, Menu, X } from '../components/icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../services/api.js'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

function initialsFromEmail(email) {
  if (!email) return '·'
  const name = email.split('@')[0]
  const parts = name.split(/[.\-_]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase()
}

// Shell for authenticated product screens: left rail + slim top bar. Identity,
// sign-out, and (below lg) a hamburger-driven mobile nav drawer.
export default function AppLayout() {
  const { user, signOut, configured } = useAuth()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const email = user?.email || ''
  const initials = initialsFromEmail(email)

  // Founders see the recruiter-approval queue link (the API gates it regardless).
  useEffect(() => {
    if (!configured) return undefined
    let active = true
    api.getPortalStatus().then((s) => active && setIsAdmin(!!s?.is_admin)).catch(() => {})
    return () => {
      active = false
    }
  }, [configured])

  useEffect(() => {
    if (!menuOpen && !drawerOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, drawerOpen])

  async function handleSignOut() {
    setMenuOpen(false)
    try {
      await signOut()
    } finally {
      navigate('/')
    }
  }

  return (
    <div className={`flex min-h-screen bg-paper ${EDITORIAL_UI_ENABLED ? 'bg-evidence-light' : ''}`}>
      <AppSidebar />

      {/* Mobile nav drawer (below lg) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[82%] shadow-lift">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-stone-500 hover:bg-stone-100"
            >
              <X size={18} />
            </button>
            <AppSidebar mobile onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 bg-paper/85 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 grid h-9 w-9 place-items-center rounded-lg text-stone-600 hover:bg-stone-100 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <span className="hidden text-stone-400 sm:inline">Workspace</span>
              <span className="hidden text-stone-300 sm:inline">/</span>
              <span className="max-w-[44vw] truncate font-medium text-ink">{email || 'Your workspace'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/app/author" className="btn-primary px-4 py-2 text-xs">
              <Plus size={15} /> New screen
            </Link>
            <Link
              to="/"
              className="hidden items-center gap-1 text-xs font-medium text-stone-500 hover:text-ink sm:inline-flex"
            >
              View site <ArrowUpRight size={14} />
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="grid h-8 w-8 place-items-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600 hover:bg-stone-300"
              >
                {initials}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lift"
                  >
                    <div className="border-b border-stone-100 px-4 py-3">
                      <p className="text-xs text-stone-400">Signed in as</p>
                      <p className="truncate text-sm font-medium text-ink">{email || '—'}</p>
                    </div>
                    <Link
                      to="/app/account"
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                      className="block px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50"
                    >
                      Account settings
                    </Link>
                    <Link
                      to="/app/team"
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                      className="block px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50"
                    >
                      Team &amp; workspace
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/app/recruiter-requests"
                        onClick={() => setMenuOpen(false)}
                        role="menuitem"
                        className="block px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50"
                      >
                        Recruiter requests
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={handleSignOut}
                      role="menuitem"
                      className="block w-full px-4 py-2.5 text-left text-sm text-stone-700 hover:bg-stone-50"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
