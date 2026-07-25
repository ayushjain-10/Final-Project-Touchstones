import { Link } from 'react-router-dom'

const variants = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  quiet: 'btn-quiet',
}

// Polymorphic button: renders a router <Link> when `to` is set, an <a> when
// `href` is set, otherwise a <button>. Keeps the single-primary-CTA rule easy.
export default function Button({
  children,
  variant = 'primary',
  to,
  href,
  className = '',
  ...props
}) {
  const cls = `${variants[variant]} ${className}`
  if (to) {
    return (
      <Link to={to} className={cls} {...props}>
        {children}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={cls} {...props}>
        {children}
      </a>
    )
  }
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  )
}
