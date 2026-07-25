import { useLocation } from 'react-router-dom'
import Seo from './Seo.jsx'

// Central per-route <title> + meta description for the existing marketing/legal pages (so we don't
// have to thread a <Seo> into each). Pages that render their own <Seo> (FAQ, Status, legal extras,
// account, 404) simply aren't listed here and keep their page-level title. A null title falls back
// to the site-wide home title.
const MAP = {
  '/': { title: null, description: 'Role-specific work evidence for engineering hiring, with explicit AI policy, rubric-linked scoring, and session context for human review.' },
  '/about': { title: 'About & founder', description: 'Why Touchstones exists, who is building it, and the case for evidence-led engineering hiring.' },
  '/trust': { title: 'Trust & security', description: 'How Touchstones handles data and session integrity, with no identity matching, biometrics, or emotion inference.' },
  '/platforms': { title: 'For platforms', description: 'Embed verified, real-work screening into your hiring platform with the Touchstones Verify API.' },
  '/contact': { title: 'Contact', description: 'Get in touch with Touchstones for a pilot, design-partner conversation, or product question. A real person reads every message.' },
  '/pricing': { title: 'Pricing', description: 'Simple pricing for role-specific engineering screens. Start with a pilot and expand when the evidence model fits your team.' },
  '/product': { title: 'Product', description: 'See how Touchstones connects real work, AI direction, rubric scoring, and session context in one reviewable packet.' },
  '/resources': { title: 'Resources', description: 'Guides and thinking from the Touchstones team on hiring engineers in the age of AI.' },
  '/blog': { title: 'Blog', description: 'Notes on hiring in the AI era: what we are reading, what we are building, and why. From the Touchstones team.' },
  '/docs/api': { title: 'API docs', description: 'Use the Touchstones Verify API to inspect a candidate credential or embed real-work screening, with an interactive sandbox.' },
  '/privacy': { title: 'Privacy Policy', description: 'Exactly what Touchstones collects, why, and the control you have over your data. No dark patterns.' },
  '/terms': { title: 'Terms of Service', description: 'The terms governing use of the Touchstones website and product.' },
}

export default function RouteSeo() {
  const { pathname } = useLocation()
  const meta = MAP[pathname]
  if (!meta) return null
  return <Seo title={meta.title} description={meta.description} />
}
