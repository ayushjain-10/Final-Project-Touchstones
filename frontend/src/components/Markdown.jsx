// Lightweight Markdown renderer — no external dependency (keeps the bundle + Vercel build clean).
// Covers what our task briefs and AI replies actually use: headings, bold/italic, inline code,
// fenced code blocks (as real code boxes), ordered/unordered lists, links, and paragraphs. Renders
// with the terracotta/ink design system, dark-mode aware. Rendering markdown is the fix for briefs
// showing raw `#`, `**`, backticks, and list dashes as literal text.

// Only allow safe link targets: http(s), mailto, or a same-origin relative path (/x, not //host).
// Brief + AI content is authored/model-generated (untrusted), so an [x](javascript:…) or protocol-
// relative //host link must never render as a live link — return null → the label shows as text.
function safeHref(href) {
  const h = String(href || '').trim()
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h
  if (/^\/[^/]/.test(h)) return h
  return null
}

function inline(text, keyPrefix) {
  const nodes = []
  let last = 0
  let k = 0
  // Order matters: inline code first so ** / _ inside code isn't parsed.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (m[1]) {
      nodes.push(
        <code
          key={`${keyPrefix}-${k++}`}
          className="rounded bg-stone-200/70 px-1.5 py-0.5 font-mono text-[0.85em] text-ink dark:bg-[#25304D] dark:text-[#C8CEFA]"
        >
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (m[2]) {
      nodes.push(
        <strong key={`${keyPrefix}-${k++}`} className="font-semibold text-ink dark:text-[#F4F6FF]">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (m[3]) {
      const mm = tok.match(/\[([^\]]+)\]\(([^)\s]+)\)/)
      const href = safeHref(mm[2])
      if (!href) {
        nodes.push(mm[1]) // unsafe scheme (javascript:, //host, …) → plain text, never a link
      } else {
        const external = /^https?:\/\//i.test(href)
        nodes.push(
          <a
            key={`${keyPrefix}-${k++}`}
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="font-medium text-clay-700 underline underline-offset-2 hover:text-clay-800 dark:text-[#9DA9EF]"
          >
            {mm[1]}
          </a>,
        )
      }
    } else if (m[4]) {
      nodes.push(
        <em key={`${keyPrefix}-${k++}`} className="italic">
          {tok.slice(1, -1)}
        </em>,
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function parseBlocks(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      const buf = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i += 1
      }
      i += 1 // skip closing fence
      blocks.push({ type: 'code', lang, content: buf.join('\n') })
      continue
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i += 1
      continue
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] })
      i += 1
      continue
    }

    // Unordered list (consecutive - or * items)
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // Ordered list (consecutive 1. 2. …)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // Paragraph (accumulate until blank / special line)
    const buf = [line]
    i += 1
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'p', text: buf.join(' ') })
  }
  return blocks
}

export default function Markdown({ source = '', className = '' }) {
  const blocks = parseBlocks(source)
  const headingClass = {
    1: 'font-serif text-lg font-semibold text-ink dark:text-[#F4F6FF]',
    2: 'font-serif text-base font-semibold text-ink dark:text-[#F4F6FF]',
    3: 'text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-[#AEB7D0]',
  }
  return (
    <div className={`space-y-3 text-sm leading-relaxed text-stone-700 dark:text-[#D4D9E8] ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-xl border border-stone-200 bg-stone-50 p-3.5 text-[13px] leading-relaxed dark:border-[#25304D] dark:bg-[#090E1C]"
            >
              <code className="font-mono text-ink dark:text-[#D4D9E8]">{b.content}</code>
            </pre>
          )
        }
        if (b.type === 'heading') {
          const cls = headingClass[b.level] || headingClass[3]
          return (
            <p key={i} className={`${b.level <= 2 ? 'mt-1' : 'mt-2'} ${cls}`}>
              {inline(b.text, `h${i}`)}
            </p>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `ul${i}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `ol${i}-${j}`)}</li>
              ))}
            </ol>
          )
        }
        return <p key={i}>{inline(b.text, `p${i}`)}</p>
      })}
    </div>
  )
}
