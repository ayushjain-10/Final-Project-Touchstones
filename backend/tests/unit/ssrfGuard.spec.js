/**
 * Unit tests for ssrfGuard — the webhook SSRF defense. Uses literal-IP URLs so no DNS/network
 * is needed (the named-host path is exercised only via the hostname blocklist, which is offline).
 */
const { assertPublicHttpsUrl, isBlockedIp, SsrfError } = require('../../src/services/ssrfGuard');

describe('isBlockedIp', () => {
  test.each([
    '127.0.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1',
    '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => { expect(isBlockedIp(ip)).toBe(true); });

  test.each([
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1',
    '2606:4700:4700::1111',
  ])('allows public %s', (ip) => { expect(isBlockedIp(ip)).toBe(false); });

  test('blocks garbage', () => { expect(isBlockedIp('not-an-ip')).toBe(true); });
});

describe('assertPublicHttpsUrl', () => {
  test('rejects non-https', async () => {
    await expect(assertPublicHttpsUrl('http://example.com')).rejects.toBeInstanceOf(SsrfError);
  });
  test('rejects localhost + metadata hostnames (no DNS needed)', async () => {
    await expect(assertPublicHttpsUrl('https://localhost/x')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHttpsUrl('https://metadata.google.internal/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHttpsUrl('https://foo.internal/')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHttpsUrl('https://foo.local/')).rejects.toBeInstanceOf(SsrfError);
  });
  test('rejects private / metadata literal IPs', async () => {
    for (const u of [
      'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/', 'https://192.168.0.1/', 'https://[::1]/', 'https://[fc00::1]/',
    ]) {
      await expect(assertPublicHttpsUrl(u)).rejects.toBeInstanceOf(SsrfError);
    }
  });
  test('accepts a public literal-IP https URL', async () => {
    const u = await assertPublicHttpsUrl('https://8.8.8.8/hook');
    expect(u.protocol).toBe('https:');
  });
  test('rejects malformed input', async () => {
    await expect(assertPublicHttpsUrl('not a url')).rejects.toBeInstanceOf(SsrfError);
  });
});
