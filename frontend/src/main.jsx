import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initAnalytics } from './services/analytics.js'
import { hasAnalyticsConsent } from './components/CookieConsent.jsx'
import './index.css'

// No-op unless VITE_AMPLITUDE_API_KEY is set (funnel: author → send → complete → score → advance).
// Privacy default: only initialize once the visitor has accepted analytics cookies. New visitors
// see the consent banner (CookieConsent), which initializes analytics on Accept.
if (hasAnalyticsConsent()) initAnalytics()

// Version-skew self-heal (TOU-153): a long-lived SPA tab keeps executing the bundle it loaded
// with, and after a deploy its lazy chunks 404 (hashed filenames changed). Vite surfaces that as
// vite:preloadError; one hard reload picks up the current deployment. The sessionStorage guard
// prevents a reload loop if the failure is not deploy-skew.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('ts-skew-reloaded')) return
  sessionStorage.setItem('ts-skew-reloaded', '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => sessionStorage.removeItem('ts-skew-reloaded'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
