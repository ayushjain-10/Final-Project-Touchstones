/**
 * ADR-002 assessment archive — unit coverage for the two new services:
 *   1) storageClient SharedKey signing (regression-locked canonicalization)
 *   2) assessmentArchiveService gating (OFF by default) + bundle assembly
 */

// Chainable supabase query stub: every builder method returns itself; awaiting it (or .single())
// resolves the canned result. Lets buildBundle run against fixture rows without a network.
function mockMakeQuery(result) {
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[m] = () => q;
  q.single = () => Promise.resolve(result);
  q.update = () => q;
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

const mockFixtures = {
  work_sample_submissions: { data: { id: 'sub-1', work_sample_id: 'ws-1', candidate_id: 'cand-1', status: 'scored' }, error: null },
  work_samples: { data: { id: 'ws-1', owner_id: 'owner-1', title: 'Design a queue', prompt_md: '...' }, error: null },
  ai_interactions: { data: [{ seq: 1, role: 'user', content: 'solve it' }, { seq: 2, role: 'assistant', content: '```code```', disposition: 'accepted' }], error: null },
  submission_integrity_events: { data: [{ event_type: 'paste' }], error: null },
  proof_scores: { data: [{ normalized_score: 82 }], error: null },
  ai_direction_scores: { data: [{ direction_score: 71 }], error: null },
};

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: (table) => mockMakeQuery(mockFixtures[table] ?? { data: null, error: null }) },
}));

const storageClient = require('../../src/services/storageClient');
const archive = require('../../src/services/assessmentArchiveService');

const CONN = 'DefaultEndpointsProtocol=https;AccountName=touchstones;AccountKey=' + Buffer.from('unit-test-key').toString('base64') + ';EndpointSuffix=core.windows.net';

afterEach(() => {
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.ASSESSMENT_ARCHIVE_ENABLED;
  archive.stop();
});

describe('storageClient (SharedKey, no SDK)', () => {
  test('unconfigured by default; parses a standard connection string', () => {
    expect(storageClient.isConfigured()).toBe(false);
    process.env.AZURE_STORAGE_CONNECTION_STRING = CONN;
    expect(storageClient.isConfigured()).toBe(true);
    const cfg = storageClient.parseConnectionString();
    expect(cfg.account).toBe('touchstones');
    expect(cfg.endpoint).toBe('https://touchstones.blob.core.windows.net');
  });

  test('BlobEndpoint override wins (Azurite/sovereign clouds)', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING =
      'AccountName=dev;AccountKey=' + Buffer.from('k').toString('base64') + ';BlobEndpoint=http://127.0.0.1:10000/dev';
    expect(storageClient.parseConnectionString().endpoint).toBe('http://127.0.0.1:10000/dev');
  });

  test('canonicalization: PUT with body, x-ms headers sorted, query in canonical resource', () => {
    const sts = storageClient.stringToSign({
      method: 'PUT',
      account: 'acct',
      path: '/container/tenants/o1/submissions/s1.json',
      query: { restype: 'container' },
      headers: { 'x-ms-version': '2021-08-06', 'x-ms-date': 'Fri, 04 Jul 2026 00:00:00 GMT', 'Content-Type': 'application/json' },
      contentLength: 42,
    });
    const lines = sts.split('\n');
    expect(lines[0]).toBe('PUT');
    expect(lines[3]).toBe('42'); // Content-Length
    expect(lines[5]).toBe('application/json'); // Content-Type
    // sorted x-ms-* headers, then canonical resource with query
    expect(lines[12]).toBe('x-ms-date:Fri, 04 Jul 2026 00:00:00 GMT');
    expect(lines[13]).toBe('x-ms-version:2021-08-06');
    expect(lines[14]).toBe('/acct/container/tenants/o1/submissions/s1.json');
    expect(lines[15]).toBe('restype:container');
  });

  test('zero-length body signs Content-Length as empty string (2015+ services rule)', () => {
    const sts = storageClient.stringToSign({
      method: 'DELETE', account: 'a', path: '/c/b.json', headers: { 'x-ms-date': 'd', 'x-ms-version': 'v' }, contentLength: 0,
    });
    expect(sts.split('\n')[3]).toBe('');
  });

  test('signature is deterministic HMAC-SHA256 over the base64-decoded key', () => {
    const key = Buffer.from('unit-test-key').toString('base64');
    const a = storageClient.sign(key, 'string-to-sign');
    const b = storageClient.sign(key, 'string-to-sign');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(storageClient.sign(key, 'different')).not.toBe(a);
  });
});

describe('assessmentArchiveService (dormant by default)', () => {
  test('enabled() is false without the flag, false with flag but no creds', () => {
    expect(archive.enabled()).toBe(false);
    process.env.ASSESSMENT_ARCHIVE_ENABLED = 'true';
    expect(archive.enabled()).toBe(false); // no connection string
    process.env.AZURE_STORAGE_CONNECTION_STRING = CONN;
    expect(archive.enabled()).toBe(true);
  });

  test('start() is inert when the flag is off; runSweep no-ops', async () => {
    expect(() => archive.start()).not.toThrow();
    await expect(archive.runSweep()).resolves.toBeUndefined();
  });

  test('deleteSubmissionArchives without creds reports every entry as undeletable (never throws into the erase path)', async () => {
    const entries = [{ ownerId: 'o1', submissionId: 's1' }];
    await expect(archive.deleteSubmissionArchives(entries)).resolves.toEqual(entries);
  });

  test('buildBundle throws when any part fails to read (no silently degraded bundles)', async () => {
    const original = mockFixtures.ai_interactions;
    mockFixtures.ai_interactions = { data: null, error: { message: 'transient 503' } };
    await expect(archive.buildBundle('sub-1')).rejects.toThrow(/ai_interactions failed/);
    mockFixtures.ai_interactions = original;
  });

  test('buildBundle assembles the full session record', async () => {
    const bundle = await archive.buildBundle('sub-1');
    expect(bundle.bundle_version).toBe(1);
    expect(bundle.submission.id).toBe('sub-1');
    expect(bundle.work_sample.owner_id).toBe('owner-1');
    expect(bundle.ai_transcript).toHaveLength(2);
    expect(bundle.ai_transcript[1].disposition).toBe('accepted');
    expect(bundle.integrity_events).toHaveLength(1);
    expect(bundle.scores[0].normalized_score).toBe(82);
    expect(bundle.direction_scores[0].direction_score).toBe(71);
  });
});
