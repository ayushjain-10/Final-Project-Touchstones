import LegalPage, { LegalSection, LegalList } from '../../components/LegalPage.jsx'

export default function Privacy() {
  return (
    <LegalPage
      kicker="Legal"
      title="Privacy Policy"
      updated="June 25, 2026"
      intro="We're a trust company, so we'll be plain about this: here's exactly what we collect, why, and the control you have over it. No dark patterns, no surveillance theater."
    >
      <LegalSection title="Who we are">
        <p>
          This policy describes how Touchstones, Inc. ("Touchstones," "we," "us") handles personal
          information across our website at touchstones.ai and, once live, the Touchstones product.
          Touchstones is verified real-work screening for engineering hiring.
        </p>
        <p>
          Questions or requests? Email us any time at{' '}
          <a href="mailto:support@touchstones.ai" className="font-medium text-clay-700 underline">
            support@touchstones.ai
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Information we collect">
        <p>
          <strong className="text-ink">Waitlist &amp; demo requests.</strong> When you join the
          waitlist or request a demo, we collect what you give us:
        </p>
        <LegalList
          items={[
            'Your email address (required).',
            'Optionally: your name, company, and role.',
            'Optionally: a message and how you heard about us (referral source).',
          ]}
        />
        <p>
          We use this only to contact you about early access, to respond to your request, and to
          understand who our audience is. We do not sell it.
        </p>
        <p>
          <strong className="text-ink">Product data (once live).</strong> When the Touchstones
          product launches, screening will involve:
        </p>
        <LegalList
          items={[
            'The work a candidate submits for a screen.',
            'Derived behavioral signals during the screen (for example, typed-vs-pasted, tab focus, and timing) used to attribute proof-of-human.',
            'Basic environment metadata the server observes, and the score, reasoning, and evidence we generate.',
          ]}
        />
      </LegalSection>

      <LegalSection title="What we never collect">
        <p>Some lines we will not cross, by design:</p>
        <LegalList
          items={[
            'No biometrics — no face scans, no fingerprints, no voiceprints, no identity matching, no emotion inference.',
            'No raw video or audio recordings of candidates. On screens an employer marks as camera-required, your camera and microphone are used as a live presence signal only: nothing is recorded, stored, or transmitted, and no frame ever leaves your browser.',
            'No raw keystroke logging — we derive aggregate behavioral signals, not a transcript of your typing.',
            'No social media, browsing history, or off-platform activity.',
            'No identity proof a candidate self-reports.',
          ]}
        />
        <p>
          Proof-of-human is behavioral and server-attributed. It is about the integrity of the work
          session, not surveillance of the person.
        </p>
      </LegalSection>

      <LegalSection title="How we use information">
        <LegalList
          items={[
            'To contact you about early access, demos, and the launch.',
            'To operate, secure, and improve the website and (once live) the product.',
            'To generate explainable screening results for hiring teams who run a screen.',
            'To comply with legal obligations and enforce our terms.',
          ]}
        />
        <p>
          We do not sell personal information, and we do not use it for advertising or to train
          third-party models.
        </p>
      </LegalSection>

      <LegalSection title="How we store and protect it">
        <p>
          Waitlist and product data is stored on Supabase (Postgres) with row-level security and
          least-privilege access. Data is encrypted in transit (TLS) and at rest. Secrets are
          managed outside the codebase, and access is limited to people who need it.
        </p>
      </LegalSection>

      <LegalSection title="Sharing">
        <p>
          We share personal information only with service providers who help us run Touchstones (for
          example, our database and email providers), under contracts that limit how they may use
          it; and where required by law. Screening results are shared with the hiring team that ran
          the screen.
        </p>
      </LegalSection>

      <LegalSection title="Your rights (GDPR &amp; CCPA)">
        <p>
          Depending on where you live, you have rights over your personal information, including the
          right to:
        </p>
        <LegalList
          items={[
            'Access the personal information we hold about you.',
            'Correct inaccurate information.',
            'Delete your information ("right to be forgotten").',
            'Object to or restrict certain processing.',
            'Port your information to another service.',
            'Opt out of any sale of personal information — note that we do not sell it.',
          ]}
        />
        <p>
          To exercise any of these, email{' '}
          <a href="mailto:support@touchstones.ai" className="font-medium text-clay-700 underline">
            support@touchstones.ai
          </a>{' '}
          and we'll action it. Candidate data is deletable on request.
        </p>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We keep waitlist information until you ask us to remove it or it's no longer needed for
          the purpose it was collected. You can unsubscribe or request deletion at any time.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          We may update this policy as Touchstones grows from a waitlist into a live product. When
          we make material changes, we'll update the date above and, where appropriate, notify you.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Email{' '}
          <a href="mailto:support@touchstones.ai" className="font-medium text-clay-700 underline">
            support@touchstones.ai
          </a>{' '}
          with any privacy question or request. We answer plainly.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
