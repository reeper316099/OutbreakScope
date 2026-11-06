// Which external links may be opened in the system browser (https only, exact host match).

export const ALLOWED_EXTERNAL_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'doi.org',
  'pmc.ncbi.nlm.nih.gov',
  'pubmed.ncbi.nlm.nih.gov',
  'data.cdc.gov',
]);

/** True only for https URLs with no credentials whose host is exactly on the allowlist. */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '' && url.port !== '443') return false;
  return ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
}
