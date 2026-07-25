import EvidenceNetwork from './EvidenceNetwork.jsx'
import Logo from './Logo.jsx'
import { Check, FileText, ShieldCheck, Sparkle } from './icons.jsx'

const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

const DEFAULT_POINTS = [
  { icon: FileText, text: 'Role-specific work replaces answer-only screening.' },
  { icon: Sparkle, text: 'Each screen states its AI policy before the work begins.' },
  { icon: ShieldCheck, text: 'Session signals support reviewers. Humans decide.' },
]

export default function AuthShell({
  children,
  eyebrow = 'Touchstones workspace',
  title = 'Review the work behind the answer.',
  body = 'Create real-work screens, inspect rubric-linked evidence, and keep every decision in human hands.',
  points = DEFAULT_POINTS,
}) {
  if (!EDITORIAL_UI_ENABLED) {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 px-5 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[0.92fr_1.08fr]">
      <aside className="relative overflow-hidden bg-evidence-dark px-6 py-8 text-white sm:px-10 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <EvidenceNetwork className="z-0 opacity-55" theme="dark" density="normal" />

        <div className="relative z-10">
          <Logo className="[&>span:last-child]:!text-white" />
        </div>

        <div className="relative z-10 mt-16 max-w-xl lg:my-auto lg:py-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-200">{eyebrow}</p>
          <h2 className="mt-5 text-balance font-sans text-4xl font-semibold leading-[0.98] tracking-[-0.045em] !text-white sm:text-5xl lg:text-6xl">
            {title}
          </h2>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-white/65 sm:text-lg">{body}</p>

          <div className="mt-8 divide-y divide-white/10 border-y border-white/10">
            {points.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 py-3.5 text-sm text-white/80">
                <span className="grid h-8 w-8 shrink-0 place-items-center border border-brand-300/30 bg-brand-500/15 text-brand-100">
                  <Icon size={15} />
                </span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 mt-12 inline-flex items-center gap-2 text-xs text-white/45 lg:mt-0">
          <Check size={14} className="text-brand-300" /> Real work. Reviewable evidence. Human decisions.
        </p>
      </aside>

      <main className="relative grid min-h-[42rem] place-items-center overflow-hidden px-5 py-12 sm:px-10 lg:min-h-screen">
        <EvidenceNetwork className="z-0 opacity-30" theme="light" density="sparse" interactive={false} />
        <div className="relative z-10 w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
