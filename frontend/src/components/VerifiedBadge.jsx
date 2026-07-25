import { FileText, Eye, Flag } from './icons.jsx'

// Session assurance state. Behavioral signals are advisory and never an automated decision.
const STATES = {
  verified: {
    icon: FileText,
    label: 'Session record',
    tone: 'bg-brand-50 text-brand-700 border-brand-200',
  },
  review: {
    icon: Eye,
    label: 'Review suggested',
    tone: 'bg-warning-50 text-warning-700 border-warning-100',
  },
  flagged: {
    icon: Flag,
    label: 'Integrity flag',
    tone: 'bg-danger-50 text-danger-700 border-danger-100',
  },
}

export default function VerifiedBadge({ state = 'verified', size = 'md', className = '' }) {
  const s = STATES[state] || STATES.verified
  const Icon = s.icon
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${s.tone} ${pad} ${className}`}
    >
      <Icon size={size === 'sm' ? 14 : 16} />
      {s.label}
    </span>
  )
}
