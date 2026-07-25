import { useParams, Link, Navigate } from 'react-router-dom'
import { Container, Kicker, Pill } from '../../components/primitives.jsx'
import Reveal from '../../components/Reveal.jsx'
import Seo from '../../components/Seo.jsx'
import { ArrowRight, ArrowUpRight, Clock } from '../../components/icons.jsx'
import { getPost, formatDate } from '../../content/blogPosts.js'

// Renders the lightweight block format from blogPosts.js: a string is a
// paragraph, { type: 'h2', text } is a serif subhead.
function PostBody({ blocks }) {
  return (
    <div className="space-y-6 text-lg leading-relaxed text-stone-700">
      {blocks.map((block, i) =>
        typeof block === 'string' ? (
          <p key={i}>{block}</p>
        ) : block.type === 'h2' ? (
          <h2 key={i} className="pt-4 font-serif text-2xl font-semibold text-ink">
            {block.text}
          </h2>
        ) : null,
      )}
    </div>
  )
}

export default function BlogPost() {
  const { slug } = useParams()
  const post = getPost(slug)
  // Unknown slug: bounce back to the index rather than render a broken page.
  if (!post) return <Navigate to="/blog" replace />

  return (
    <article>
      <Seo title={post.title} description={post.dek} />

      <section className="border-b border-stone-200 bg-grain">
        <Container className="max-w-3xl py-16">
          <Reveal>
            <Link
              to="/blog"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition-colors hover:text-clay-700"
            >
              <ArrowRight size={14} className="rotate-180" /> All posts
            </Link>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Pill tone="clay">{post.tag}</Pill>
              <span className="text-sm text-stone-400">{formatDate(post.date)}</span>
              <span className="inline-flex items-center gap-1.5 text-sm text-stone-400">
                <Clock size={14} /> {post.readingMins} min read
              </span>
            </div>
            <h1 className="mt-5 text-balance font-serif text-4xl font-semibold leading-[1.08] sm:text-[2.75rem]">
              {post.title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-stone-600">{post.dek}</p>
            <p className="mt-6 text-sm text-stone-500">By {post.author}</p>
          </Reveal>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-3xl">
          <Reveal>
            <PostBody blocks={post.body} />

            {post.sourceUrl && (
              <p className="mt-10 border-t border-stone-200 pt-6 text-sm text-stone-500">
                Source:{' '}
                <a
                  href={post.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-clay-700 hover:text-clay-800"
                >
                  {post.sourceLabel} <ArrowUpRight size={14} />
                </a>
              </p>
            )}

            <div className="mt-12">
              <Link
                to="/blog"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-clay-700 hover:text-clay-800"
              >
                <ArrowRight size={16} className="rotate-180" /> Back to all posts
              </Link>
            </div>
          </Reveal>
        </Container>
      </section>
    </article>
  )
}
