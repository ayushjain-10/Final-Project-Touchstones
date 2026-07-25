/**
 * safeSandboxPath confines candidate-supplied file paths to the E2B sandbox workdir.
 * Now that candidates can POST arbitrary file paths to /run, the old non-recursive
 * `.replace(/\.\.(\/|\\)/g,'')` was bypassable ("....//x" → "../x"). These lock the new
 * normalize-and-confine behavior.
 */
const { safeSandboxPath } = require('../../src/services/codeExecutionService');
const WORKDIR = '/home/user/work';

describe('safeSandboxPath', () => {
  test.each([
    ['solution.js', `${WORKDIR}/solution.js`],
    ['src/util/add.js', `${WORKDIR}/src/util/add.js`],
    ['/leading/slash.js', `${WORKDIR}/leading/slash.js`],   // leading slash stripped, stays inside
    ['./a.js', `${WORKDIR}/a.js`],
  ])('keeps %s inside the workdir', (input, expected) => {
    expect(safeSandboxPath(input)).toBe(expected);
  });

  // Real traversals (isolated ../ components) that normalize resolves OUTSIDE the workdir → null.
  test.each([
    '../etc/passwd',
    'a/../../b',
    '../../../../home/user/.bashrc',
    'foo/../../../bar',
  ])('rejects real traversal %s', (input) => {
    expect(safeSandboxPath(input)).toBeNull();
  });

  // The security INVARIANT: for ANY input (incl. the "....//x" / "..\\/x" forms that defeated the
  // old single-pass replace), the result NEVER escapes WORKDIR — it is null or stays inside.
  test.each([
    '../etc/passwd', '....//etc/passwd', '..\\/x', 'a/../../b',
    '../../../../home/user/.bashrc', 'foo/../../../bar', 'normal.js', 'deep/a/b/c.js',
  ])('never escapes the workdir for %s', (input) => {
    const r = safeSandboxPath(input);
    expect(r === null || r === WORKDIR || r.startsWith(`${WORKDIR}/`)).toBe(true);
  });

  test('rejects empty / missing paths', () => {
    expect(safeSandboxPath('')).toBeNull();
    expect(safeSandboxPath(null)).toBeNull();
    expect(safeSandboxPath(undefined)).toBeNull();
  });
});
