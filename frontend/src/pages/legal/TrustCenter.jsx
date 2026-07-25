import { Link } from 'react-router-dom'
import LegalPage, { LegalSection, LegalList } from '../../components/LegalPage.jsx'
import Seo from '../../components/Seo.jsx'

const SUPPORT_EMAIL = 'support@touchstones.ai'

// The buyer-facing trust reference: where data lives, how it's protected, how retention and
// deletion actually work, how to get it out, and our continuity commitment. Every posture claim
// here is scoped to what the code does — no certifications we don't hold, no encryption we don't do.
export default function TrustCenter() {
  return (
    <>
      <Seo
        title="Trust & data"
        description="Where Touchstones stores your data, how it's encrypted, our sub-processors, retention and deletion, data export, and our business-continuity commitment — stated precisely."
      />
      <LegalPage
        kicker="Trust"
        title="Trust &amp; data"
        updated="July 1, 2026"
        intro="The reference a CTO or security reviewer asks for first: where data lives, how it's protected, who else touches it, and how you get it back or delete it. We state only what we actually do."
      >
        <LegalSection title="Where your data lives">
          <p>
            Touchstones runs on a small, US-based stack. Your account, screens, candidate
            submissions, scores, and audit records are stored in a managed Postgres database
            (Supabase). The web app is served from Vercel; the backend runs on Render. Candidate code
            executes in an isolated, single-use sandbox (E2B) that never has access to our
            environment or credentials.
          </p>
          <p>
            The full list of third parties that process data on our behalf — and what each is used
            for — is on our{' '}
            <Link to="/subprocessors" className="font-medium text-clay-700 underline">
              sub-processors page
            </Link>
            .
          </p>
        </LegalSection>

        <LegalSection title="Encryption &amp; access">
          <LegalList
            items={[
              'In transit: everything is served over TLS.',
              'At rest: the database is encrypted at rest by the platform, and access is gated by row-level security (RLS) and least-privilege service credentials — a candidate’s API calls cannot read another tenant’s data.',
              'Application-level: secrets we must store (for example, a customer’s outbound ATS API key) are sealed with AES-256-GCM authenticated encryption using a dedicated key, and are never written to logs in plaintext.',
              'Keys are held as environment secrets, kept separate from source code, and can be rotated.',
            ]}
          />
          <p className="text-sm text-stone-500">
            To be precise: candidate work product is protected by database-level at-rest encryption
            and RLS, not by per-field application encryption. We would rather tell you exactly what we
            do than imply more.
          </p>
        </LegalSection>

        <LegalSection title="Data retention &amp; deletion">
          <p>
            Candidates can export their own data and request deletion from inside the product. When a
            deletion is requested we do one of two things, automatically and atomically:
          </p>
          <LegalList
            items={[
              'If the candidate has no scored submission, we hard-delete the account and all associated data.',
              'If the candidate has a scored submission, we anonymize: we scrub every personal identifier and all free text — the submitted work, AI prompts, interview answers, and profile details — and retain only the numeric scores and the tamper-evident hash record, which contain no personal data. This preserves the integrity of hiring decisions already made while removing the person.',
            ]}
          />
          <p>
            Employer (customer) data is deletable on request. Our Data Processing Agreement sets the
            deletion timeline and the handling of records bound to an immutable audit chain
            (anonymization rather than destruction, so a prior hiring decision stays defensible).
          </p>
        </LegalSection>

        <LegalSection title="Getting your data out">
          <LegalList
            items={[
              'Candidates: a self-serve JSON export of their profile, submissions, and credentials.',
              'Employers: a per-decision and per-role defensibility export — the rubric, per-criterion points and evidence, the code-computed score, the proof-of-human state, and a reference into the audit chain.',
            ]}
          />
        </LegalSection>

        <LegalSection title="Business continuity">
          <p>
            We are a young company and we do not hide it. If Touchstones ceases operation, we commit
            to providing a full export of your screens, rubrics, candidate results, and audit records,
            and to keeping your data accessible for at least 30 days so nothing is stranded. This
            commitment is written into the pilot agreement.
          </p>
        </LegalSection>

        <LegalSection title="What we never do">
          <LegalList
            items={[
              'No biometrics — no face scan, fingerprint, voiceprint, identity matching, or emotion inference. Camera-required screens use the camera as a live presence signal only; nothing is recorded or stored.',
              'No emotion or affect inference.',
              'No selling of personal data; no advertising use.',
              'We do not use your or your candidates’ data to train third-party models.',
            ]}
          />
          <p>
            How our integrity record works — and its honest limits — is documented on our{' '}
            <Link to="/threat-model" className="font-medium text-clay-700 underline">
              threat-model page
            </Link>
            .
          </p>
        </LegalSection>

        <LegalSection title="What we don't have yet">
          <p>
            We are pre-certification: we do not hold a SOC 2 or ISO 27001 report today, and we will
            not imply otherwise. We are happy to walk a security reviewer through our architecture,
            data flows, and sub-processors directly, and to countersign a DPA.
          </p>
        </LegalSection>

        <LegalSection title="Talk to us">
          <p>
            For a Data Processing Agreement, a sub-processor-change notice, or a security review,
            email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-clay-700 underline">
              {SUPPORT_EMAIL}
            </a>
            . See also our{' '}
            <Link to="/privacy" className="font-medium text-clay-700 underline">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link to="/subprocessors" className="font-medium text-clay-700 underline">
              sub-processors
            </Link>
            .
          </p>
        </LegalSection>
      </LegalPage>
    </>
  )
}
