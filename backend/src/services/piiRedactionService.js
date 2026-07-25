/**
 * Azure AI Language — PII redaction (Azure services plan #4).
 * ----------------------------------------------------------
 * Redacts personally-identifiable information from candidate free text BEFORE it is persisted
 * (written answers, AI-assist prompts, walkthrough notes). Defense-in-depth on top of "minimize what
 * we store + never persist raw media/transcripts" — it removes identity data, it does not enable new
 * storage. No-surveillance / honesty stance: strips PII, performs NO biometric or emotion inference.
 *
 * Design rules:
 *   - Flag-gated: no-op unless ENABLE_PII_REDACTION=true AND AZURE_LANGUAGE_ENDPOINT/KEY are set.
 *   - FAIL-OPEN: a redactor error must NEVER block a write. On any failure we return the ORIGINAL text
 *     and log it (a broken redactor degrades to "stored un-redacted", not "candidate can't submit").
 *   - Uses the already-installed @azure/ai-text-analytics client (recognizePiiEntities → .redactedText).
 *   - Chunks long inputs (the API caps a single document at ~5k chars) and rejoins.
 */
const { TextAnalyticsClient, AzureKeyCredential } = require('@azure/ai-text-analytics');

const ENABLED = process.env.ENABLE_PII_REDACTION === 'true';
const MAX_DOC_CHARS = 5000; // Azure Text Analytics single-document soft limit

let _client = null;
let _looked = false;
function getClient() {
  if (_looked) return _client;
  _looked = true;
  const endpoint = (process.env.AZURE_LANGUAGE_ENDPOINT || '').trim();
  const key = (process.env.AZURE_LANGUAGE_KEY || '').trim();
  if (!endpoint || !key) return (_client = null);
  try {
    _client = new TextAnalyticsClient(endpoint, new AzureKeyCredential(key));
  } catch (e) {
    console.warn('piiRedaction: client init failed:', e.message);
    _client = null;
  }
  return _client;
}

function chunk(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

// Redact PII from `text`. Returns the redacted string (or the original on any no-op / failure).
async function redact(text, { language = 'en' } = {}) {
  const input = String(text == null ? '' : text);
  if (!ENABLED || !input.trim()) return input;
  const client = getClient();
  if (!client) return input;
  try {
    const docs = chunk(input, MAX_DOC_CHARS);
    const results = await client.recognizePiiEntities(docs, language);
    const pieces = docs.map((_, i) => {
      const r = results[i];
      return r && !r.error && typeof r.redactedText === 'string' ? r.redactedText : docs[i];
    });
    return pieces.join('');
  } catch (e) {
    console.warn('piiRedaction: redact failed (returning original text):', e.message);
    return input; // fail-open
  }
}

module.exports = {
  redact,
  isEnabled: () => ENABLED && !!getClient(),
};
