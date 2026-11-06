import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppPath } from '../../electron/appPath';

const root = path.resolve('/srv/renderer');

describe('resolveAppPath', () => {
  it('maps / to index.html and normal paths inside root', () => {
    expect(resolveAppPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
  });
  it('rejects path traversal, including encoded forms', () => {
    expect(resolveAppPath(root, '/../secret.txt')).toBeNull();
    expect(resolveAppPath(root, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveAppPath(root, '/assets/../../secret.txt')).toBeNull();
    expect(resolveAppPath(root, '/..%2fsecret.txt')).toBeNull();
  });
  it('rejects NUL bytes and malformed escapes', () => {
    expect(resolveAppPath(root, '/a%00b')).toBeNull();
    expect(resolveAppPath(root, '/%E0%A4%A')).toBeNull();
  });
});
