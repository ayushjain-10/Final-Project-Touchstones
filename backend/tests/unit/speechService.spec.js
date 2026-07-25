/**
 * speechService — dormant/no-op regression (Azure services plan #5).
 * ------------------------------------------------------------------
 * The verbal-walkthrough Speech token issuer is flag-gated (ENABLE_SPEECH_WALKTHROUGH)
 * and requires Azure Speech creds. With the flag/creds unset it must be inert:
 * issueToken() resolves null (never performs the STS fetch) and isEnabled() is false.
 * This is the guard behind the /api/proof/speech-token route's "404 when off" behavior.
 * Runs with no network: the disabled path returns before the fetch() call.
 */
describe('speechService (dormant / disabled)', () => {
  const FLAG = 'ENABLE_SPEECH_WALKTHROUGH';
  const CREDS = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'];

  function loadDisabled() {
    let svc;
    jest.isolateModules(() => {
      delete process.env[FLAG];
      CREDS.forEach((k) => delete process.env[k]);
      svc = require('../../src/services/speechService');
    });
    return svc;
  }

  it('isEnabled() === false when the flag/creds are unset', () => {
    const svc = loadDisabled();
    expect(svc.isEnabled()).toBe(false);
  });

  it('issueToken() resolves null when disabled (never calls the Azure STS endpoint)', async () => {
    // Guard: if issueToken ignored the flag it would call fetch(); make fetch explode so a
    // regression that skips the disabled-guard fails loudly instead of hitting the network.
    const svc = loadDisabled();
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => { throw new Error('speechService made a network call while disabled'); });
    try {
      await expect(svc.issueToken()).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('isEnabled() stays false when the flag is on but creds are missing', () => {
    let svc;
    jest.isolateModules(() => {
      process.env[FLAG] = 'true';
      CREDS.forEach((k) => delete process.env[k]);
      svc = require('../../src/services/speechService');
    });
    delete process.env[FLAG];
    expect(svc.isEnabled()).toBe(false);
  });
});
