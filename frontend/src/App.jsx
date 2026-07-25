import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { useEffect } from 'react'

import { useAuth } from './context/AuthContext.jsx'
import MarketingLayout from './layouts/MarketingLayout.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import CandidateLayout from './layouts/CandidateLayout.jsx'

// Marketing
import Home from './pages/marketing/Home.jsx'
import Product from './pages/marketing/Product.jsx'
import Pricing from './pages/marketing/Pricing.jsx'
import Resources from './pages/marketing/Resources.jsx'
import Blog from './pages/marketing/Blog.jsx'
import BlogPost from './pages/marketing/BlogPost.jsx'
import About from './pages/marketing/About.jsx'
import Trust from './pages/marketing/Trust.jsx'
import Contact from './pages/marketing/Contact.jsx'

// Legal
import Privacy from './pages/legal/Privacy.jsx'
import Terms from './pages/legal/Terms.jsx'
import Accessibility from './pages/legal/Accessibility.jsx'
import Subprocessors from './pages/legal/Subprocessors.jsx'
import TrustCenter from './pages/legal/TrustCenter.jsx'
import ThreatModel from './pages/legal/ThreatModel.jsx'

// Help / status / 404
import FAQ from './pages/marketing/FAQ.jsx'
import Status from './pages/marketing/Status.jsx'
import NotFound from './pages/NotFound.jsx'
import CookieConsent from './components/CookieConsent.jsx'
import RouteSeo from './components/RouteSeo.jsx'

// In-app account settings
import Account from './pages/app/Account.jsx'

// In-app
import Dashboard from './pages/app/Dashboard.jsx'
import Result from './pages/app/Result.jsx'
import Library from './pages/app/Library.jsx'
import Activity from './pages/app/Activity.jsx'
import Team from './pages/app/Team.jsx'
import Developers from './pages/app/Developers.jsx'
import RecruiterRequests from './pages/app/RecruiterRequests.jsx' // founder-only recruiter approval queue
import Compliance from './pages/app/Compliance.jsx' // CC1 v3: Compliance & Adverse-Impact
import MvpBuildout from './pages/app/MvpBuildout.jsx'
// Consolidated tabbed surfaces (prod-prep IA merge): Author+AuthorAI, Insights+Benchmarks, Passport+Apply.
import { AuthorHub, InsightsHub, NetworkHub } from './pages/app/hubs.jsx'

// Candidate-facing
import Candidate from './pages/candidate/Candidate.jsx'
import CandidateHome from './pages/candidate/CandidateHome.jsx'
import RecruiterAccess from './pages/candidate/RecruiterAccess.jsx' // candidate → hiring-team upgrade request
import Results from './pages/candidate/Results.jsx'
import Credentials from './pages/candidate/Credentials.jsx'
import Profile from './pages/candidate/Profile.jsx'

// Public credential verification (no auth, always available)
import Verify from './pages/verify/Verify.jsx'

// Public API docs + interactive sandbox (no auth, always available)
import DocsApi from './pages/verify/DocsApi.jsx'
import PassportPublic from './pages/verify/PassportPublic.jsx' // S4: public, shareable candidate Passport
import ApplyPublic from './pages/verify/Apply.jsx' // CC3/v3: public "Apply with Touchstones" (no chrome, req-scoped)
import SampleReport from './pages/verify/SampleReport.jsx' // P0-3: public, shareable sample score report (no auth, static)
import DemoFeatures from './pages/verify/DemoFeatures.jsx' // ML project demo: cold-start calibration + four-fifths fairness (no auth, static)
import ClientReview from './pages/verify/ClientReview.jsx'
import Admin from './pages/admin/Admin.jsx' // founder admin dashboard (email-OTP gated; inert unless backend flag is on)
import VerifiedSessionsPreview from './pages/app/VerifiedSessionsPreview.jsx' // P2-1: flag-gated verified-session storyboard (static)

// Enterprise / platforms marketing (always available)
import Platforms from './pages/marketing/Platforms.jsx'

// Auth
import Login from './pages/auth/Login.jsx'
import ResetPassword from './pages/auth/ResetPassword.jsx'

// S1 Live AI Probe (cc1) — public candidate interview + recruiter console
import LiveProbe from './pages/probe/LiveProbe.jsx'
import ProbeConsole from './pages/app/ProbeConsole.jsx'

// Production shows the waitlist site only. The real app is gated behind
// VITE_APP_ENABLED — when it's not 'true', /app/* and /login redirect home.
const APP_ENABLED = import.meta.env.VITE_APP_ENABLED === 'true'

