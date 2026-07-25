import Button from './Button.jsx'
import EvidenceNetwork from './EvidenceNetwork.jsx'
import Reveal from './Reveal.jsx'
import { ArrowRight } from './icons.jsx'
import { Container } from './primitives.jsx'

export const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

export function EditorialHero({
  eyebrow,
  title,
  lede,
  noteLabel,
  note,
  primary,
  secondary,
  children,
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-brand-400/20 bg-evidence-dark text-white">
      <EvidenceNetwork theme="dark" density="sparse" className="opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f1c]/95 via-[#0b0f1c]/80 to-brand-950/35" />
      <Container className="relative py-16 sm:py-20 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)] lg:items-end">
          <Reveal>
            <p className="font-serif text-sm italic text-brand-200">{eyebrow}</p>
            <h1 className="mt-5 max-w-4xl text-balance font-serif text-4xl font-semibold leading-[1.02] text-white sm:text-5xl lg:text-6xl">
              {title}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-stone-300 sm:text-lg">{lede}</p>
            {(primary || secondary) && (
              <div className="mt-8 flex flex-wrap gap-3">
                {primary && (
                  <Button
                    to={primary.to}
                    href={primary.href}
                    variant="primary"
                    className="px-6 py-3 text-base"
                  >
                    {primary.label} <ArrowRight size={17} />
                  </Button>
                )}
                {secondary && (
                  <Button
                    to={secondary.to}
                    href={secondary.href}
                    variant="ghost"
                    className="border-white/25 px-6 py-3 text-base text-white hover:border-white/50 hover:bg-white/10"
                  >
                    {secondary.label}
                  </Button>
                )}
              </div>
            )}
          </Reveal>

          <Reveal delay={100}>
            <aside className="border-l border-brand-300/35 pl-6 sm:pl-8">
              {noteLabel && (
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-brand-200">
                  {noteLabel}
                </p>
              )}
              {note && <p className="mt-3 text-base leading-relaxed text-stone-200">{note}</p>}
              {children}
            </aside>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

export function EditorialHeading({ eyebrow, title, lede, className = '' }) {
  return (
    <div className={`max-w-3xl ${className}`}>
      <p className="font-serif text-sm italic text-brand-600">{eyebrow}</p>
      <h2 className="mt-3 text-balance font-serif text-3xl font-semibold leading-[1.08] sm:text-4xl">
        {title}
      </h2>
      {lede && <p className="mt-4 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">{lede}</p>}
    </div>
  )
}

export function EditorialCta({
  eyebrow = 'Design-partner cohort',
  title,
  body,
  primary = { label: 'Start a pilot', to: '/contact' },
  secondary,
}) {
  return (
    <section className="relative isolate overflow-hidden border-y border-brand-400/20 bg-evidence-dark text-white">
      <EvidenceNetwork theme="dark" density="sparse" interactive={false} className="opacity-55" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b0f1c]/95 via-[#111744]/80 to-[#0b0f1c]/90" />
      <Container className="relative py-16 sm:py-20">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="font-serif text-sm italic text-brand-200">{eyebrow}</p>
            <h2 className="mt-3 max-w-3xl text-balance font-serif text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {title}
            </h2>
            {body && <p className="mt-4 max-w-2xl leading-relaxed text-stone-300">{body}</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              to={primary.to}
              href={primary.href}
              variant="primary"
              className="px-6 py-3 text-base"
            >
              {primary.label} <ArrowRight size={17} />
            </Button>
            {secondary && (
              <Button
                to={secondary.to}
                href={secondary.href}
                variant="ghost"
                className="border-white/25 px-6 py-3 text-base text-white hover:border-white/50 hover:bg-white/10"
              >
                {secondary.label}
              </Button>
            )}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
