import LegalPage, { LegalSection, LegalList } from '../../components/LegalPage.jsx'
import Seo from '../../components/Seo.jsx'

const SUPPORT_EMAIL = 'support@touchstones.ai'

// The honest scope of what our tamper-evident record proves — and what it does not.
// This page is used verbatim in demos; every sentence is scoped to what the code actually
// does (per-submission SHA-256 hash chain over server-observed integrity signals). We would
// rather lose a deal than overclaim the mechanism.
export default function ThreatModel() {
  return (
    <>
      <Seo
        title="Threat model"
        description="Exactly what the Touchstones integrity record proves — a continuous, untampered work session — and what it does not: it does not verify which human, and will not, today, catch a skilled human proxy."
      />
      <LegalPage
        kicker="Trust"
        title="What our integrity record proves — and what it doesn't"
        updated="July 1, 2026"
        intro="A trust product has to be precise about its own limits. Here is exactly what the tamper-evident record proves, and exactly where it stops. If a vendor tells you a system with no camera catches every impostor, they are overclaiming — and that overclaim is the integrity gap we exist to close."
      >
        <LegalSection title="The mechanism, in plain terms">
          <p>
            During a screen, Touchstones records a per-submission{' '}
            <strong className="text-ink">integrity signal log</strong> and seals it as an
            append-only, SHA-256 <strong className="text-ink">hash chain</strong>. Each entry links
            cryptographically to the one before it, so the log cannot be reordered, edited, or
            truncated after the fact without breaking the chain. The database enforces this too: the
            integrity table rejects any update or delete.
          </p>
          <p>
            Because the chain is recomputable from its genesis, Touchstones — and, through the public
            Verify API, an auditor — can re-derive it independently and detect tampering{' '}
            <em>without trusting the stored hashes</em>.
          </p>
        </LegalSection>

        <LegalSection title="What the chain covers">
          <p>The trust record weights only signals the server itself observed during the session:</p>
          <LegalList
            items={[
              'When the tab or window loses and regains focus.',
              'Paste events, and how many characters were pasted versus typed.',
              'An automation / bot verdict (server-attested).',
              'Where enabled, liveness and structured interview-probe checks.',
            ]}
          />
          <p>
            The candidate&apos;s AI-assistant transcript — every prompt, and whether each suggestion
            was accepted, edited, or rejected — and a rollup of in-editor activity are captured in
            append-only logs <strong className="text-ink">alongside</strong> the chain and shown in
            the reviewer&apos;s record. Anything a candidate&apos;s browser self-reports is displayed
            for context but is <strong className="text-ink">never counted</strong> as proof; only
            server-observed signals carry weight in the trust digest.
          </p>
        </LegalSection>

        <LegalSection title="What it proves">
          <p>
            That the integrity log is <strong className="text-ink">continuous and untampered</strong>{' '}
            — that a single, uninterrupted work session, not an after-the-fact edit or a
            stitched-together record, produced the submission. The head of the chain is a signable
            per-submission trust digest that travels with the credential.
          </p>
        </LegalSection>

        <LegalSection title="What it does NOT prove">
          <LegalList
            items={[
              'It does not verify WHICH human was at the keyboard.',
              'On its own, it will not — today — catch a skilled human proxy: someone who sits a genuine, un-automated session on another person’s behalf.',
              'It is not a biometric identity check, and by design never will be — no face scan, no voiceprint, no identity matching. A camera-required screen asks for the camera as a live presence signal only; it is never analysed, recorded, or matched against anyone.',
            ]}
          />
          <p>
            This is the honest boundary. We say it in every demo because pretending otherwise is the
            exact failure we accuse surveillance-first vendors of.
          </p>
        </LegalSection>

        <LegalSection title="How to close the gap today">
          <p>
            Pair the integrity record with your existing identity step — an ID check, a verified
            work email or ATS identity, or a short live interview for finalists. Touchstones tells
            you the work was continuous and human-authored and shows you exactly how the candidate
            used AI; your identity step binds it to a specific person.
          </p>
        </LegalSection>

        <LegalSection title="Our named next phase">
          <p>
            Consent-based, <strong className="text-ink">biometric-free verified sessions</strong> are
            the next phase, not a shipped claim. The architecture decision record is being published
            so you can see the design before it is built. We will not describe it as available until
            it is.
          </p>
        </LegalSection>

        <LegalSection title="Questions">
          <p>
            We answer plainly. Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-clay-700 underline">
              {SUPPORT_EMAIL}
            </a>{' '}
            and we&apos;ll walk you through the mechanism in as much detail as you want.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  )
}
