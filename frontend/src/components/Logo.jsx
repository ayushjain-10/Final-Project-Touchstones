import { Link } from 'react-router-dom'

// Touchstones wordmark with the ultramarine evidence-trace mark.
export default function Logo({ to = '/', className = '', onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="Touchstones home"
    >
      <span className="relative grid h-8 w-8 place-items-center rounded-[0.6rem] bg-clay-500 shadow-card transition-transform duration-300 group-hover:-rotate-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 16.5 10 6l4 8 2-3.5L19 16.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-paper bg-clay-300" />
      </span>
      <span className="font-serif text-[1.35rem] font-semibold leading-none tracking-tight text-ink dark:text-[#F4F6FF]">
        Touchstones
      </span>
    </Link>
  )
}
