// Consolidated surfaces — each hosts two existing pages behind tabs (reuse, don't rewrite).
// Routes: /app/author (AuthorHub), /app/insights (InsightsHub), /app/network (NetworkHub).
// Old routes redirect into the right tab (see App.jsx).
import TabbedSurface from '../../components/TabbedSurface.jsx'
import { Plus, Sparkle, ArrowUpRight, Compass, Fingerprint, Link as NetworkIcon } from '../../components/icons.jsx'
import Author from './Author.jsx'
import AuthorAI from './AuthorAI.jsx'
import Insights from './Insights.jsx'
import Benchmarks from './Benchmarks.jsx'
import Passport from './Passport.jsx'
import ApplyHub from './Apply.jsx'

// 1.1 — one authoring surface: manual + ✦ Draft with AI.
export function AuthorHub() {
  return (
    <TabbedSurface
      tabs={[
        { key: 'manual', label: 'New screen', icon: Plus, el: <Author /> },
        { key: 'ai', label: 'Draft with AI', icon: Sparkle, el: <AuthorAI /> },
      ]}
    />
  )
}

// 1.2 — one analytics surface: Funnel & ROI + Calibration.
export function InsightsHub() {
  return (
    <TabbedSurface
      tabs={[
        { key: 'funnel', label: 'Funnel & ROI', icon: ArrowUpRight, el: <Insights /> },
        { key: 'calibration', label: 'Calibration', icon: Compass, el: <Benchmarks /> },
      ]}
    />
  )
}

// 1.3 — one network surface: Passport + Apply & accept-prior.
export function NetworkHub() {
  return (
    <TabbedSurface
      tabs={[
        { key: 'passport', label: 'Passport', icon: Fingerprint, el: <Passport /> },
        { key: 'apply', label: 'Apply & accept-prior', icon: NetworkIcon, el: <ApplyHub /> },
      ]}
    />
  )
}
