import { useEffect, useState } from 'react'
import { HashLink } from './HashLink.jsx'
import { NavLink } from 'react-router-dom'
import Logo from './Logo.jsx'
import { Menu, X, ArrowRight } from './icons.jsx'

// When the product app is enabled (the dev/preview build), expose Sign in + Get
// started and the live Pricing page. On the production waitlist build it's just
// "Join the waitlist" and Pricing stays hidden (its /pricing route isn't mounted there).
const APP_ENABLED = import.meta.env.VITE_APP_ENABLED === 'true'
const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

const links = EDITORIAL_UI_ENABLED
  ? [
      { to: '/#product', label: 'Product' },
      { to: '/sample-report', label: 'Sample packet' },
      ...(APP_ENABLED ? [{ to: '/pricing', label: 'Pricing' }] : []),
      { to: '/trust', label: 'Trust' },
    ]
  : [
      { to: '/#how', label: 'How it works' },
      { to: '/#whats-coming', label: "What's coming" },
      { to: '/platforms', label: 'For platforms' },
      ...(APP_ENABLED ? [{ to: '/pricing', label: 'Pricing' }] : []),
      { to: '/trust', label: 'Trust' },
      { to: '/about', label: 'About' },
      ...(APP_ENABLED ? [{ to: '/blog', label: 'Blog' }] : []),
    ]

// Shared link chrome: a quiet rounded pill that fills on hover, so the dense
// link row reads as deliberate rather than crowded. Active route gets a clay pill.
const deskLink = 'relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:-bottom-1 after:h-px after:origin-left after:scale-x-0 after:bg-clay-500 after:transition-transform'
const deskIdle = 'text-stone-600 hover:text-ink hover:after:scale-x-100'
const deskActive = 'text-clay-700 after:scale-x-100'
const mobLink = 'rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors'
const mobIdle = 'text-stone-700 hover:bg-stone-100'
const mobActive = 'bg-clay-50 text-clay-700'

// Sticky, minimal pre-launch nav. One primary CTA — join the waitlist / get
// started — always visible (the conversion rule). Anchor links scroll to home sections.
export default function MarketingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the mobile menu on Escape.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-stone-200 bg-paper/90 shadow-card backdrop-blur-md'
          : 'border-b border-transparent'
      }`}
    >
      {/* Three balanced zones — logo left, links centered, actions right. The equal
          flex-1 side zones keep the centered links dead-centre in the bar. */}
      <nav className="mx-auto flex h-16 max-w-content items-center gap-4 px-5 sm:px-8">
        <div className="flex flex-1 items-center">
          <div className="shrink-0">
            <Logo />
          </div>
        </div>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) =>
            l.to.includes('#') ? (
              <HashLink key={l.to} to={l.to} className={`${deskLink} ${deskIdle}`}>
                {l.label}
              </HashLink>
            ) : (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => `${deskLink} ${isActive ? deskActive : deskIdle}`}
              >
                {l.label}
              </NavLink>
            ),
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="hidden items-center gap-2 md:flex">
            {APP_ENABLED && (
              <NavLink
                to="/login"
                className="whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100 hover:text-ink"
              >
                Sign in
              </NavLink>
            )}
            {EDITORIAL_UI_ENABLED ? (
              <HashLink to="/#pilot" className="btn-primary whitespace-nowrap">
                Start a pilot <ArrowRight size={16} />
              </HashLink>
            ) : APP_ENABLED ? (
              <NavLink to="/login" className="btn-primary whitespace-nowrap">
                Get started <ArrowRight size={16} />
              </NavLink>
            ) : (
              <HashLink to="/#waitlist" className="btn-primary whitespace-nowrap">
                Join the waitlist <ArrowRight size={16} />
              </HashLink>
            )}
          </div>

          <button
            className="grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-stone-100 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </nav>

      {open && (
        <>
          {/* Dim the page so the menu reads as a layer; tap to dismiss. */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-0 top-16 z-40 bg-ink/25 backdrop-blur-[2px] md:hidden"
          />
          <div className="relative z-50 animate-fade-up border-t border-stone-200 bg-paper px-4 pb-5 pt-3 shadow-lift md:hidden">
            <div className="flex flex-col gap-0.5">
              {links.map((l) =>
                l.to.includes('#') ? (
                  <HashLink
                    key={l.to}
                    to={l.to}
                    onClick={() => setOpen(false)}
                    className={`${mobLink} ${mobIdle}`}
                  >
                    {l.label}
                  </HashLink>
                ) : (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => `${mobLink} ${isActive ? mobActive : mobIdle}`}
                  >
                    {l.label}
                  </NavLink>
                ),
              )}
            </div>

            <div className="my-3 h-px bg-stone-200" />

            <div className="flex flex-col gap-2">
              {APP_ENABLED && (
                <NavLink to="/login" onClick={() => setOpen(false)} className="btn-ghost w-full">
                  Sign in
                </NavLink>
              )}
              {EDITORIAL_UI_ENABLED ? (
                <HashLink
                  to="/#pilot"
                  className="btn-primary w-full"
                  onClick={() => setOpen(false)}
                >
                  Start a pilot <ArrowRight size={16} />
                </HashLink>
              ) : APP_ENABLED ? (
                <NavLink to="/login" onClick={() => setOpen(false)} className="btn-primary w-full">
                  Get started <ArrowRight size={16} />
                </NavLink>
              ) : (
                <HashLink
                  to="/#waitlist"
                  className="btn-primary w-full"
                  onClick={() => setOpen(false)}
                >
                  Join the waitlist <ArrowRight size={16} />
                </HashLink>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  )
}
