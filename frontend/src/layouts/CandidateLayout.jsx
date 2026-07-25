import { Outlet, useLocation } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import { Sparkle, Lock } from '../components/icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import PortalNav from '../components/portal/PortalNav.jsx'
import UserMenu from '../components/UserMenu.jsx'
import EvidenceNetwork from '../components/EvidenceNetwork.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// Candidate-facing flow gets its own calm, focused chrome with no app sidebar.
// The assignment itself owns tool-policy language so the portal never overstates what is allowed.
//
// When a candidate is signed in, the chrome grows a notification bell + a portal
// sub-nav (Dashboard / Results / Credentials / Profile). The bare assessment runner
// (/candidate) stays distraction-free, so the sub-nav is suppressed there.
export default function CandidateLayout() {
  const { user, configured } = useAuth()
  const { pathname } = useLocation()
  const signedIn = configured && !!user
  // Keep the assessment runner itself focused (no portal tabs while taking a screen).
  const isRunner = pathname === '/candidate'
  const showPortalNav = signedIn && !isRunner

  if (EDITORIAL_UI_ENABLED) {
    return (
      <div
        className={`relative min-h-screen ${
          isRunner ? 'bg-paper' : 'bg-paper bg-evidence-light [&>nav>div]:max-w-5xl'
        }`}
      >
        {!isRunner && (
          <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.16]" aria-hidden="true">
            <EvidenceNetwork density="sparse" interactive={false} />
          </div>
        )}

        <header
          className={`sticky top-0 z-40 border-b backdrop-blur-xl ${
            isRunner
              ? 'border-stone-200 bg-paper/90 dark:border-[#25304D] dark:bg-[#090E1C]/80'
              : 'dark border-white/10 bg-[#0d1220]/95 shadow-[0_12px_40px_-30px_rgba(17,23,68,0.9)]'
          }`}
        >
          <div className="mx-auto flex h-[4.5rem] max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex min-w-0 items-center gap-4">
              <Logo />
              {!isRunner && (
                <span className="hidden border-l border-white/15 pl-4 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-brand-200 sm:inline">
                  Candidate workspace
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span
                className={`inline-flex items-center gap-1.5 text-xs ${
                  isRunner ? 'text-stone-500 dark:text-[#AEB7D0]' : 'text-white/60'
                }`}
              >
                <Lock size={14} /> {isRunner ? 'Private assessment' : 'Private record'}
              </span>
              {signedIn && <NotificationBell />}
              {signedIn && <UserMenu />}
            </div>
          </div>
        </header>

        {showPortalNav && <PortalNav />}

        <div className="relative z-20 border-b border-brand-200 bg-brand-50/90 backdrop-blur-sm dark:border-[#25304D] dark:bg-[#090E1C]">
          <div className="mx-auto flex max-w-5xl items-start gap-2.5 px-5 py-2.5 text-sm text-brand-900 dark:text-[#DDE2FF] sm:px-8">
            <Sparkle size={15} className="mt-0.5 shrink-0 text-brand-600 dark:text-[#9DA9EF]" />
            <span>
              <span className="font-semibold">Task-specific policy.</span> Each assignment names the
              allowed tools and session requirements before you begin.
            </span>
          </div>
        </div>

        <main className="relative z-10">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper dark:bg-[#090E1C]">
      <header className="border-b border-stone-200 bg-paper/80 backdrop-blur-md dark:border-[#25304D] dark:bg-[#090E1C]/80">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#AEB7D0]">
              <Lock size={14} /> Private screen
            </span>
            {signedIn && <NotificationBell />}
            {signedIn && <UserMenu />}
          </div>
        </div>
      </header>

      {showPortalNav && <PortalNav />}

      <div className="border-b border-clay-200 bg-clay-50 dark:border-clay-500/30 dark:bg-clay-500/10">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-5 py-2.5 text-sm text-clay-800 dark:text-[#C8CEFA]">
          <Sparkle size={15} />
          <span>
            <span className="font-semibold">Task-specific policy.</span> Review the allowed tools and
            session requirements in the instructions before you begin.
          </span>
        </div>
      </div>

      <main>
        <Outlet />
      </main>
    </div>
  )
}
