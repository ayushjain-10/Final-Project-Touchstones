import { Link } from 'react-router-dom'
import { Container, Kicker, Pill } from '../../components/primitives.jsx'
import Reveal from '../../components/Reveal.jsx'
import { ArrowRight, Clock } from '../../components/icons.jsx'
import { blogPosts, formatDate } from '../../content/blogPosts.js'

// Blog / news index. Same card + hero language as Resources so the marketing
// site reads as one system. Cards link to /blog/:slug.
export default function Blog() {
  return (
    <>
      <section className="border-b border-stone-200 bg-grain">
        <Container className="py-20">
          <Reveal>
            <Kicker className="mb-5">From the team</Kicker>
            <h1 className="max-w-3xl text-balance font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">
              Notes on hiring in the AI era.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              Short pieces on what we are reading, what we are building, and why. Written to be useful
              whether or not you ever use Touchstones.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {blogPosts.map((p, i) => (
              <Reveal key={p.slug} delay={(i % 3) * 90}>
                <Link
                  to={`/blog/${p.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-card transition-colors hover:border-clay-300"
                >
                  <div className="flex items-center justify-between">
                    <Pill tone="clay">{p.tag}</Pill>
                    <span className="inline-flex items-center gap-1.5 text-xs text-stone-400">
                      <Clock size={13} /> {p.readingMins} min read
                    </span>
                  </div>
                  <h2 className="mt-4 text-lg font-semibold leading-snug text-ink">{p.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{p.dek}</p>
                  <div className="mt-5 flex items-center justify-between border-t border-stone-100 pt-4">
                    <span className="text-xs text-stone-400">{formatDate(p.date)}</span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-clay-700 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5">
                      Read <ArrowRight size={14} />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>
    </>
  )
}
