import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../../electron/allowlist';

describe('isAllowedExternalUrl', () => {
  it('accepts https links on allowlisted hosts', () => {
    expect(isAllowedExternalUrl('https://github.com/reeper316099/OutbreakScope')).toBe(true);
    expect(isAllowedExternalUrl('https://doi.org/10.1186/1471-2334-14-480')).toBe(true);
  });
  it('rejects http, other schemes, and unknown hosts', () => {
    expect(isAllowedExternalUrl('http://github.com/')).toBe(false);
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('https://evil.example/')).toBe(false);
  });
  it('rejects look-alike hosts, credentials, odd ports, and garbage', () => {
    expect(isAllowedExternalUrl('https://github.com.evil.example/')).toBe(false);
    expect(isAllowedExternalUrl('https://evil.example/github.com')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pw@github.com/')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com:8443/')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
    expect(isAllowedExternalUrl('')).toBe(false);
  });
});
