import LegalPage, { LegalSection, LegalList } from '../../components/LegalPage.jsx'
import Seo from '../../components/Seo.jsx'

const SUPPORT_EMAIL = 'support@touchstones.ai'

export default function Accessibility() {
  return (
    <>
      <Seo
        title="Accessibility"
        description="Touchstones' commitment to an accessible product and website, our WCAG 2.1 AA target, known limitations, and how to report an accessibility barrier."
      />
      <LegalPage
        kicker="Legal"
        title="Accessibility statement"
        updated="June 27, 2026"
        intro="Hiring tools should work for everyone. Here's where we stand on accessibility, honestly — including what's still in progress."
      >
        <LegalSection title="Our commitment">
          <p>
            We aim to meet{' '}
            <a
              href="https://www.w3.org/WAI/WCAG21/quickref/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-clay-700 underline"
            >
              WCAG 2.1 Level AA
            </a>{' '}
            across the Touchstones website and product. Accessibility is part of how we build, not a
            bolt-on — we'd rather tell you plainly where we are than claim a badge we haven't earned.
          </p>
        </LegalSection>

        <LegalSection title="What we do today">
          <LegalList
            items={[
              'Semantic HTML and labelled, keyboard-operable controls.',
              'Visible focus states and a logical tab order.',
              'Color choices checked for contrast; we never rely on color alone to convey meaning.',
              'Respect for reduced-motion preferences.',
              'Alt text on meaningful images.',
            ]}
          />
        </LegalSection>

        <LegalSection title="Known limitations">
          <p>
            We're an early team and some areas are still being hardened — for example, complex
            interactive surfaces in the product and full screen-reader passes on every flow. We're
            actively improving these and welcome specific reports.
          </p>
        </LegalSection>

        <LegalSection title="Report a barrier">
          <p>
            If you hit an accessibility barrier — anywhere on the site or in a screen — email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-clay-700 underline">
              {SUPPORT_EMAIL}
            </a>
            . Tell us the page, what happened, and your assistive technology if relevant. We treat
            these as priority and will work with you on an accommodation in the meantime.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  )
}
