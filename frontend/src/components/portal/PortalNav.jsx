import { NavLink } from 'react-router-dom'
import { Grid, FileText, ShieldCheck, User } from '../icons.jsx'

// Candidate portal sub-navigation. Renders the four portal surfaces as on-brand,
// scrollable-on-mobile tabs. Only mounted for a signed-in candidate (the layout
// gates this), so it never shows to a signed-out visitor or on the bare /candidate
// assessment runner.
const TABS = [
  { to: '/candidate/home', label: 'Dashboard', icon: Grid },
  { to: '/candidate/results', label: 'Results', icon: FileText },
  { to: '/candidate/credentials', label: 'Credentials', icon: ShieldCheck },
  { to: '/candidate/profile', label: 'Profile', icon: User },
]

export default function PortalNav() {
  return (
    <nav className="border-b border-stone-200 bg-paper/80 backdrop-blur-md dark:border-[#25304D] dark:bg-[#090E1C]/80">
      <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-3 sm:px-5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/candidate/home'}
            className={({ isActive }) =>
              `inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-clay-500 text-clay-700 dark:border-clay-500 dark:text-[#9DA9EF]'
                  : 'border-transparent text-stone-500 hover:text-ink dark:text-[#AEB7D0] dark:hover:text-[#F4F6FF]'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
