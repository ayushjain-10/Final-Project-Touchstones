import LegalPage, { LegalSection, LegalList } from '../../components/LegalPage.jsx'

export default function Terms() {
  return (
    <LegalPage
      kicker="Legal"
      title="Terms of Service"
      updated="June 25, 2026"
      intro="Touchstones is in a pre-launch / private beta phase. These terms cover your use of this website and the early-access waitlist. They're written to be readable — not to trap you."
    >
      <LegalSection title="Agreement to terms">
        <p>
          By accessing touchstones.ai or joining the waitlist, you agree to these Terms of Service.
          If you don't agree, please don't use the site. "Touchstones," "we," and "us" mean
          Touchstones, Inc.
        </p>
      </LegalSection>

      <LegalSection title="Pre-launch &amp; beta status">
        <p>
          The Touchstones product is not yet generally available. This website is a pre-launch
          marketing site that lets you join a waitlist and request a demo. Joining the waitlist does
          not guarantee access, pricing, timing, or any specific feature. Everything described as
          "coming" is a statement of intent and may change.
        </p>
        <p>
          If and when you're invited into a private beta, that access may be governed by an
          additional agreement, and beta software may be incomplete, change without notice, or be
          withdrawn.
        </p>
      </LegalSection>

      <LegalSection title="Use of the site">
        <p>You agree to use the site lawfully and not to:</p>
        <LegalList
          items={[
            'Submit information that is false, or that you don’t have the right to share.',
            'Attempt to disrupt, probe, or gain unauthorized access to the site or its data.',
            'Use the site to send spam or for any unlawful purpose.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Information you submit">
        <p>
          When you submit your email or a message, you confirm the information is accurate and that
          you're authorized to provide it. We handle it as described in our{' '}
          <a href="/privacy" className="font-medium text-clay-700 underline">
            Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Intellectual property">
        <p>
          The Touchstones name, logo, site content, and design are owned by Touchstones, Inc. You may
          not copy, reproduce, or use them without our permission, except as allowed by law.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          The site and any pre-launch materials are provided <strong className="text-ink">“as is”
          </strong> and <strong className="text-ink">“as available,”</strong> without warranties of
          any kind, whether express or implied, including fitness for a particular purpose and
          non-infringement. We don't warrant that the site will be uninterrupted, error-free, or
          secure, or that any described feature will ship.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Touchstones will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of data, arising out
          of or related to your use of the site or the waitlist.
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          We may update these terms as we move from waitlist to launch. The "last updated" date
          above reflects the current version. Continued use of the site after changes means you
          accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="Governing terms">
        <p>
          These terms are governed by the laws of the State of Delaware, United States, without
          regard to conflict-of-laws rules. Any dispute will be resolved in the state or federal
          courts located in Delaware, and you consent to that jurisdiction.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms? Email{' '}
          <a href="mailto:support@touchstones.ai" className="font-medium text-clay-700 underline">
            support@touchstones.ai
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
