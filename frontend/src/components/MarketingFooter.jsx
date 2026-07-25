import { Link } from 'react-router-dom'
import { HashLink } from './HashLink.jsx'
import Logo from './Logo.jsx'
import { Linkedin, Mail } from './icons.jsx'

const LINKEDIN_URL = 'https://www.linkedin.com/company/trytouchstones/'

const HELP_EMAIL = 'help@touchstones.ai'

// The Sample-report and Pricing links are app-build-only (dev/preview): the frozen production
// waitlist footer must stay pixel-identical, and /pricing isn't even mounted there.
const APP_ENABLED = import.meta.env.VITE_APP_ENABLED === 'true'
const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

const cols = [
  {
    title: 'Product',
    links: EDITORIAL_UI_ENABLED
      ? [
          { to: '/#product', label: 'Product story', hash: true },
          { to: '/sample-report', label: 'Sample evidence packet' },
          { to: '/#pilot', label: 'Start a pilot', hash: true },
          ...(APP_ENABLED ? [{ to: '/pricing', label: 'Pricing' }] : []),
          { to: '/docs/api', label: 'API docs' },
          { to: '/trust', label: 'Trust & security' },
          { to: '/status', label: 'Status' },
        ]
      : [
          { to: '/#how', label: 'How it works', hash: true },
          { to: '/#whats-coming', label: "What's coming", hash: true },
          { to: '/platforms', label: 'For platforms' },
          ...(APP_ENABLED
            ? [
                { to: '/sample-report', label: 'Sample score report' },
                { to: '/pricing', label: 'Pricing' },
              ]
            : []),
          { to: '/docs/api', label: 'API docs' },
          { to: '/trust', label: 'Trust & security' },
          { to: '/status', label: 'Status' },
        ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About & founder' },
      // Blog is app-build-only (dev/preview), like Sample-report/Pricing above — keeps the
      // frozen production waitlist footer pixel-identical.
      ...(APP_ENABLED ? [{ to: '/blog', label: 'Blog' }] : []),
      { to: '/contact', label: 'Contact' },
      { to: '/faq', label: 'Help & FAQ' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { to: '/privacy', label: 'Privacy Policy' },
      { to: '/terms', label: 'Terms of Service' },
      { to: '/trust-center', label: 'Trust & data' },
      { to: '/threat-model', label: 'Threat model' },
      { to: '/subprocessors', label: 'Sub-processors' },
      { to: '/accessibility', label: 'Accessibility' },
    ],
  },
]

// Light, warm footer — no dark slab (keeps everything bright, on-brand).
export default function MarketingFooter() {
  return (
    <footer className="border-t border-stone-200 bg-sand">
      <div className="mx-auto max-w-content px-5 sm:px-8">
        <div className="grid grid-cols-2 gap-8 py-14 md:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-stone-600">
              {EDITORIAL_UI_ENABLED
                ? 'Role-specific work evidence for engineering hiring. AI allowed. Humans decide.'
                : 'Role-specific work evidence for engineering hiring. Review the work, keep the decision human.'}
            </p>
            <div className="mt-6 flex items-center gap-2">
              <a
                href={LINKEDIN_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Touchstones on LinkedIn"
                className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-stone-500 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                <Linkedin size={16} />
              </a>
              <a
                href={`mailto:${HELP_EMAIL}`}
                aria-label="Email Touchstones"
                className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-stone-500 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                <Mail size={16} />
              </a>
            </div>
            <a
              href={`mailto:${HELP_EMAIL}`}
              className="mt-4 inline-block text-sm font-medium text-stone-600 transition-colors hover:text-brand-700"
            >
              {HELP_EMAIL}
            </a>
          </div>

          {/* Link columns */}
          {cols.map((c) => (
            <div key={c.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                {c.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.hash ? (
                      <HashLink
                        to={l.to}
                        className="text-sm text-stone-600 transition-colors hover:text-brand-700"
                      >
                        {l.label}
                      </HashLink>
                    ) : (
                      <Link
                        to={l.to}
                        className="text-sm text-stone-600 transition-colors hover:text-brand-700"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-start justify-between gap-3 border-t border-stone-200 py-6 text-xs text-stone-500 sm:flex-row sm:items-center">
          <p>© 2026 Touchstones, Inc. All rights reserved.</p>
          <p className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Real work. Reviewable evidence. Human decisions.
          </p>
        </div>
      </div>
    </footer>
  )
}
