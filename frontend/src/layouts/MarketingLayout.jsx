import { Outlet, useLocation } from 'react-router-dom'
import MarketingNav from '../components/MarketingNav.jsx'
import MarketingFooter from '../components/MarketingFooter.jsx'
import ChatWidget from '../components/ChatWidget.jsx'
import ScrollProgressBar from '../components/ScrollProgressBar.jsx'
import EvidenceNetwork from '../components/EvidenceNetwork.jsx'

// The "Ask Touchstones" assistant is flag-gated (OFF by default) and only mounts on marketing pages.
const CHAT_ENABLED = import.meta.env.VITE_ENABLE_CHAT === 'true'
const EDITORIAL_UI_ENABLED = import.meta.env.VITE_EDITORIAL_UI_ENABLED === 'true'

export default function MarketingLayout() {
  const { pathname } = useLocation()
  const showAmbientNetwork = EDITORIAL_UI_ENABLED && pathname !== '/'

  return (
    <div className={`relative min-h-screen bg-paper ${EDITORIAL_UI_ENABLED ? 'bg-evidence-light' : ''}`}>
      <ScrollProgressBar />
      <MarketingNav />
      {showAmbientNetwork && (
        <div className="pointer-events-none fixed inset-0 z-0 opacity-25" aria-hidden="true">
          <EvidenceNetwork density="sparse" interactive={false} />
        </div>
      )}
      <main className="relative z-10">
        <Outlet />
      </main>
      <div className="relative z-10">
        <MarketingFooter />
      </div>
      {CHAT_ENABLED && <ChatWidget />}
    </div>
  )
}
