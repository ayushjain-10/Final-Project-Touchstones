import { useNavigate, useLocation } from 'react-router-dom'

// A Link that scrolls to an in-page anchor (e.g. "/#waitlist"), working both
// when you're already on the target route and when you navigate to it from
// another page. React Router's <Link> doesn't scroll to hashes on its own, and
// the app's ScrollToTop resets scroll on navigation — so we handle it here.
export function HashLink({ to, children, className = '', onClick, ...props }) {
  const navigate = useNavigate()
  const location = useLocation()

  const [path, hash] = to.split('#')
  const targetPath = path || '/'

  function scrollToHash() {
    if (!hash) return
    const el = document.getElementById(hash)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleClick(e) {
    e.preventDefault()
    onClick?.()
    if (location.pathname === targetPath) {
      // Already on the page — just scroll.
      scrollToHash()
    } else {
      // Navigate first, then scroll after the new page mounts.
      navigate(targetPath)
      // Defer past ScrollToTop's scroll-to-(0,0) on the next route.
      window.setTimeout(scrollToHash, 80)
    }
  }

  return (
    <a href={to} className={className} onClick={handleClick} {...props}>
      {children}
    </a>
  )
}

export default HashLink
