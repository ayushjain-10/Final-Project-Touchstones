import { Container, Kicker } from './primitives.jsx'
import Reveal from './Reveal.jsx'

// Shared shell for legal / policy pages: a warm header, a generous prose
// column, and a consistent type scale that matches the marketing site.
export default function LegalPage({ kicker, title, updated, intro, children }) {
  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-16">
          <Reveal>
            <Kicker className="mb-5">{kicker}</Kicker>
            <h1 className="max-w-2xl text-balance font-serif text-4xl font-semibold leading-[1.08] sm:text-5xl">
              {title}
            </h1>
            {intro && (
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600">{intro}</p>
            )}
            {updated && (
              <p className="mt-5 text-sm text-stone-400">Last updated: {updated}</p>
            )}
          </Reveal>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-3xl">
          <div className="legal-prose space-y-10">{children}</div>
        </Container>
      </section>
    </>
  )
}

// A titled section within a legal page.
export function LegalSection({ title, children }) {
  return (
    <div>
      <h2 className="font-serif text-2xl font-semibold leading-tight text-ink">{title}</h2>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-stone-700">{children}</div>
    </div>
  )
}

// A simple bulleted list with on-brand markers.
export function LegalList({ items }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={typeof it === 'string' ? it : it.key} className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-clay-400" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}