// P2-1 verified-session design storyboard — direct URL only, no nav entry, default OFF.
// The route only mounts when this flag is 'true'; otherwise the path 404s (invisible until it flips).
const VERIFIED_SESSIONS_PREVIEW = import.meta.env.VITE_VERIFIED_SESSIONS_PREVIEW === 'true'
const MVP_SKELETONS_ENABLED = import.meta.env.VITE_MVP_SKELETONS_ENABLED === 'true'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// Calm boot skeleton shown while the Supabase session resolves, so /app/* never
// flashes the authed shell (and fires unauthenticated 401s) before we know who
// the user is.
function AppBootSplash() {
  return (
    <div className="flex min-h-screen bg-paper">
      <div className="hidden h-screen w-60 shrink-0 border-r border-stone-200 bg-canvas/60 p-5 lg:block">
        <div className="h-7 w-28 animate-pulse rounded bg-stone-200/70" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-xl bg-stone-200/60" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <div className="h-8 w-64 animate-pulse rounded bg-stone-200/70" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-200/50" />
          ))}
        </div>
      </div>
    </div>
  )
}

// Gate the authenticated product. While the session resolves we show the boot
// skeleton; if Supabase is configured but there's no signed-in user, bounce to
// /login. When Supabase isn't configured at all we let the screens render their
// own "auth isn't configured" / empty states rather than trap the user.
function RequireAuth({ children }) {
  const { loading, user, configured } = useAuth()
  const location = useLocation()
  if (loading) return <AppBootSplash />
  // Preserve where the user was headed (e.g. /app/team?invite=<token>) so login can return
  // them there — otherwise a new teammate clicking an invite link loses the token at /login.
  if (configured && !user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

// Authorization gate for the recruiter product (`/app/*`). The REAL boundary is backend RLS +
// requireRecruiter (a candidate's API calls 403 regardless); this is the UX layer that keeps a
// candidate out of the recruiter shell entirely and routes them to their own portal. When Supabase
// isn't configured we don't gate (the screens render their own empty states).
function RequireRecruiter({ children }) {
  const { configured, roleLoaded, isRecruiter, profile } = useAuth()
  if (!configured) return children
  if (!roleLoaded) return <AppBootSplash />
  if (!isRecruiter) {
    const pending = profile?.recruiter_status === 'pending'
    return <Navigate to={pending ? '/candidate/home?pending=1' : '/candidate/home'} replace />
  }
  return children
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <RouteSeo />
      <CookieConsent />
      <Routes>
        {/* Public credential verification — OUTSIDE the app gate so a verify link
            works even when VITE_APP_ENABLED is not 'true'. No auth, no chrome. */}
        <Route path="/verify/:token" element={<Verify />} />

        {/* Public API docs + interactive sandbox — OUTSIDE the app gate (developer-facing,
            always reachable). No auth required; the sandbox accepts a test key. */}
        <Route path="/docs/api" element={<DocsApi />} />

        {/* S1 Live AI Probe — public candidate interview (token-gated, no auth). */}
        <Route path="/probe/:token" element={<LiveProbe />} />

        {/* S4: public, shareable candidate Passport — OUTSIDE the app gate (no auth, no chrome). */}
        <Route path="/passport/:handle" element={<PassportPublic />} />

        {/* CC3/v3: public "Apply with Touchstones" — OUTSIDE the app gate (req-scoped, no chrome). */}
        <Route path="/apply/:token" element={<ApplyPublic />} />

        {/* Client Review Portal: token-gated, no auth, no app chrome. */}
        <Route path="/client-review/:token" element={<ClientReview />} />

        {/* P0-3: public, shareable SAMPLE score report — OUTSIDE the app gate (no auth, static
            seeded data). The highest-ROI outreach artifact: every cold email links it. */}
        <Route path="/sample-report" element={<SampleReport />} />

        {/* ML project demo (course deliverable): cold-start calibration + subgroup fairness.
            Public, no auth, static seeded data — renders regardless of VITE_APP_ENABLED. */}
        <Route path="/demo/features" element={<DemoFeatures />} />

        {/* P2-1: flag-gated verified-session design STORYBOARD (static, no capture/backend).
            Direct URL only, no nav entry; mounts only when VITE_VERIFIED_SESSIONS_PREVIEW==='true'. */}
        {VERIFIED_SESSIONS_PREVIEW && (
          <Route path="/app/verified-sessions-preview" element={<VerifiedSessionsPreview />} />
        )}

        {/* Founder admin dashboard — OUTSIDE all gates by design: the backend 404s the entire
            /api/admin surface unless ADMIN_DASHBOARD_ENABLED + ADMIN_EMAIL are set, and the page
            itself is email-OTP gated. Direct URL only, no nav entry anywhere. */}
        <Route path="/admin" element={<Admin />} />

        {/* Marketing site */}
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/about" element={<About />} />
          <Route path="/trust" element={<Trust />} />
          <Route path="/platforms" element={<Platforms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          {/* Trust/help pages — always available (relevant on the waitlist site too) */}
          <Route path="/faq" element={<FAQ />} />
          <Route path="/status" element={<Status />} />
          <Route path="/accessibility" element={<Accessibility />} />
          <Route path="/subprocessors" element={<Subprocessors />} />
          <Route path="/trust-center" element={<TrustCenter />} />
          <Route path="/threat-model" element={<ThreatModel />} />
          {/* Pre-launch marketing pages kept available when the app is enabled */}
          {APP_ENABLED && (
            <>
              <Route path="/product" element={<Product />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/blog" element={<Blog />} />
              <Route path="/blog/:slug" element={<BlogPost />} />
            </>
          )}
        </Route>

        {APP_ENABLED ? (
          <>
            {/* In-app product — gated behind a real signed-in session */}
            <Route
              element={
                <RequireAuth>
                  <RequireRecruiter>
                    <AppLayout />
                  </RequireRecruiter>
                </RequireAuth>
              }
            >
              <Route path="/app" element={<Dashboard />} />
              <Route path="/app/result" element={<Result />} />
              <Route path="/app/author" element={<AuthorHub />} />{/* manual + ✦ Draft with AI tabs */}
              <Route path="/app/library" element={<Library />} />
              <Route path="/app/activity" element={<Activity />} />
              <Route path="/app/insights" element={<InsightsHub />} />{/* Funnel & ROI + Calibration tabs */}
              <Route path="/app/compliance" element={<Compliance />} />{/* CC1 v3 Compliance & Adverse-Impact */}
              <Route path="/app/probe" element={<ProbeConsole />} />{/* S1 Live AI Probe (cc1) */}
              <Route path="/app/network" element={<NetworkHub />} />{/* Passport + Apply & accept-prior tabs */}
              <Route path="/app/team" element={<Team />} />
              <Route path="/app/account" element={<Account />} />
              <Route path="/app/developers" element={<Developers />} />
              {MVP_SKELETONS_ENABLED && <Route path="/app/mvp-buildout" element={<MvpBuildout />} />}
              <Route path="/app/recruiter-requests" element={<RecruiterRequests />} />{/* founder-only (API-gated) */}
              {/* Old routes preserved — redirect into the merged surface's tab (no capability lost) */}
              <Route path="/app/author-ai" element={<Navigate to="/app/author?tab=ai" replace />} />
              <Route path="/app/benchmarks" element={<Navigate to="/app/insights?tab=calibration" replace />} />
              <Route path="/app/passport" element={<Navigate to="/app/network?tab=passport" replace />} />
              <Route path="/app/apply" element={<Navigate to="/app/network?tab=apply" replace />} />
            </Route>

            {/* Candidate experience (standalone) */}
            <Route element={<CandidateLayout />}>
              <Route path="/candidate" element={<Candidate />} />
              <Route
                path="/candidate/home"
                element={
                  <RequireAuth>
                    <CandidateHome />
                  </RequireAuth>
                }
              />
              <Route
                path="/candidate/results"
                element={
                  <RequireAuth>
                    <Results />
                  </RequireAuth>
                }
              />
              <Route
                path="/candidate/credentials"
                element={
                  <RequireAuth>
                    <Credentials />
                  </RequireAuth>
                }
              />
              <Route
                path="/candidate/profile"
                element={
                  <RequireAuth>
                    <Profile />
                  </RequireAuth>
                }
              />
              {/* Recruiter-access request — reachable signed-out (it prompts to sign up first)
                  AND signed-in (the request form / pending state). Not RequireAuth-gated. */}
              <Route path="/recruiter-access" element={<RecruiterAccess />} />
            </Route>

            {/* Auth (standalone, no chrome) */}
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </>
        ) : (
          // Waitlist-only mode: send app + auth routes back to the landing page.
          <>
            <Route path="/app/*" element={<Navigate to="/" replace />} />
            <Route path="/candidate" element={<Navigate to="/" replace />} />
            <Route path="/recruiter-access" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/reset-password" element={<Navigate to="/" replace />} />
          </>
        )}

        {/* Anything else → branded 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
