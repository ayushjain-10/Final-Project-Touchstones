/**
 * piiRedactionService — dormant/no-op regression (Azure services plan #4).
 * ------------------------------------------------------------------------
 * The service is flag-gated (ENABLE_PII_REDACTION) and FAIL-OPEN: with the flag unset it
 * must be a pure no-op — redact() returns the input text UNCHANGED and isEnabled() is
 * false. This guards the invariant that a broken/unconfigured redactor can never block a
 * candidate write (it degrades to "stored un-redacted", never "can't submit"). Runs with
 * no network: the disabled path never constructs the Azure client.
 */
describe('piiRedactionService (dormant / fail-open)', () => {
  const FLAG = 'ENABLE_PII_REDACTION';
  const CREDS = ['AZURE_LANGUAGE_ENDPOINT', 'AZURE_LANGUAGE_KEY'];

  function loadDisabled() {
    let svc;
    jest.isolateModules(() => {
      // Force the dormant state regardless of what .env carries.
      delete process.env[FLAG];
      CREDS.forEach((k) => delete process.env[k]);
      svc = require('../../src/services/piiRedactionService');
    });
    return svc;
  }

  it('isEnabled() === false when ENABLE_PII_REDACTION is unset', () => {
    const svc = loadDisabled();
    expect(svc.isEnabled()).toBe(false);
  });

  it('redact() returns the input string UNCHANGED (no-op) when disabled', async () => {
    const svc = loadDisabled();
    const input = 'Contact Jane Doe at jane.doe@example.com or +1 (555) 123-4567.';
    const out = await svc.redact(input);
    expect(out).toBe(input); // byte-for-byte identical — nothing stripped
  });

  it('redact() coerces null/undefined to "" without throwing (fail-open)', async () => {
    const svc = loadDisabled();
    await expect(svc.redact(null)).resolves.toBe('');
    await expect(svc.redact(undefined)).resolves.toBe('');
  });
});
