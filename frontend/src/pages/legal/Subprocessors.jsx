import LegalPage, { LegalSection } from '../../components/LegalPage.jsx'
import Seo from '../../components/Seo.jsx'

const SUPPORT_EMAIL = 'support@touchstones.ai'

// The third parties that process data on our behalf. B2B buyers ask for this; keep it current.
// Verified against the codebase (package.json + services): hosting, sandboxed execution, the AI
// model + safety providers, email, billing, analytics, and observability.
const subprocessors = [
  { name: 'Supabase', purpose: 'Database, authentication, file storage', region: 'United States', url: 'https://supabase.com/privacy' },
  { name: 'Render', purpose: 'Backend application hosting', region: 'United States', url: 'https://render.com/privacy' },
  { name: 'Vercel', purpose: 'Website & frontend hosting / CDN', region: 'United States', url: 'https://vercel.com/legal/privacy-policy' },
  { name: 'E2B', purpose: 'Isolated sandbox that runs candidate code (single-use microVM per run)', region: 'United States', url: 'https://e2b.dev/privacy' },
  { name: 'Anthropic', purpose: 'AI model provider — grading (per-criterion points) & authoring assistance', region: 'United States', url: 'https://www.anthropic.com/legal/privacy' },
  { name: 'Microsoft Azure (OpenAI Service)', purpose: 'AI model provider for assistive features & embeddings', region: 'United States', url: 'https://learn.microsoft.com/legal/cognitive-services/openai/data-privacy' },
  { name: 'Microsoft Azure (AI Content Safety)', purpose: 'Prompt-injection defense on the grader (no candidate PII sent for identity)', region: 'United States', url: 'https://azure.microsoft.com/support/legal/' },
  { name: 'Resend', purpose: 'Transactional + product email delivery', region: 'United States', url: 'https://resend.com/legal/privacy-policy' },
  { name: 'Stripe', purpose: 'Billing & payment processing', region: 'United States', url: 'https://stripe.com/privacy' },
  { name: 'Amplitude', purpose: 'Product analytics (only with consent)', region: 'United States', url: 'https://amplitude.com/privacy' },
  { name: 'Sentry', purpose: 'Error monitoring', region: 'United States', url: 'https://sentry.io/privacy/' },
  { name: 'Datadog', purpose: 'Application & AI observability', region: 'United States', url: 'https://www.datadoghq.com/legal/privacy/' },
  { name: 'Google', purpose: 'Optional "Sign in with Google" (authentication only)', region: 'United States', url: 'https://policies.google.com/privacy' },
]

export default function Subprocessors() {
  return (
    <>
      <Seo
        title="Sub-processors"
        description="The third-party service providers Touchstones uses to process data on your behalf, what each is used for, and links to their privacy policies."
      />
      <LegalPage
        kicker="Legal"
        title="Sub-processors"
        updated="June 27, 2026"
        intro="The third parties that process data on our behalf to run Touchstones. Each operates under a contract that limits how they may use the data."
      >
        <LegalSection title="Current sub-processors">
          <div className="overflow-hidden rounded-2xl border border-stone-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-sand text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Provider</th>
                  <th className="px-4 py-3 font-semibold">Purpose</th>
                  <th className="px-4 py-3 font-semibold">Region</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {subprocessors.map((s) => (
                  <tr key={s.name} className="align-top">
                    <td className="px-4 py-3 font-medium text-ink">
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-clay-700 underline">
                        {s.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-stone-700">{s.purpose}</td>
                    <td className="px-4 py-3 text-stone-600">{s.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LegalSection>

        <LegalSection title="Changes & notice">
          <p>
            We update this list as our stack changes. For a data-processing agreement (DPA) or to be
            notified of new sub-processors, email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-clay-700 underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </LegalSection>
      </LegalPage>
    </>
  )
}
