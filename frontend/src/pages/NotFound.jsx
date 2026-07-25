import { Link } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import Seo from '../components/Seo.jsx'
import { ArrowRight } from '../components/icons.jsx'

// Branded, self-contained 404 — works as the global catch-all (no layout chrome assumed).
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-paper">
      <Seo title="Page not found" description="The page you're looking for doesn't exist." />
      <header className="mx-auto flex h-16 w-full max-w-content items-center px-5 sm:px-8">
        <Link to="/" aria-label="Touchstones home">
          <Logo />
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="max-w-xl text-center">
          <p className="font-serif text-6xl font-semibold text-clay-500">404</p>
          <h1 className="mt-4 font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl">
            We couldn't find that page.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">
            The link may be broken or the page may have moved. Let's get you back on track.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-xl bg-clay-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-clay-600"
            >
              Back to home <ArrowRight size={18} />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-xl border border-stone-300 px-6 py-3 text-base font-medium text-stone-700 transition-colors hover:border-clay-300 hover:text-clay-700"
            >
              Contact us
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
