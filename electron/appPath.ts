import path from 'node:path';

/** Maps an app:// URL path to a file inside root; returns null if it would escape root (path traversal). */
export function resolveAppPath(root: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname === '/' ? '/index.html' : urlPathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(root, '.' + decoded);
  return full.startsWith(root + path.sep) ? full : null;
}
