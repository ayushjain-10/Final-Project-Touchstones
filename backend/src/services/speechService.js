/**
 * Azure AI Speech — ephemeral token issuer for the verbal walkthrough (Azure services plan #5).
 * ----------------------------------------------------------------------------------------------
 * NO-SURVEILLANCE / NO-PERSISTENCE design: we never send candidate audio through our backend and we
 * never store audio OR transcripts. Instead this issues a SHORT-LIVED (10 min) Speech auth token so the
 * BROWSER streams mic audio directly to Azure Speech (real-time streaming STT), gets the transcript
 * in-page, and sends only the FINAL transcript TEXT to the probe scorer. The audio is ephemeral by
 * design (real-time streaming stores nothing at rest), and we persist only the score/flags.
 *
 * Constraints enforced by construction:
 *   - Flag-gated: no-op unless ENABLE_SPEECH_WALKTHROUGH=true AND AZURE_SPEECH_KEY/REGION are set.
 *   - Token, not key: the browser only ever sees a 10-minute STS token, never the subscription key.
 *   - Real-time streaming only (NOT batch transcription, which would store an audio file).
 *   - Never enable "Log content" on the resource; never use Speaker Recognition / voice-ID (biometric).
 */
const ENABLED = process.env.ENABLE_SPEECH_WALKTHROUGH === 'true';

function config() {
  const key = (process.env.AZURE_SPEECH_KEY || '').trim();
  const region = (process.env.AZURE_SPEECH_REGION || '').trim();
  return { key, region, ok: Boolean(key && region) };
}

// Mint a short-lived Speech auth token (region-scoped). Returns null when disabled/unconfigured.
async function issueToken() {
  if (!ENABLED) return null;
  const { key, region, ok } = config();
  if (!ok) return null;
  const resp = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
  });
  if (!resp.ok) throw new Error(`speech token issue failed: ${resp.status}`);
  const token = await resp.text();
  // Azure STS tokens are valid ~10 min; tell the client to refresh a bit early.
  return { token, region, expiresInSec: 540 };
}

module.exports = {
  issueToken,
  isEnabled: () => ENABLED && config().ok,
};
